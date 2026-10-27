import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbAll } from '../services/dbUtils.js';
import routes from '../routes/driverSettlements.js';
import { preparePayrollPeriod } from '../services/preparePayrollPeriod.js';
import { getSettlement, removeSettlementLoad } from '../services/driverSettlements.js';

test('reopening a prepared period adds new completed movements without overwriting payroll work', async t => {
  const db = await createDb();
  t.after(() => new Promise(resolve => db.close(resolve)));
  const period = { periodStart: '2026-10-19', periodEnd: '2026-10-23' };
  const initial = await preparePayrollPeriod(db, 'COMP-A', period, 'QA');
  const id = initial.find(row => row.driverId === 'DRV-A').id;
  const addMove = async (moveId, { company = 'COMP-A', driver = 'DRV-A', date = '2026-10-20', status = 'Completed' } = {}) => {
    await dbRun(db, 'INSERT INTO loads(id,companyId,driver,status,loadDate,driverRate) VALUES(?,?,?,?,?,?)',
      [moveId, company, driver, status, date, '250']);
    await dbRun(db, `INSERT INTO load_moves(id,companyId,loadId,driverId,completedBy,status,completedAt,driverRate,moveType)
      VALUES(?,?,?,?,?,?,?,?,?)`, [moveId, company, moveId, driver, driver, status, date + 'T12:00:00Z', '250', 'DELIVERY']);
  };
  await addMove('FIRST');
  await preparePayrollPeriod(db, 'COMP-A', period, 'QA');
  let statement = (await getSettlement(db, 'COMP-A', id)).statement;
  assert.equal(statement.totals.loadCount, 1);
  assert.equal(statement.totals.grossPay, 250);
  const firstLineId = statement.loads[0].settlementLoadId;
  await dbRun(db, 'UPDATE settlement_loads SET payAmount=325,description=? WHERE id=?', ['Edited driver pay', firstLineId]);
  await dbRun(db, "UPDATE settlements SET notes='Keep payroll notes' WHERE id=?", [id]);
  await dbRun(db, `INSERT INTO deductions(id,settlement_id,description,amount,stage) VALUES('ADJ',?,'Keep adjustment',-25,'gross_adjustment')`, [id]);
  await addMove('REMOVED');
  await preparePayrollPeriod(db, 'COMP-A', period, 'QA');
  statement = (await getSettlement(db, 'COMP-A', id)).statement;
  await removeSettlementLoad(db, 'COMP-A', id, statement.loads.find(line => line.moveId === 'REMOVED').settlementLoadId, 'QA');
  await addMove('NEW');
  await addMove('OTHER-COMPANY', { company: 'COMP-B', driver: 'DRV-B' });
  await addMove('OUTSIDE', { date: '2026-10-26' });
  await addMove('ACTIVE', { status: 'Assigned' });
  await addMove('ALREADY-INCLUDED');
  await dbRun(db, `INSERT INTO settlements(id,companyId,driverId,periodStart,periodEnd,status) VALUES('OTHER-PERIOD','COMP-A','DRV-A','2026-10-12','2026-10-16','Paid')`);
  await dbRun(db, `INSERT INTO settlement_loads(id,settlementId,loadId,moveId,payAmount,source) VALUES('PREVIOUS-LINE','OTHER-PERIOD','ALREADY-INCLUDED','ALREADY-INCLUDED',250,'manual_move')`);
  const refreshed = await preparePayrollPeriod(db, 'COMP-A', period, 'QA');
  assert.equal(refreshed.find(row => row.id === id).loadCount, 2);
  const result = await getSettlement(db, 'COMP-A', id);
  assert.equal(result.notes, 'Keep payroll notes');
  assert.deepEqual(new Set(result.statement.loads.map(line => line.moveId)), new Set(['FIRST', 'NEW']));
  assert.equal(result.statement.loads.find(line => line.moveId === 'FIRST').payAmount, 325);
  assert.equal(result.statement.totals.grossPay, 575);
  assert.equal(result.statement.totals.netPay, 550);
  const before = await dbAll(db, 'SELECT * FROM settlements ORDER BY id');
  await preparePayrollPeriod(db, 'COMP-A', period, 'QA');
  assert.deepEqual(await dbAll(db, 'SELECT * FROM settlements ORDER BY id'), before);
  for (const status of ['Reviewed', 'Finalized', 'Paid']) {
    await dbRun(db, 'UPDATE settlements SET status=? WHERE id=?', [status, id]);
    await addMove('LATE-' + status);
    const locked = await dbAll(db, 'SELECT * FROM settlements WHERE id=?', [id]);
    await preparePayrollPeriod(db, 'COMP-A', period, 'QA');
    assert.deepEqual(await dbAll(db, 'SELECT * FROM settlements WHERE id=?', [id]), locked);
    assert.equal((await getSettlement(db, 'COMP-A', id)).statement.loads.length, 2);
  }
});

test('period automatically prepares all company drivers, reuses settlements, and preserves edits and finalization', async t => {
  const db=await createDb();
  await dbRun(db,"INSERT INTO drivers(id,companyId,name) VALUES('DRV-C','COMP-A','Driver C')");
  await dbRun(db,"INSERT INTO loads(id,companyId,driver,status,loadDate,driverRate) VALUES('L1','COMP-A','DRV-A','Completed','2026-10-06','250')");
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{req.user={role:req.headers['x-role']||'payroll',name:'QA'};req.company={companyId:'COMP-A'};next();});
  app.use('/api/driver-settlements',routes(db));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>db.close(r));});
  const url=`http://127.0.0.1:${server.address().port}/api/driver-settlements/prepare-period`;
  const period={periodStart:'2026-10-05',periodEnd:'2026-10-09'};
  const call=(body=period,role='payroll')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-role':role},body:JSON.stringify(body)});
  assert.equal((await call(period,'driver')).status,403);
  assert.equal((await call({periodStart:'bad',periodEnd:'2026-10-09'})).status,400);
  const initial=await call();assert.equal(initial.status,200);
  const rows=await initial.json();assert.equal(rows.length,2);
  assert.deepEqual(new Set(rows.map(r=>r.driverId)),new Set(['DRV-A','DRV-C']));
  assert.ok(rows.every(r=>r.status==='Draft' && r.id));
  assert.equal(rows.find(r=>r.driverId==='DRV-A').grossPay,250);
  assert.equal(rows.find(r=>r.driverId==='DRV-C').grossPay,0);
  await dbRun(db,"UPDATE settlements SET status='Finalized', notes='Keep locked' WHERE driverId='DRV-A'");
  await dbRun(db,"UPDATE settlements SET notes='Payroll manual notes' WHERE driverId='DRV-C'");
  const before=await dbAll(db,'SELECT * FROM settlements ORDER BY id');
  const repeated=await Promise.all([call(),call()]);
  assert.ok(repeated.every(r=>r.status===200));
  assert.deepEqual(await dbAll(db,'SELECT * FROM settlements ORDER BY id'),before);
  assert.equal((await call({periodStart:'2026-10-12',periodEnd:'2026-10-16'})).status,200);
  assert.equal((await dbAll(db,'SELECT * FROM settlements')).length,4);
});
