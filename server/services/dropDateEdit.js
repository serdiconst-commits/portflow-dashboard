import { dbAll, dbGet, dbRun } from './dbUtils.js';
const text = value => String(value ?? '').trim();
const fail = (message, status = 409) => Object.assign(new Error(message), {status});
let savepointId = 0;

// Only Edit Load uses this path. Other movement fields and settlement snapshots stay intact.
export function saveLoadWithDropDate(db, previous, requested, sql, params, callback) {
  const next = requested.dropDateTime === undefined ? text(previous.dropDateTime) : text(requested.dropDateTime);
  if (next === text(previous.dropDateTime)) return db.run(sql, params, callback);
  (async () => {
    if (!next || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(next) || !Number.isFinite(Date.parse(next))) {
      throw fail('Enter a valid Drop Date/Time. A recorded drop date cannot be cleared.', 400);
    }
    const moves = await dbAll(db, `SELECT * FROM load_moves WHERE companyId=? AND loadId=? AND status='Completed' AND moveType IN ('DROP','PRE_PULL','LIVE_DELIVERY')`, [previous.companyId, previous.id]);
    const dropMoves = moves.filter(move => move.moveType !== 'LIVE_DELIVERY' || previous.status === 'Dropped' ||
      (previous.dropDateTime && Date.parse(move.completedAt) === Date.parse(previous.dropDateTime)));
    const exact = dropMoves.filter(move => previous.dropDateTime && Date.parse(move.completedAt) === Date.parse(previous.dropDateTime));
    const candidates = exact.length ? exact : dropMoves;
    if (!candidates.length && requested.status === 'Dropped' && previous.status !== 'Dropped') {
      // The ordinary status transition below records the actual drop and its driver.
      return await new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
    }
    if (candidates.length !== 1) throw fail('The completed drop movement could not be identified uniquely. Review its movement history before changing Drop Date.');
    const move = candidates[0];
    const included = await dbGet(db, `SELECT sl.id FROM settlement_loads sl JOIN settlements s ON s.id=sl.settlementId WHERE s.companyId=? AND (sl.moveId=? OR (sl.loadId=? AND (sl.moveId IS NULL OR sl.moveId='') AND s.driverId=?)) LIMIT 1`, [previous.companyId, move.id, previous.id, move.completedBy || move.driverId]);
    const payroll = await dbGet(db, `SELECT pi.id FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payrollRunId WHERE pi.companyId=? AND pi.loadId=? AND pi.driverId=? AND LOWER(pr.status)!='voided' LIMIT 1`, [previous.companyId, previous.id, move.completedBy || move.driverId]);
    if (included || payroll) throw fail('This drop is already included in a settlement/payroll. Review that payment first before changing its date.');
    const savepoint = `drop_date_${++savepointId}`;
    await dbRun(db, `SAVEPOINT ${savepoint}`);
    try {
      const result = await dbRun(db, sql, params);
      const updated = await dbRun(db, `UPDATE load_moves SET completedAt=?,updatedAt=? WHERE companyId=? AND id=? AND status='Completed' AND COALESCE(completedAt,'')=?
        AND NOT EXISTS (SELECT 1 FROM settlement_loads sl JOIN settlements s ON s.id=sl.settlementId WHERE s.companyId=load_moves.companyId AND (sl.moveId=load_moves.id OR (sl.loadId=load_moves.loadId AND (sl.moveId IS NULL OR sl.moveId='') AND s.driverId=COALESCE(NULLIF(load_moves.completedBy,''),load_moves.driverId))))
        AND NOT EXISTS (SELECT 1 FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payrollRunId WHERE pi.companyId=load_moves.companyId AND pi.loadId=load_moves.loadId AND pi.driverId=COALESCE(NULLIF(load_moves.completedBy,''),load_moves.driverId) AND LOWER(pr.status)!='voided')`, [next, new Date().toISOString(), previous.companyId, move.id, move.completedAt || '']);
      if (result.changes !== 1 || updated.changes !== 1) throw fail('The drop changed while editing. Refresh the load and try again.');
      await dbRun(db, `RELEASE ${savepoint}`);
      return {...result, dropDateChange:{moveId:move.id, oldDate:move.completedAt || '', newDate:next}};
    } catch(error) {
      await dbRun(db, `ROLLBACK TO ${savepoint}`);
      await dbRun(db, `RELEASE ${savepoint}`);
      throw error;
    }
  })().then(result => callback.call(result, null), error => callback(error));
}
