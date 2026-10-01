import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbGet, dbAll } from '../services/dbUtils.js';
import { createSettlement } from '../services/driverSettlements.js';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('const updateCurrentMoveForLoadStatus ='), source.indexOf("app.put('/api/loads/:id/status'"));
const assignment = source.slice(source.indexOf("app.put('/api/load-moves/:id/assign'"), source.indexOf("app.put('/api/load-moves/:id/rate'"));

for (const deliveryDriver of ['DRV-A', 'DRV-C']) {
  test(`pre-pull and next-week delivery retain separate dates and pay for ${deliveryDriver}`, async (t) => {
    const db = await createDb();
    t.after(() => new Promise(resolve => db.close(resolve)));
    for (const col of ['workflowType', 'pickup', 'delivery', 'returnLocation']) await dbRun(db, `ALTER TABLE loads ADD COLUMN ${col} TEXT`);
    await dbRun(db, "INSERT INTO drivers (id,companyId,name) VALUES ('DRV-C','COMP-A','Driver C')");
    await dbRun(db, `INSERT INTO loads (id,companyId,driver,driverRate,status,workflowType,pickup,delivery,returnLocation,deletedAt)
      VALUES ('L1','COMP-A','DRV-A','125','In Transit','PRE_PULL_LIVE','Port','Customer','Empty return','')`);
    for (const [id, sequence, type, status, origin, destination, driver, rate] of [
      ['M1',1,'PRE_PULL','In Transit','Port','Yard','DRV-A','100'],
      ['M2',2,'DELIVERY','Planned','Yard','Customer','',''],
      ['M3',3,'RETURN','Planned','Customer','Empty return','',''],
    ]) await dbRun(db, `INSERT INTO load_moves (id,companyId,loadId,sequence,moveType,status,origin,destination,driverId,driverRate,startedAt,completedAt,completedBy)
      VALUES (?,'COMP-A','L1',?,?,?,?,?,?,?,'','','')`, [id,sequence,type,status,origin,destination,driver,rate]);
    let assign;
    const context = {
      db, console, Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-06T18:00:00Z'])); } },
      writeAuditLog() {}, syncLoadMoves: () => assert.fail('Existing movements must be preserved'),
      app: { put: (_path, ...handlers) => { assign = handlers.at(-1); } },
      authenticate() {}, requireRoles: () => () => {}, dispatchLocationRoles: [],
      normalizeDriverAssignment: (_company, driver, callback) => callback(null, driver),
    };
    vm.createContext(context);
    vm.runInContext(`${helper}\nthis.complete = updateCurrentMoveForLoadStatus;\n${assignment}`, context);
    const request = { company: { companyId: 'COMP-A' }, user: { role: 'dispatcher', driverId: 'DISPATCH-NOT-DRIVER' }, body: { dropDateTime: '2026-09-29T18:00:00Z' } };
    const assignRequest = (companyId = 'COMP-A') => new Promise(resolve => {
      let code = 200;
      assign({ params: { id: 'M2' }, company: { companyId }, body: { driverId: deliveryDriver, driverRate: '275', returnLocation: 'Customer' } },
        { status(value) { code = value; return this; }, json(body) { resolve({ code, body }); } });
    });
    assert.equal((await assignRequest()).code, 409, 'cannot assign delivery before the yard drop');
    await new Promise((resolve, reject) => context.complete(request, 'L1', 'Dropped', err => err ? reject(err) : resolve()));
    const prePull = await dbGet(db, "SELECT * FROM load_moves WHERE id='M1'");
    assert.equal(prePull.completedAt, '2026-09-29T18:00:00.000Z');
    assert.equal(prePull.completedBy, 'DRV-A');
    assert.equal(prePull.driverRate, '125');
    const atYard = await dbGet(db, "SELECT * FROM loads WHERE id='L1'");
    assert.equal(atYard.status, 'Dropped');
    assert.equal(atYard.driver, '');
    const firstWeek = await createSettlement(db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-09-28', periodEnd: '2026-10-04' }, 'Dispatcher');
    assert.deepEqual(await dbAll(db, 'SELECT moveId,payAmount FROM settlement_loads WHERE settlementId=?', [firstWeek.id]), [{ moveId: 'M1', payAmount: 125 }]);
    assert.equal((await assignRequest('COMP-B')).code, 404);
    assert.equal((await assignRequest()).code, 200);
    const assigned = await dbGet(db, "SELECT * FROM loads WHERE id='L1'");
    assert.equal(assigned.driver, deliveryDriver);
    assert.equal(assigned.pickup, 'Yard');
    assert.equal(assigned.delivery, 'Customer');
    assert.equal(assigned.returnLocation, 'Empty return');
    await new Promise((resolve, reject) => context.complete({ ...request, body: {} }, 'L1', 'Delivered', err => err ? reject(err) : resolve()));
    assert.deepEqual(await dbGet(db, "SELECT * FROM load_moves WHERE id='M1'"), prePull);
    const delivery = await dbGet(db, "SELECT * FROM load_moves WHERE id='M2'");
    assert.equal(delivery.completedAt, '2026-10-06T18:00:00.000Z');
    assert.equal(delivery.completedBy, deliveryDriver);
    assert.equal(delivery.driverRate, '275');
    for (const [driverId, periodStart, periodEnd, expectedMove, pay] of [
      ['DRV-A','2026-09-28','2026-10-04','M1',125],
      [deliveryDriver,'2026-10-05','2026-10-11','M2',275],
    ]) {
      const settlement = await createSettlement(db, 'COMP-A', { driverId, periodStart, periodEnd }, 'Dispatcher');
      const lines = await dbAll(db, 'SELECT moveId,payAmount FROM settlement_loads WHERE settlementId=?', [settlement.id]);
      assert.deepEqual(lines, [{ moveId: expectedMove, payAmount: pay }]);
    }
  });
}
