import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbGet } from '../services/dbUtils.js';
import { createSettlement, addSettlementLoad, updateSettlementLoad, getSettlement, transitionSettlement } from '../services/driverSettlements.js';

async function fixture(t) {
  const db = await createDb();
  t.after(() => new Promise(resolve => db.close(resolve)));
  const settlement = await createSettlement(db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-09-14', periodEnd: '2026-09-20' });
  return {db, id:settlement.id};
}

test('manual container persists, can be corrected, and appears in reviewed statements', async t => {
  const {db,id} = await fixture(t);
  let result = await addSettlementLoad(db,'COMP-A',id,{description:'Manual delivery',payAmount:175,containerNumber:' mrku1234567 '});
  assert.equal(result.statement.loads[0].containerNumber,'MRKU1234567');
  const lineId = result.statement.loads[0].settlementLoadId;
  result = await updateSettlementLoad(db,'COMP-A',id,lineId,{containerNumber:'MSCU7654321'});
  assert.equal(result.statement.loads[0].containerNumber,'MSCU7654321');
  assert.equal(result.netPay,175);
  await transitionSettlement(db,'COMP-A',id,{action:'review'});
  assert.equal((await getSettlement(db,'COMP-A',id)).statement.loads[0].containerNumber,'MSCU7654321');
  await assert.rejects(updateSettlementLoad(db,'COMP-A',id,lineId,{containerNumber:'CHANGED'}), /locked|editable/i);
  assert.equal(await getSettlement(db,'COMP-B',id),null);
});

test('missing snapshot container is recovered from linked load without changing frozen pay or stored snapshot', async t => {
  const {db,id} = await fixture(t);
  await dbRun(db,"INSERT INTO loads(id,companyId,driver,containerNumber) VALUES('L1','COMP-A','DRV-A','')");
  await dbRun(db,"INSERT INTO load_moves(id,companyId,loadId,driverId,completedBy,status,completedAt,driverRate) VALUES('M1','COMP-A','L1','DRV-A','DRV-A','Completed','2026-09-15','225')");
  await addSettlementLoad(db,'COMP-A',id,{moveId:'M1',description:'Delivery'});
  await transitionSettlement(db,'COMP-A',id,{action:'review'});
  await transitionSettlement(db,'COMP-A',id,{action:'finalize'});
  const before = await dbGet(db,'SELECT statementJson FROM settlements WHERE id=?',[id]);
  await dbRun(db,"UPDATE loads SET containerNumber='MRKU1234567', driverRate='999' WHERE id='L1'");
  const result = await getSettlement(db,'COMP-A',id);
  assert.equal(result.statement.loads[0].containerNumber,'MRKU1234567');
  assert.equal(result.statement.loads[0].payAmount,225);
  assert.equal(result.statement.totals.netPay,225);
  assert.deepEqual(await dbGet(db,'SELECT statementJson FROM settlements WHERE id=?',[id]),before);
  const snapshot = JSON.parse(before.statementJson);
  snapshot.loads[0].containerNumber='MSCU7654321';
  await dbRun(db,'UPDATE settlements SET statementJson=? WHERE id=?',[JSON.stringify(snapshot),id]);
  assert.equal((await getSettlement(db,'COMP-A',id)).statement.loads[0].containerNumber,'MSCU7654321');
});

test('legacy manual reasons recover only one explicit container; foreign loads cannot supply container data', async t => {
  const {db,id} = await fixture(t);
  let result = await addSettlementLoad(db,'COMP-A',id,{description:'Delivery MRKU1234567',payAmount:100});
  assert.equal(result.statement.loads[0].containerNumber,'MRKU1234567');
  result = await addSettlementLoad(db,'COMP-A',id,{description:'MRKU1234567 and MSCU7654321',payAmount:50});
  assert.equal(result.statement.loads.find(l=>l.payAmount===50).containerNumber,'');
  await dbRun(db,"INSERT INTO loads(id,companyId,containerNumber) VALUES('FOREIGN','COMP-B','MSCU7654321')");
  await dbRun(db,"UPDATE settlement_loads SET loadId='FOREIGN',description='Manual' WHERE settlementId=?",[id]);
  result=await getSettlement(db,'COMP-A',id);
  assert.ok(result.statement.loads.every(l=>!l.containerNumber));
});
