import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbAll } from '../services/dbUtils.js';
import { ensureDriverNotifications, collectDriverNotifications, deliverDriverNotifications, relevantDriverAudit } from '../services/driverNotifications.js';
import { driverPushPayload, pushConfigured } from '../services/driverPushProvider.js';
import { newerVersion, driverLoadChanges, safeStoreUrl } from '../../shared/driverAlerts.js';

async function fixture(t) {
  const db = await createDb(); t.after(() => new Promise(resolve => db.close(resolve)));
  await dbRun(db, 'ALTER TABLE drivers ADD COLUMN isActive INTEGER DEFAULT 1');
  await dbRun(db, "INSERT INTO loads(id,companyId,driver,status) VALUES('L1','COMP-A','DRV-A','Dispatched')");
  await ensureDriverNotifications(db);
  for (const [token, company, driver] of [['TOKEN-A','COMP-A','DRV-A'], ['TOKEN-B','COMP-B','DRV-B']]) await dbRun(db, 'INSERT INTO driver_push_devices VALUES(?,?,?,?,?)', [token,'android',company,driver,new Date().toISOString()]);
  return db;
}
const audit = async (db, id='AUDIT1', role='dispatcher') => dbRun(db, `INSERT INTO audit_logs(id,companyId,userRole,action,entityType,entityId,changedFields,newValue,createdAt) VALUES(?,'COMP-A',?,'UPDATE','LOAD','L1',?,? ,?)`, [id,role,JSON.stringify({delivery:{old:'A',new:'B'}}),JSON.stringify({delivery:'B'}),new Date().toISOString()]);

test('dispatch update queues only assigned driver devices in the same company and is not repeated', async t => {
  const db = await fixture(t); await audit(db); await collectDriverNotifications(db); await collectDriverNotifications(db);
  const rows = await dbAll(db,'SELECT * FROM driver_push_queue');
  assert.equal(rows.length,1); assert.equal(rows[0].token,'TOKEN-A');
  const sent=[]; await deliverDriverNotifications(db,async (device,event)=>sent.push([device.token,event.id]),()=>true);
  assert.deepEqual(sent,[['TOKEN-A','AUDIT1']]); assert.equal((await dbAll(db,'SELECT * FROM driver_push_queue')).length,0);
});
test('driver status actions do not create dispatch alerts; irrelevant edits are ignored', async t => {
  const db = await fixture(t); await audit(db,'DRIVER-ACTION','driver'); await collectDriverNotifications(db);
  assert.equal((await dbAll(db,'SELECT * FROM driver_push_queue')).length,0);
  assert.equal(relevantDriverAudit({entityType:'LOAD',userRole:'dispatcher',changedFields:'{"rate":{}}',action:'UPDATE'}),false);
});
test('releasing a load to the driver queues a notification', async t => {
  const db = await fixture(t);
  await dbRun(db, `INSERT INTO audit_logs(id,companyId,userRole,action,entityType,entityId,changedFields,newValue,createdAt)
    VALUES('RELEASE1','COMP-A','dispatcher','RELEASE_TO_DRIVER','LOAD','L1',?,?,?)`,
    [JSON.stringify({isDriverReleased:{oldValue:0,newValue:1}}), JSON.stringify({isDriverReleased:1}), new Date().toISOString()]);
  await collectDriverNotifications(db);
  const rows = await dbAll(db, 'SELECT * FROM driver_push_queue');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].auditId, 'RELEASE1');
});
test('logged-out or transferred tokens never receive queued work for a previous account', async t => {
  const db = await fixture(t); await audit(db); await collectDriverNotifications(db);
  await dbRun(db,"UPDATE driver_push_devices SET companyId='COMP-B',driverId='DRV-B' WHERE token='TOKEN-A'");
  await deliverDriverNotifications(db,async()=>assert.fail('must not send'),()=>true);
  assert.equal((await dbAll(db,'SELECT * FROM driver_push_queue')).length,0);
});
test('transient failures retry, permanently unregistered devices are removed', async t => {
  const db = await fixture(t); await audit(db); await collectDriverNotifications(db);
  await deliverDriverNotifications(db,async()=>{throw new Error('network');},()=>true);
  assert.equal((await dbAll(db,'SELECT * FROM driver_push_queue'))[0].attempts,1);
  await dbRun(db,"UPDATE driver_push_queue SET nextAttempt='2000-01-01'");
  await deliverDriverNotifications(db,async()=>{throw Object.assign(new Error('unregistered'),{permanent:true});},()=>true);
  assert.equal((await dbAll(db,"SELECT * FROM driver_push_devices WHERE token='TOKEN-A'")).length,0);
});
test('native push payloads include audible background notification and remain disabled without configuration',()=>{
  assert.equal(driverPushPayload('ios',{id:'A'}).aps.sound,'driver_alert.wav');
  assert.equal(driverPushPayload('android',{id:'A'}).android.notification.channel_id,'driver-dispatch-v1');
  assert.ok(driverPushPayload('android',{id:'A'}).notification.body);
  assert.equal(pushConfigured('ios',{}),false);
  assert.equal(pushConfigured('android',{DRIVER_PUSH_ENABLED:'true',FCM_SERVICE_ACCOUNT_PATH:'/secret.json'}),true);
});
test('update notice uses numeric store versions and only trusted store links',()=>{
  assert.equal(newerVersion('1.0.9','1.0.10'),true);
  assert.equal(newerVersion('1.0.10','1.0.9'),false);
  assert.equal(newerVersion('1.0.10','1.0.10'),false);
  assert.equal(newerVersion('1.0.10',''),false);
  assert.equal(safeStoreUrl('https://example.com','ios'),'');
  assert.equal(safeStoreUrl('https://apps.apple.com/app/id123','ios'),'https://apps.apple.com/app/id123');
});
test('route and appointment changes alert; paperwork refresh alone does not',()=>{
  assert.deepEqual(driverLoadChanges({pickup:'A'},{pickup:'B'}),['pickup']);
  assert.deepEqual(driverLoadChanges({appointmentTime:'2026-09-01'},{appointmentTime:'2026-09-02'}),['appointmentTime']);
  assert.deepEqual(driverLoadChanges({paperworkStatus:'Missing'},{paperworkStatus:'Complete'}),[]);
  assert.deepEqual(driverLoadChanges({currentMove:{origin:'A'}},{currentMove:{origin:'B'}}),['movement.origin']);
});
test('Drop sends no request until confirmation and duplicate confirmation does not send twice', async()=>{
  const source = await readFile(new URL('../../src/App.jsx',import.meta.url),'utf8');
  const code = source.slice(source.indexOf('const handleDriverStatusUpdate ='),source.indexOf('const setDriverEquipmentDraft ='));
  const load={id:'L1',containerNumber:'TEST123',driver:'DRV-A'};
  const pending={current:new Set()}; let opened, requests=0, release;
  const context={driverStatusPendingRef:pending,loadsData:[load],setDriverDropLoad:value=>{opened=value;},hasRequiredDriverDocuments:()=>true,API_BASE:'',authToken:'test',fetch:async()=>{requests++;await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>({})};},setLoadsData:()=>{},fetchLoads:async()=>{},alert:()=>{},normalizeDriverForStorage:v=>v};
  const handler=new Function(...Object.keys(context),`${code};return handleDriverStatusUpdate;`)(...Object.values(context));
  await handler('L1','Dropped'); assert.equal(opened,load); assert.equal(requests,0);
  const first=handler('L1','Dropped',true); await handler('L1','Dropped',true); assert.equal(requests,1);release();await first;
  assert.equal(pending.current.size,0);
});
