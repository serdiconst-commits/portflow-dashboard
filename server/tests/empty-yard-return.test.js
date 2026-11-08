import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createDb } from './fixtures/payrollDb.js';
import { dbRun, dbAll, dbGet } from '../services/dbUtils.js';
import { planEmptyYard, assignEmptyYard, setEmptyYardStatus } from '../services/emptyYard.js';
import { createSettlement } from '../services/driverSettlements.js';
import { reconcileLoadMoves } from '../loadMovePlan.js';
async function setup(t, {pendingDelivery=false, workflow='LIVE_DELIVERY', returnType='RETURN'}={}) {
 const db=await createDb();t.after(()=>new Promise(resolve=>db.close(resolve)));
 for(const col of ['workflowType','pickup','delivery','returnLocation','loadType','billingStatus']) await dbRun(db,`ALTER TABLE loads ADD COLUMN ${col} TEXT`);
 await dbRun(db,'ALTER TABLE loads ADD COLUMN isDriverReleased INTEGER DEFAULT 1');
 await dbRun(db,"INSERT INTO drivers(id,companyId,name,truck) VALUES ('DRV-C','COMP-A','Driver C','C1')");
 await dbRun(db,`INSERT INTO loads(id,companyId,driver,truck,driverRate,status,workflowType,pickup,delivery,returnLocation,loadType,billingStatus,deletedAt) VALUES('L1','COMP-A','DRV-A','A1','150',?,?, 'Port','Customer','Port Return','','','')`,[pendingDelivery?'In Transit':'Delivered',workflow]);
 await dbRun(db,`INSERT INTO load_moves(id,companyId,loadId,sequence,moveType,status,origin,destination,driverId,driverRate,startedAt,completedAt,completedBy) VALUES('M1','COMP-A','L1',1,'LIVE_DELIVERY',?,'Port','Customer','DRV-A','150',?,?,?)`,[pendingDelivery?'In Transit':'Completed','2026-11-01T12:00:00Z',pendingDelivery?'':'2026-11-01T14:00:00Z',pendingDelivery?'':'DRV-A']);
 await dbRun(db,`INSERT INTO load_moves(id,companyId,loadId,sequence,moveType,status,origin,destination,driverId,driverRate,startedAt) VALUES('M2','COMP-A','L1',2,?,?,'Customer','Port Return','','','')`,[returnType,returnType==='PICKUP_RETURN'?'Waiting Customer':'Planned']);
 return db;
}
for(const driver of ['DRV-A','DRV-C']) test(`empty to yard then return preserves separate drivers and payroll: ${driver}`,async t=>{
 const db=await setup(t);const before=await dbGet(db,"SELECT * FROM load_moves WHERE id='M1'");
 const plan=await planEmptyYard(db,'COMP-A','L1',{yard:'Main Yard',returnLocation:'Port Return'});
 assert.equal((await dbGet(db,"SELECT status FROM loads WHERE id='L1'")).status,'Pending');
 await assert.rejects(assignEmptyYard(db,'COMP-A',plan.returnId,{driverId:driver,driverRate:'80'}),/previous movement/);
 await assignEmptyYard(db,'COMP-A',plan.moveId,{driverId:driver,driverRate:'75'});
 await assert.rejects(setEmptyYardStatus(db,'COMP-A','L1','Dropped',{role:'driver',driverId:'DRV-WRONG'}),/assigned to you/);
 await setEmptyYardStatus(db,'COMP-A','L1','Dropped',{role:'driver',driverId:driver});
 const atYard=await dbGet(db,"SELECT * FROM loads WHERE id='L1'");assert.equal(atYard.status,'Dropped');assert.equal(atYard.driver,'');
 await assignEmptyYard(db,'COMP-A',plan.returnId,{driverId:'DRV-A',driverRate:'85'});
 await assert.rejects(setEmptyYardStatus(db,'COMP-A','L1','Dropped',{role:'driver',driverId:'DRV-A'}),/Delivered/);
 await setEmptyYardStatus(db,'COMP-A','L1','Delivered',{role:'driver',driverId:'DRV-A'});
 assert.equal((await dbGet(db,"SELECT status FROM loads WHERE id='L1'")).status,'Delivered');
 assert.deepEqual(await dbGet(db,"SELECT * FROM load_moves WHERE id='M1'"),before);
 const moves=await dbAll(db,"SELECT * FROM load_moves WHERE loadId='L1' ORDER BY sequence");
 assert.deepEqual(moves.map(move=>[move.moveType,move.origin,move.destination]),[['LIVE_DELIVERY','Port','Customer'],['EMPTY_YARD','Customer','Main Yard'],['YARD_RETURN','Main Yard','Port Return']]);
 assert.equal(moves[1].completedBy,driver);assert.equal(moves[1].driverRate,'75');assert.equal(moves[2].completedBy,'DRV-A');
 const today=moves[1].completedAt.slice(0,10);
 for(const id of new Set([driver,'DRV-A'])) {
   const settlement=await createSettlement(db,'COMP-A',{driverId:id,periodStart:today,periodEnd:today},'Dispatcher');
   const lines=await dbAll(db,'SELECT moveId,payAmount FROM settlement_loads WHERE settlementId=? ORDER BY payAmount',[settlement.id]);
   assert.deepEqual(lines,[...(driver===id?[{moveId:plan.moveId,payAmount:75}]:[]),...(id==='DRV-A'?[{moveId:plan.returnId,payAmount:85}]:[])]);
 }
 assert.deepEqual(reconcileLoadMoves(atYard,moves,[],{...atYard,driver:'old'}),moves);
});
test('tenant scope, duplicate plans, invalid pay and drivers never change history',async t=>{
 const db=await setup(t);const original=await dbAll(db,'SELECT * FROM load_moves');
 await assert.rejects(planEmptyYard(db,'COMP-B','L1',{yard:'Yard',returnLocation:'Port'}),/not found/);
 assert.deepEqual(await dbAll(db,'SELECT * FROM load_moves'),original);
 const plan=await planEmptyYard(db,'COMP-A','L1',{yard:'Yard',returnLocation:'Port'});
 await assert.rejects(planEmptyYard(db,'COMP-A','L1',{yard:'Yard',returnLocation:'Port'}),/already has/);
 await assert.rejects(assignEmptyYard(db,'COMP-A',plan.moveId,{driverId:'DRV-B',driverRate:'50'}),/company/);
 await assert.rejects(assignEmptyYard(db,'COMP-A',plan.moveId,{driverId:'DRV-A',driverRate:'-50'}),/non-negative/);
 assert.equal((await dbGet(db,'SELECT status FROM load_moves WHERE id=?',[plan.moveId])).status,'Planned');
});
test('Drop & Pick splits the empty pickup/return without altering completed drop',async t=>{
 const db=await setup(t,{workflow:'DROP_AND_PICK',returnType:'PICKUP_RETURN'});
 await planEmptyYard(db,'COMP-A','L1',{yard:'Yard',returnLocation:'Port'});
 assert.equal((await dbGet(db,"SELECT moveType FROM load_moves WHERE id='M2'")).moveType,'EMPTY_YARD');
});
test('completing delivery hands off to empty-yard work without closing the load',async t=>{
 const db=await setup(t,{pendingDelivery:true});
 const plan=await planEmptyYard(db,'COMP-A','L1',{yard:'Yard',returnLocation:'Port'});
 await assert.rejects(assignEmptyYard(db,'COMP-A',plan.moveId,{driverId:'DRV-A',driverRate:'50'}),/previous movement/);
 const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('const updateCurrentMoveForLoadStatus ='),source.indexOf("app.put('/api/loads/:id/status'"));
 const complete=vm.runInNewContext(helper+'\nupdateCurrentMoveForLoadStatus',{db,Date,writeAuditLog:()=>{},syncLoadMoves:()=>assert.fail('Do not rebuild the plan')});
 await new Promise((resolve,reject)=>complete({company:{companyId:'COMP-A'},user:{role:'dispatcher'},body:{}},'L1','Delivered',error=>error?reject(error):resolve()));
 assert.equal((await dbGet(db,"SELECT status FROM loads WHERE id='L1'")).status,'Pending');
 await assignEmptyYard(db,'COMP-A',plan.moveId,{driverId:'DRV-A',driverRate:'50'});
});
for(const change of ["UPDATE loads SET loadType='EXPORT'", "UPDATE loads SET billingStatus='Ready To Bill'", "UPDATE load_moves SET status='Assigned',driverId='DRV-A' WHERE id='M2'", "INSERT INTO invoices(companyId,loadId) VALUES('COMP-A','L1')"]) test('unsafe plan rejected: '+change,async t=>{
 const db=await setup(t);await dbRun(db,change);const before=await dbAll(db,'SELECT * FROM load_moves');
 await assert.rejects(planEmptyYard(db,'COMP-A','L1',{yard:'Yard',returnLocation:'Port'}));
 assert.deepEqual(await dbAll(db,'SELECT * FROM load_moves'),before);
});
test('HTTP routes preserve role/release/POD checks and prevent broad-edit bypasses',async t=>{
 const {default:express}=await import('express');
 const {mountEmptyYardRoutes}=await import('../services/emptyYard.js');
 const db=await setup(t);const app=express();app.use(express.json());
 const authenticate=(req,_res,next)=>{req.company={companyId:req.headers['x-company'] || 'COMP-A'};req.user={role:req.headers['x-role'] || 'dispatcher',driverId:req.headers['x-driver'] || ''};next();};
 const requireRoles=roles=>(req,res,next)=>roles.has(req.user.role)?next():res.status(403).json({error:'Not allowed'});
 const audit=[];
 mountEmptyYardRoutes(app,{db,authenticate,requireRoles,dispatchLocationRoles:new Set(['dispatcher']),writeAuditLog:(_req,event)=>audit.push(event),hasRequiredCompletionDocuments:docs=>docs.some(doc=>doc.category==='POD')});
 app.put('/api/load-moves/:id/assign',(_req,res)=>res.json({legacy:true}));
 app.put('/api/loads/:id/status',(_req,res)=>res.json({legacy:true}));
 app.put('/api/loads/:id',(_req,res)=>res.json({legacy:true}));
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=async(path,method,body={},headers={})=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 const planBody={yard:'Yard',returnLocation:'Port'};
 assert.equal((await call('/api/loads/L1/empty-yard','POST',planBody,{'x-role':'driver'})).status,403);
 assert.equal((await call('/api/loads/L1/empty-yard','POST',planBody,{'x-company':'COMP-B'})).status,404);
 const {body:plan,status}=await call('/api/loads/L1/empty-yard','POST',planBody);assert.equal(status,200);
 assert.equal((await call('/api/loads/L1','PUT',{status:'Completed'})).status,409);
 assert.equal((await call('/api/loads/L1/status','PUT',{status:'Dropped'})).status,409);
 assert.equal((await call(`/api/load-moves/${plan.moveId}/assign`,'PUT',{driverId:'DRV-A',driverRate:'55'})).status,200);
 assert.equal((await call('/api/loads/L1/status','PUT',{status:'Dropped'},{'x-role':'payroll'})).status,403);
 await dbRun(db,"UPDATE loads SET isDriverReleased=0 WHERE id='L1'");
 const driverHeaders={'x-role':'driver','x-driver':'DRV-A'};
 assert.equal((await call('/api/loads/L1/status','PUT',{status:'Dropped'},driverHeaders)).status,403);
 await dbRun(db,"UPDATE loads SET isDriverReleased=1 WHERE id='L1'");
 assert.equal((await call('/api/loads/L1/status','PUT',{status:'Dropped'},driverHeaders)).body.status,'Dropped');
 assert.equal((await call(`/api/load-moves/${plan.returnId}/assign`,'PUT',{driverId:'DRV-C',driverRate:'65'})).status,200);
 assert.equal((await call('/api/loads/L1/status','PUT',{status:'Delivered'},{'x-role':'driver','x-driver':'DRV-C'})).status,400);
 await dbRun(db,"INSERT INTO documents(id,loadId,category)VALUES('POD','L1','POD')");
 assert.equal((await call('/api/loads/L1/status','PUT',{status:'Delivered'},{'x-role':'driver','x-driver':'DRV-C'})).body.status,'Delivered');
 assert.ok(audit.some(event=>event.action==='EMPTY_YARD_PLAN'));
 assert.ok(audit.some(event=>event.action==='EMPTY_YARD_ASSIGN'));
 assert.ok(audit.some(event=>event.action==='EMPTY_YARD_STATUS'));
 assert.equal((await call('/api/load-moves/UNKNOWN/assign','PUT')).body.legacy,true);
});
test('failed plan insertion rolls back the split and load changes',async t=>{
 const db=await setup(t);const before=await dbAll(db,'SELECT * FROM load_moves');
 await dbRun(db,`CREATE TRIGGER reject_empty_return BEFORE INSERT ON load_moves WHEN NEW.moveType='YARD_RETURN' BEGIN SELECT RAISE(ABORT,'Test failure'); END`);
 await assert.rejects(planEmptyYard(db,'COMP-A','L1',{yard:'Yard',returnLocation:'Port'}),/Test failure/);
 assert.deepEqual(await dbAll(db,'SELECT * FROM load_moves'),before);
 assert.equal((await dbGet(db,"SELECT status FROM loads WHERE id='L1'")).status,'Delivered');
});
