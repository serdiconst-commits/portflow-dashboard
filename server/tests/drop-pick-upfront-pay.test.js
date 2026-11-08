import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDb } from './fixtures/payrollDb.js';
import { dbGet,dbRun,dbAll } from '../services/dbUtils.js';
import { prepareDropPickCreationPay,dropPickDraftPay } from '../../shared/dropPickPay.js';
import { prepareDuplicateForSave } from '../../shared/duplicateLoads.js';
import { reconcileLoadMoves } from '../loadMovePlan.js';
import { createSettlement } from '../services/driverSettlements.js';
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../../src/App.jsx',import.meta.url),'utf8');
const createSource=source.slice(source.indexOf("app.post('/api/loads',"),source.indexOf('\napp.',source.indexOf("app.post('/api/loads',")+1));
const helpers=source.slice(source.indexOf('const LOAD_WORKFLOWS ='),source.indexOf('const attachMovesToLoads ='));
const completion=source.slice(source.indexOf('const updateCurrentMoveForLoadStatus ='),source.indexOf("app.put('/api/loads/:id/status'"));
const readyAssign=source.slice(source.indexOf("app.put('/api/load-moves/:id/ready'"),source.indexOf("app.put('/api/load-moves/:id/rate'"));
async function fixture(t) {
 const db=await createDb();t.after(()=>new Promise(resolve=>db.close(resolve)));
 const columns=createSource.match(/INSERT INTO loads \(([\s\S]*?)\) VALUES/)[1].split(',').map(column=>column.trim());
 const existing=new Set((await dbAll(db,'PRAGMA table_info(loads)')).map(column=>column.name));
 for(const column of columns)if(!existing.has(column))await dbRun(db,`ALTER TABLE loads ADD COLUMN ${column} TEXT`);
 await dbRun(db,"CREATE TABLE counters(name TEXT PRIMARY KEY,value INTEGER)");await dbRun(db,"INSERT INTO counters VALUES('load',0)");
 await dbRun(db,"INSERT INTO drivers(id,companyId,name)VALUES('DRV-C','COMP-A','Driver C')");
 const routes={};const context={db,console,Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-11-10T18:00:00Z']));}},uuidv4:randomUUID,reconcileLoadMoves,
 app:{post:(path,...handlers)=>routes[path]=handlers.at(-1),put:(path,...handlers)=>routes[path]=handlers.at(-1)},
 authenticate:()=>{},requireRoles:()=>()=>{},dispatchLocationRoles:new Set(),prepareDropPickCreationPay,prepareDuplicateForSave,
 normalizeDriverAssignment:(_company,driver,callback)=>callback(null,driver||''),findDuplicateContainerLoad:(_company,_container,_id,callback)=>callback(null,null),
 getStatusAfterDriverAssignment:driver=>driver?'Dispatched':'Pending',isTruthy:Boolean,parseNumericField:Number,auditLogSafeValue:value=>value,writeAuditLog:()=>{},
 attachMovesToLoads:(loads,callback)=>db.all('SELECT * FROM load_moves ORDER BY sequence',[],(error,moves)=>callback(error,loads.map(load=>({...load,moves:moves.filter(move=>move.loadId===load.id)})))),};
 vm.createContext(context);vm.runInContext(helpers+'\n'+createSource+'\n'+completion+'\n'+readyAssign+'\nthis.complete=updateCurrentMoveForLoadStatus;',context);
 const call=(path,body,params={})=>new Promise(resolve=>{let status=200;routes[path]({company:{companyId:'COMP-A'},user:{role:'dispatcher'},body,params},{status:code=>{status=code;return{json:body=>resolve({status,body})};},json:body=>resolve({status,body})});});
 return{db,context,call};
}
for(const pickupDriver of ['DRV-A','DRV-C'])test(`create both rates, complete on separate weeks and pay ${pickupDriver} without overwriting drop`,async t=>{
 const {db,context,call}=await fixture(t);
 const result=await call('/api/loads',{workflowType:'DROP_AND_PICK',driver:'DRV-A',driverRate:'999',dropPay:'125',pickupPay:'80',pickup:'Port',delivery:'Customer',returnLocation:'Return Port',customer:'Test',containerNumber:'TEST'});
 assert.equal(result.status,200);const load=result.body;assert.equal(load.driverRate,'125');assert.equal(Number(load.dropPay),125);assert.equal(Number(load.pickupPay),80);
 assert.deepEqual(Array.from(load.moves,move=>[move.moveType,move.driverRate]),[['DROP','125'],['PICKUP_RETURN','80']]);
 const complete=(status,body={})=>new Promise((resolve,reject)=>context.complete({company:{companyId:'COMP-A'},user:{role:'dispatcher'},body},load.id,status,error=>error?reject(error):resolve()));
 await complete('Dropped',{dropDateTime:'2026-11-03T18:00:00Z'});
 const drop=await dbGet(db,'SELECT * FROM load_moves WHERE id=?',[load.moves[0].id]);
 const week1=await createSettlement(db,'COMP-A',{driverId:'DRV-A',periodStart:'2026-11-02',periodEnd:'2026-11-08'},'Dispatcher');
 assert.deepEqual(await dbAll(db,'SELECT moveId,payAmount FROM settlement_loads WHERE settlementId=?',[week1.id]),[{moveId:drop.id,payAmount:125}]);
 const pickup=load.moves[1];assert.equal((await call('/api/load-moves/:id/ready',{}, {id:pickup.id})).status,200);
 assert.equal((await call('/api/load-moves/:id/assign',{driverId:pickupDriver,returnLocation:'Return Port'},{id:pickup.id})).status,200,'omitted pay preserves the planned pickup pay');
 assert.equal((await dbGet(db,'SELECT driverRate FROM load_moves WHERE id=?',[pickup.id])).driverRate,'80');
 assert.deepEqual(await dbGet(db,'SELECT * FROM load_moves WHERE id=?',[drop.id]),drop);
 await complete('Delivered');
 const week2=await createSettlement(db,'COMP-A',{driverId:pickupDriver,periodStart:'2026-11-09',periodEnd:'2026-11-15'},'Dispatcher');
 assert.deepEqual(await dbAll(db,'SELECT moveId,payAmount FROM settlement_loads WHERE settlementId=?',[week2.id]),[{moveId:pickup.id,payAmount:80}]);
 assert.deepEqual(await dbAll(db,'SELECT moveId,payAmount FROM settlement_loads WHERE settlementId=?',[week1.id]),[{moveId:drop.id,payAmount:125}]);
});
test('zero is saved explicitly and invalid values create no loads',async t=>{
 const {db,call}=await fixture(t);
 for(const value of ['', '-1','NaN','1.999']){
  const result=await call('/api/loads',{workflowType:'DROP_AND_PICK',dropPay:'100',pickupPay:value});assert.equal(result.status,400);
 }
 assert.equal((await dbGet(db,'SELECT COUNT(*) AS count FROM loads')).count,0);
 const result=await call('/api/loads',{workflowType:'DROP_AND_PICK',dropPay:'0',pickupPay:'0',driver:'DRV-A'});
 assert.equal(result.status,200);assert.deepEqual(Array.from(result.body.moves,move=>move.driverRate),['0','0']);
});
test('regular, pre-pull and legacy Drop & Pick creation retain existing behavior',async t=>{
 const {call}=await fixture(t);
 for(const workflowType of ['LIVE_DELIVERY','PRE_PULL_LIVE','DROP_AND_PICK']){
  const result=await call('/api/loads',{workflowType,driver:'DRV-A',driverRate:'175',pickup:'Port',delivery:'Customer'});
  assert.equal(result.status,200);assert.equal(result.body.driverRate,'175');
  if(workflowType==='DROP_AND_PICK')assert.equal(result.body.moves[1].driverRate,'');
 }
 const regular={workflowType:'LIVE_DELIVERY',driverRate:'175',dropPay:'bad',pickupPay:'bad'};assert.equal(prepareDropPickCreationPay(regular),regular);
});
test('duplicate defaults use the original movement rates, not the last assigned load rate',()=>{
 assert.deepEqual(dropPickDraftPay({workflowType:'DROP_AND_PICK',driverRate:'80',moves:[{moveType:'DROP',driverRate:'125'},{moveType:'PICKUP_RETURN',driverRate:'80'}]}),{dropPay:'125',driverRate:'125',pickupPay:'80'});
});
test('driver display selects only the current movement rate even for legacy DropHook loads',()=>{
 const start=appSource.indexOf('{completion && currentMove');const end=appSource.indexOf('</strong>',start);
 const expression=appSource.slice(start+1,end).trim().replace(/\}$/, '');
 for(const [type,rate] of [['DROP','125'],['PICKUP_RETURN','80'],['PICKUP_RETURN','0']]){
  const shown=vm.runInNewContext(expression,{completion:null,currentMove:{moveType:type,driverRate:rate},load:{dropPay:999,pickupPay:888},isEmptyYardMove:()=>false,isDropHookLoad:()=>true,isHookMoveActive:()=>false,formatMoney:value=>Number(value),parseMoney:Number,getDriverPayWithDetention:()=>999});
  assert.equal(shown,Number(rate));
 }
});
