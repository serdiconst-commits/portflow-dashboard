import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbGet, dbAll } from '../services/dbUtils.js';
import { createSettlement, addSettlementLoad, getSettlement, transitionSettlement } from '../services/driverSettlements.js';
import { payrollLocationOptions } from '../../src/utils/payrollLocations.js';

async function fixture(t) {
  const db = await createDb();
  t.after(() => new Promise(resolve => db.close(resolve)));
  const settlement = await createSettlement(db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-09-14', periodEnd: '2026-09-20' });
  return { db, settlement };
}
test('saved suggestions separate pickup and delivery types and include name/address for searching', () => {
  const locations = [
    { name: 'Bayport', address: 'Port road', type: 'port' },
    { name: 'Customer', address: 'Delivery road', city: 'Houston', type: 'delivery' },
    { name: 'Warehouse', type: 'warehouse' },
    { name: 'Empty depot', type: 'return' },
  ];
  assert.deepEqual(payrollLocationOptions(locations, 'pickup'), ['Bayport — Port road', 'Warehouse']);
  assert.deepEqual(payrollLocationOptions(locations, 'delivery'), ['Customer — Delivery road, Houston', 'Warehouse']);
});
test('manual locations persist on reopen, retain exact pay and survive review snapshots', async t => {
  const { db, settlement } = await fixture(t);
  const input = { description: 'Manual move', payAmount: 175, pickupLocation: ' Bayport — Port road ', deliveryLocation: 'Custom delivery address' };
  let result = await addSettlementLoad(db, 'COMP-A', settlement.id, input, 'Payroll');
  assert.equal(result.netPay, 175);
  result = await getSettlement(db, 'COMP-A', settlement.id);
  assert.equal(result.statement.loads[0].moveOrigin, 'Bayport — Port road');
  assert.equal(result.statement.loads[0].moveDestination, 'Custom delivery address');
  await transitionSettlement(db, 'COMP-A', settlement.id, { action: 'review' }, 'Payroll');
  await assert.rejects(addSettlementLoad(db, 'COMP-A', settlement.id, input), /locked|editable/i);
  result = await getSettlement(db, 'COMP-A', settlement.id);
  assert.equal(result.statement.loads[0].moveDestination, 'Custom delivery address');
  assert.equal(await addSettlementLoad(db, 'COMP-B', settlement.id, input), null);
});
test('adding completed movement with route details does not rewrite the original movement or pay', async t => {
  const { db, settlement } = await fixture(t);
  await dbRun(db, "INSERT INTO loads(id,companyId,driver,status,containerNumber) VALUES('L1','COMP-A','DRV-A','Completed','MRKU123456')");
  await dbRun(db, "INSERT INTO load_moves(id,companyId,loadId,driverId,completedBy,status,completedAt,driverRate,moveType,origin,destination) VALUES('M1','COMP-A','L1','DRV-A','DRV-A','Completed','2026-09-01','225','DELIVERY','Original port','Original customer')");
  const original = await dbGet(db, "SELECT * FROM load_moves WHERE id='M1'");
  const result = await addSettlementLoad(db, 'COMP-A', settlement.id, { moveId: 'M1', description: 'Missed move', pickupLocation: 'Named pickup', deliveryLocation: 'Named delivery' });
  assert.equal(result.statement.loads[0].moveOrigin, 'Named pickup');
  assert.equal(result.statement.loads[0].moveDestination, 'Named delivery');
  assert.equal(result.statement.loads[0].payAmount, 225);
  assert.deepEqual(await dbGet(db, "SELECT * FROM load_moves WHERE id='M1'"), original);
  await assert.rejects(addSettlementLoad(db, 'COMP-A', settlement.id, { moveId: 'M1', description: 'Duplicate' }), /already included/);
});
test('route save failure rolls back the payment; old inputs still work without locations', async t => {
  const { db, settlement } = await fixture(t);
  await dbRun(db, "CREATE TRIGGER reject_test_route BEFORE INSERT ON settlement_line_routes BEGIN SELECT RAISE(ABORT, 'test route failure'); END");
  await assert.rejects(addSettlementLoad(db, 'COMP-A', settlement.id, { description:'Test',payAmount:100,pickupLocation:'Pickup' }), /test route failure/);
  assert.deepEqual(await dbAll(db, 'SELECT * FROM settlement_loads WHERE settlementId=?', [settlement.id]), []);
  const result = await addSettlementLoad(db, 'COMP-A', settlement.id, { description:'Legacy input',payAmount:50 });
  assert.equal(result.netPay, 50);
  assert.equal(result.statement.loads[0].moveOrigin, '');
});
