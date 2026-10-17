import { driverCompletedDisplay } from '../../shared/driverCompletedDisplay.js';
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
  await dbRun(db, 'ALTER TABLE loads ADD COLUMN appointmentNumber TEXT');
  for (const [id, company, driver, status] of [
    ['OWN','COMP-A','DRV-A','Completed'], ['ACTIVE','COMP-A','DRV-A','Dispatched'],
    ['FOREIGN','COMP-B','DRV-A','Completed'], ['OTHER-DRIVER','COMP-A','DRV-B','Completed'],
  ]) await dbRun(db, 'INSERT INTO loads(id,companyId,driver,status) VALUES (?,?,?,?)', [id,company,driver,status]);
  await dbRun(db, "UPDATE loads SET appointmentNumber = '001-APT' WHERE id = 'ACTIVE'");
  let handler;
  vm.runInNewContext(route, {
    driverCompletedDisplay,
    app: { get: (_path,...handlers) => { handler=handlers.at(-1); } }, db, authenticate() {}, console,
    attachDocumentsToLoads: (rows,cb) => cb(null,rows.map(row => ({...row,documents:[]}))),
    attachMovesToLoads: (rows,cb) => cb(null,rows.map(row => ({...row,
      driverRate:'275', pickup:'Bayport', delivery:'Carmine', returnLocation:'Bayport',
      currentMove:{moveType:'RETURN',status:'Planned',origin:'Carmine',destination:'Bayport',driverRate:''},
      moves:[{moveType:'LIVE_DELIVERY',status:'Completed',driverId:'DRV-A',completedBy:'DRV-A',origin:'Bayport',destination:'Carmine',driverRate:'275'}],
    }))),
  });
  const loads = await new Promise(resolve => handler({ user: {role:'driver',driverId:'DRV-A'},company:{companyId:'COMP-A'},query:{} }, { json: resolve }));
  assert.deepEqual(loads.map(load=>load.id).sort(), ['ACTIVE','OWN']);
  assert.equal(loads.find(load=>load.id==='OWN').status,'Delivered');
  assert.equal(loads.find(load=>load.id==='ACTIVE').status,'Dispatched');
  assert.equal(loads.find(load=>load.id==='ACTIVE').appointmentNumber,'001-APT');
  const completed = loads.find(load=>load.id==='OWN');
  assert.equal(completed.currentMove.origin,'Bayport');
  assert.equal(completed.currentMove.destination,'Carmine');
  assert.equal(completed.currentMove.driverRate,'275');
  assert.equal(loads.find(load=>load.id==='ACTIVE').currentMove.moveType,'RETURN');
  const dispatchLoads = await new Promise(resolve => handler({ user: {role:'dispatcher'},company:{companyId:'COMP-A'},query:{} }, { json: resolve }));
  const dispatchCompleted = dispatchLoads.find(load=>load.id==='OWN');
  assert.equal(dispatchCompleted.status,'Completed');
  assert.equal(dispatchCompleted.currentMove.moveType,'RETURN');
  assert.equal(dispatchCompleted.currentMove.driverRate,'');
  assert.equal((await dbGet(db,"SELECT status FROM loads WHERE id='OWN'")).status,'Completed');
});
