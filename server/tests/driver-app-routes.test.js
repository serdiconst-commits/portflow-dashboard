import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDb } from './fixtures/payrollDb.js';
import { dbAll } from '../services/dbUtils.js';
import createDriverAppRoutes from '../routes/driverApp.js';

test('release, device registration and logout enforce version and tenant boundaries', async t => {
  const db=await createDb();t.after(()=>new Promise(resolve=>db.close(resolve)));
  const names=['DRIVER_PUSH_ENABLED','FCM_SERVICE_ACCOUNT_PATH','DRIVER_ANDROID_LATEST_VERSION','DRIVER_ANDROID_STORE_URL'];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const name of names) saved[name]===undefined?delete process.env[name]:process.env[name]=saved[name];});
  Object.assign(process.env,{DRIVER_PUSH_ENABLED:'true',FCM_SERVICE_ACCOUNT_PATH:'/not-read-in-route-test.json',DRIVER_ANDROID_LATEST_VERSION:'1.0.40',DRIVER_ANDROID_STORE_URL:'https://play.google.com/store/apps/details?id=com.portflow.driverapp'});
  const app=express();app.use(express.json());
  app.use('/api/driver-app',createDriverAppRoutes(db,(req,res,next)=>{
    if(!req.headers.authorization)return res.sendStatus(401);
    const other=req.headers.authorization==='other';
    req.user={role:req.headers['x-role']||'driver',driverId:other?'DRV-B':'DRV-A'};
    req.company={companyId:other?'COMP-B':'COMP-A'};next();
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/driver-app`;
  const request=(method,body,auth='driver',role='driver')=>fetch(base+'/devices',{method,headers:{Authorization:auth,'x-role':role,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const release=await fetch(base+'/release?platform=android');assert.match(release.headers.get('cache-control'),/no-store/);assert.equal((await release.json()).version,'1.0.40');
  const device={token:'test-fcm-token-123456789012345',platform:'android'};
  assert.equal((await request('PUT',device,'','driver')).status,401);
  assert.equal((await request('PUT',device,'dispatcher','dispatcher')).status,403);
  assert.equal((await request('PUT',{...device,platform:'web'})).status,400);
  assert.equal((await request('PUT',device)).status,200);
  assert.equal((await request('DELETE',device,'other')).status,200);
  assert.equal((await dbAll(db,'SELECT * FROM driver_push_devices')).length,1);
  assert.equal((await request('DELETE',device)).status,200);
  assert.equal((await dbAll(db,'SELECT * FROM driver_push_devices')).length,0);
  process.env.DRIVER_PUSH_ENABLED='false';assert.equal((await request('PUT',device)).status,503);
});
