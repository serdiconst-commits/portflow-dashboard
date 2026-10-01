import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbGet } from '../services/dbUtils.js';
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const route = source.slice(source.indexOf("app.get('/api/loads',"), source.indexOf("app.put('/api/loads/:id/driver-release'"));
test('installed Driver receives Completed without POD as terminal while stored status and tenant scope remain intact', async t => {
  const db = await createDb();
  t.after(() => new Promise(resolve => db.close(resolve)));
  await dbRun(db, 'ALTER TABLE loads ADD COLUMN isDriverReleased INTEGER DEFAULT 1');
  for (const [id, company, driver, status] of [
    ['OWN','COMP-A','DRV-A','Completed'], ['ACTIVE','COMP-A','DRV-A','Dispatched'],
    ['FOREIGN','COMP-B','DRV-A','Completed'], ['OTHER-DRIVER','COMP-A','DRV-B','Completed'],
  ]) await dbRun(db, 'INSERT INTO loads(id,companyId,driver,status) VALUES (?,?,?,?)', [id,company,driver,status]);
  let handler;
  vm.runInNewContext(route, {
    app: { get: (_path,...handlers) => { handler=handlers.at(-1); } }, db, authenticate() {}, console,
    attachDocumentsToLoads: (rows,cb) => cb(null,rows.map(row => ({...row,documents:[]}))),
    attachMovesToLoads: (rows,cb) => cb(null,rows),
  });
  const loads = await new Promise(resolve => handler({ user: {role:'driver',driverId:'DRV-A'},company:{companyId:'COMP-A'},query:{} }, { json: resolve }));
  assert.deepEqual(loads.map(load=>load.id).sort(), ['ACTIVE','OWN']);
  assert.equal(loads.find(load=>load.id==='OWN').status,'Delivered');
  assert.equal(loads.find(load=>load.id==='ACTIVE').status,'Dispatched');
  assert.equal((await dbGet(db,"SELECT status FROM loads WHERE id='OWN'")).status,'Completed');
});
