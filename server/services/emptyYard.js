import { randomUUID } from 'node:crypto';
import { dbAll, dbGet, dbRun } from './dbUtils.js';
import { isEmptyYardMove } from '../../shared/emptyYard.js';
const text = value => String(value ?? '').trim();
const finished = move => ['Completed', 'Cancelled'].includes(move.status);
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const locks = new Set();
let transactionTail = Promise.resolve();
async function atomic(db, key, action) {
  if (locks.has(key)) throw fail('This load is being updated. Refresh and try again.');
  locks.add(key);
  const prior = transactionTail;
  let release;
  transactionTail = new Promise(resolve => { release = resolve; });
  await prior;
  const savepoint = `empty_yard_${randomUUID().replaceAll('-', '')}`;
  let started = false;
  try {
    await dbRun(db, `SAVEPOINT ${savepoint}`); started = true;
    const result = await action();
    await dbRun(db, `RELEASE ${savepoint}`); started = false;
    return result;
  } catch (error) {
    if (started) { await dbRun(db, `ROLLBACK TO ${savepoint}`); await dbRun(db, `RELEASE ${savepoint}`); }
    throw error;
  } finally { locks.delete(key); release(); }
}
export async function planEmptyYard(db, companyId, loadId, { yard, returnLocation }) {
  yard = text(yard); returnLocation = text(returnLocation);
  if (!yard || !returnLocation || yard === returnLocation) throw fail('Choose a yard and a different final return location.', 400);
  return atomic(db, `${companyId}:${loadId}`, async () => {
    const load = await dbGet(db, 'SELECT * FROM loads WHERE id=? AND companyId=?', [loadId, companyId]);
    if (!load || text(load.deletedAt)) throw fail('Load not found.', 404);
    if (load.loadType === 'EXPORT') throw fail('Empty yard return is available for import / regular loads.');
    if (text(load.billingStatus) && load.billingStatus !== 'Needs Review') throw fail('Return this load from Accounting before adding movements.');
    if (await dbGet(db, 'SELECT id FROM invoices WHERE loadId=? AND companyId=? LIMIT 1', [loadId, companyId])) throw fail('This load has an invoice. Review Accounting before changing its return plan.');
    const moves = await dbAll(db, 'SELECT * FROM load_moves WHERE companyId=? AND loadId=? ORDER BY sequence', [companyId, loadId]);
    if (moves.some(isEmptyYardMove)) throw fail('This load already has an empty yard return plan.');
    const move = moves.find(row => ['RETURN', 'PICKUP_RETURN'].includes(row.moveType) && !finished(row));
    if (!move || !['Planned', 'Waiting Customer', 'Ready for Pickup'].includes(move.status) || text(move.driverId) || text(move.startedAt)) throw fail('An unassigned, unstarted return movement is required.');
    if (moves.some(row => row.sequence > move.sequence && !finished(row))) throw fail('Review the existing movements after this return first.');
    if (await dbGet(db, `SELECT id FROM settlement_loads WHERE moveId=? OR (loadId=? AND COALESCE(moveId,'')='') LIMIT 1`, [move.id, loadId])) throw fail('This return is already included in a settlement.');
    if (moves.some(row => row.sequence < move.sequence && !finished(row) && !text(row.driverId))) throw fail('Assign and complete the earlier delivery movements before adding an empty yard return.');
    const now = new Date().toISOString();
    const origin = text(move.origin || load.delivery);
    if (!origin) throw fail('Add the customer pickup location first.', 400);
    const changed = await dbRun(db, `UPDATE load_moves SET moveType='EMPTY_YARD',status='Planned',origin=?,destination=?,driverId='',driverRate='',assignedAt='',updatedAt=? WHERE id=? AND companyId=? AND status=?`, [origin, yard, now, move.id, companyId, move.status]);
    if (changed.changes !== 1) throw fail('Return movement changed. Refresh and try again.');
    const returnId = randomUUID();
    const sequence = Math.max(...moves.map(row => Number(row.sequence))) + 1;
    await dbRun(db, `INSERT INTO load_moves (id,companyId,loadId,sequence,moveType,status,origin,destination,driverId,driverRate,assignedAt,startedAt,completedAt,completedBy,readyAt,notes,createdAt,updatedAt) VALUES (?,?,?,?,'YARD_RETURN','Planned',?,?,'','','','','','','','',?,?)`, [returnId, companyId, loadId, sequence, yard, returnLocation, now, now]);
    await dbRun(db, 'UPDATE loads SET returnLocation=? WHERE id=? AND companyId=?', [returnLocation, loadId, companyId]);
    const priorOpen = moves.some(row => row.sequence < move.sequence && !finished(row));
    if (!priorOpen) await dbRun(db, `UPDATE loads SET status='Pending',driver='',truck='' WHERE id=? AND companyId=?`, [loadId, companyId]);
    return { loadId, moveId: move.id, returnId, yard, returnLocation };
  });
}
export async function assignEmptyYard(db, companyId, moveId, body) {
  const initial = await dbGet(db, 'SELECT * FROM load_moves WHERE id=? AND companyId=?', [moveId, companyId]);
  if (!initial || !isEmptyYardMove(initial)) throw fail('Movement not found.', 404);
  return atomic(db, `${companyId}:${initial.loadId}`, async () => {
    const move = await dbGet(db, 'SELECT * FROM load_moves WHERE id=? AND companyId=?', [moveId, companyId]);
    const load = await dbGet(db, 'SELECT * FROM loads WHERE id=? AND companyId=?', [move.loadId, companyId]);
    if (!load || text(load.deletedAt)) throw fail('Load not found.', 404);
    if (move.status !== 'Planned') throw fail('This movement has already been assigned or completed.');
    const prior = await dbGet(db, `SELECT id FROM load_moves WHERE companyId=? AND loadId=? AND sequence<? AND status NOT IN ('Completed','Cancelled') LIMIT 1`, [companyId, move.loadId, move.sequence]);
    if (prior) throw fail('Complete the previous movement before assigning this one.');
    const driver = await dbGet(db, `SELECT * FROM drivers WHERE id=? AND companyId=?`, [text(body.driverId), companyId]);
    if (!driver || driver.isActive === 0) throw fail('Choose an active driver from this company.', 400);
    const rate = text(body.driverRate).replace(/^\$/, '').replaceAll(',', '');
    if (!/^\d+(\.\d{1,2})?$/.test(rate)) throw fail('Enter a non-negative driver pay amount.', 400);
    const now = new Date().toISOString();
    await dbRun(db, `UPDATE load_moves SET driverId=?,driverRate=?,status='Assigned',assignedAt=?,updatedAt=? WHERE id=? AND companyId=?`, [driver.id, rate, now, now, moveId, companyId]);
    await dbRun(db, `UPDATE loads SET driver=?,truck=?,driverRate=?,status='Dispatched' WHERE id=? AND companyId=?`, [driver.id, driver.truck || '', rate, move.loadId, companyId]);
    return { ...move, driverId: driver.id, driverRate: rate, status: 'Assigned', assignedAt: now };
  });
}
export async function setEmptyYardStatus(db, companyId, loadId, status, actor) {
  return atomic(db, `${companyId}:${loadId}`, async () => {
    const load = await dbGet(db, 'SELECT * FROM loads WHERE id=? AND companyId=?', [loadId, companyId]);
    if (!load || text(load.deletedAt)) throw fail('Load not found.', 404);
    const moves = await dbAll(db, 'SELECT * FROM load_moves WHERE companyId=? AND loadId=? ORDER BY sequence', [companyId, loadId]);
    const move = moves.find(row => !finished(row));
    if (!isEmptyYardMove(move)) throw fail('This empty yard movement is not ready.');
    if (!move.driverId || !['Assigned', 'Arrived at Pickup', 'Loaded', 'In Transit'].includes(move.status)) throw fail('Assign this movement before updating its status.');
    if (actor.role === 'driver' && (actor.driverId !== move.driverId || !(await dbGet(db, `SELECT id FROM loads WHERE id=? AND companyId=? AND driver=? AND COALESCE(isDriverReleased,1)=1`, [loadId, companyId, actor.driverId])))) throw fail('This released movement is not assigned to you.', 403);
    if (!['Arrived at Pickup', 'Loaded', 'In Transit', 'Dropped', 'Delivered'].includes(status)) throw fail('Invalid movement status.', 400);
    if (status === 'Dropped' && move.moveType !== 'EMPTY_YARD') throw fail('Complete the return at the port using Delivered.', 400);
    const complete = ['Dropped', 'Delivered'].includes(status);
    const now = new Date().toISOString();
    await dbRun(db, `UPDATE load_moves SET status=?,startedAt=CASE WHEN COALESCE(startedAt,'')='' THEN ? ELSE startedAt END,completedAt=?,completedBy=?,updatedAt=? WHERE id=? AND companyId=?`, [complete ? 'Completed' : status, now, complete ? now : '', complete ? move.driverId : '', now, move.id, companyId]);
    const atYard = complete && move.moveType === 'EMPTY_YARD';
    const nextStatus = atYard ? 'Dropped' : complete ? 'Delivered' : status;
    await dbRun(db, `UPDATE loads SET status=?,driver=CASE WHEN ? THEN '' ELSE driver END,truck=CASE WHEN ? THEN '' ELSE truck END WHERE id=? AND companyId=?`, [nextStatus, atYard ? 1 : 0, atYard ? 1 : 0, loadId, companyId]);
    return { success: true, loadId, status: nextStatus, moveId: move.id, completedAt: complete ? now : '', completedBy: complete ? move.driverId : '' };
  });
}
export function mountEmptyYardRoutes(app, { db, authenticate, requireRoles, dispatchLocationRoles, writeAuditLog, hasRequiredCompletionDocuments }) {
  const respond = (req, res, action, type) => action().then(result => {
    writeAuditLog(req, {action:type,entityType:'LOAD_MOVE',entityId:result.moveId || result.id,entityLabel:result.loadId,newValue:result});
    res.json(result);
  }).catch(error => res.status(error.status || 500).json({error:error.message}));
  app.post('/api/loads/:id/empty-yard', authenticate, requireRoles(dispatchLocationRoles), (req,res) => respond(req,res,()=>planEmptyYard(db,req.company.companyId,req.params.id,req.body || {}),'EMPTY_YARD_PLAN'));
  app.put('/api/load-moves/:id/assign', authenticate, requireRoles(dispatchLocationRoles), async (req,res,next) => {
    try {
      const move = await dbGet(db,'SELECT * FROM load_moves WHERE id=? AND companyId=?',[req.params.id,req.company.companyId]);
      if (!isEmptyYardMove(move)) return next();
      return respond(req,res,()=>assignEmptyYard(db,req.company.companyId,req.params.id,req.body || {}),'EMPTY_YARD_ASSIGN');
    } catch(error) { res.status(500).json({error:error.message}); }
  });
  app.put('/api/loads/:id/status', authenticate, async (req,res,next) => {
    try {
      const move = await dbGet(db, `SELECT * FROM load_moves WHERE loadId=? AND companyId=? AND status NOT IN ('Completed','Cancelled') ORDER BY sequence LIMIT 1`,[req.params.id,req.company.companyId]);
      if (!isEmptyYardMove(move)) return next();
      if (req.user?.role !== 'driver' && !dispatchLocationRoles.has(req.user?.role)) return res.status(403).json({error:'Not allowed.'});
      if (req.user?.role === 'driver' && req.body?.status === 'Delivered') {
        const documents = await dbAll(db, `SELECT category,type FROM documents WHERE loadId=?`, [req.params.id]);
        if (!hasRequiredCompletionDocuments(documents)) return res.status(400).json({error:'POD is required before completing this load.'});
      }
      return respond(req,res,()=>setEmptyYardStatus(db,req.company.companyId,req.params.id,req.body?.status,req.user || {}),'EMPTY_YARD_STATUS');
    } catch(error) { res.status(500).json({error:error.message}); }
  });
  // A broad load edit must not bypass the explicit movement assignment/completion.
  app.put('/api/loads/:id', authenticate, async (req,res,next) => {
    try {
      const active = await dbGet(db, `SELECT id FROM load_moves WHERE loadId=? AND companyId=? AND moveType IN ('EMPTY_YARD','YARD_RETURN') AND status NOT IN ('Completed','Cancelled') LIMIT 1`, [req.params.id,req.company.companyId]);
      if (!active) return next();
      const load = await dbGet(db,'SELECT * FROM loads WHERE id=? AND companyId=?',[req.params.id,req.company.companyId]);
      const fields = ['status','driver','driverRate','workflowType','pickup','delivery','returnLocation','dropDateTime'];
      if (fields.some(field=>req.body?.[field] !== undefined && text(req.body[field]) !== text(load[field]))) return res.status(409).json({error:'Use the empty yard movement controls to assign or complete this work.'});
      next();
    } catch(error) { res.status(500).json({error:error.message}); }
  });
}
