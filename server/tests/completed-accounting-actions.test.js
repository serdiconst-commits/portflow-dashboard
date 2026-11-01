import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const batchSource = source.slice(source.indexOf('const handleSendCompletedLoadsToAccounting ='), source.indexOf('const uploadDocumentsForLoad ='));
function setup({confirm=true, failing='', open='', pending=false}={}) {
  const loads=[{id:'A',containerNumber:'CONT-A',driverRate:'150',status:'Completed'},{id:'B',driverRate:'200',status:'Completed'}];
  const state={loads,selected:['A','B'],detail:'A',view:'completed',busy:false,status:'',requests:[],alerts:[]};
  const ctx={completedReviewLoads:loads,accountingExtraChargesOpenLoadId:open, completedSendPending:{current:pending},
    window:{confirm:()=>confirm},alert:m=>state.alerts.push(m),API_BASE:'/test',authToken:'fake',
    setActiveView:()=>assert.fail('Sending must stay in Completed'),
    setCompletedSending:v=>state.busy=v,setCompletedSendStatus:v=>state.status=v,
    setCompletedSelectedIds:f=>state.selected=f(state.selected),setLoadsData:f=>state.loads=f(state.loads),
    setSelectedLoad:()=>{},setSelectedCompletedReviewLoadId:f=>state.detail=f(state.detail),
    fetch:async(url,options)=>{state.requests.push({url,body:JSON.parse(options.body)});const id=url.split('/').at(-2); return {ok:id!==failing,json:async()=>id===failing?{error:'Network rejected'}:{...loads.find(l=>l.id===id),billingStatus:'Ready To Bill'}};},
  };
  const send=vm.runInNewContext(batchSource+'\nhandleSendCompletedLoadsToAccounting',ctx);
  return {state,ctx,send,loads};
}
test('batch sends unique eligible loads, keeps driver pay and Completed view', async()=>{
 const {state,send,loads}=setup();await send([...loads,loads[0],{id:'stale'}]);
 assert.equal(state.requests.length,2);assert.ok(state.requests.every(r=>r.body.billingStatus==='Ready To Bill'));
 assert.deepEqual(state.selected,[]);assert.equal(state.view,'completed');assert.equal(state.busy,false);
 assert.equal(state.loads[0].driverRate,'150');assert.equal(state.loads[1].driverRate,'200');assert.match(state.status,/2 loads sent/);
});
test('partial failure keeps unsuccessful selection for retry and reports the error',async()=>{
 const {state,send,loads}=setup({failing:'B'});await send(loads);
 assert.deepEqual(state.selected,['B']);assert.equal(state.loads[0].billingStatus,'Ready To Bill');assert.equal(state.loads[1].billingStatus,undefined);
 assert.match(state.status,/1 load sent.*1 failed: B: Network rejected/);assert.equal(state.busy,false);
});
for (const options of [{confirm:false},{open:'A'},{pending:true}]) test(`cancelled, unsaved or duplicate batch makes no requests: ${JSON.stringify(options)}`,async()=>{
 const {state,send,loads}=setup(options);await send(loads);assert.equal(state.requests.length,0);
});
for(const confirm of [false,true]) test(`restore ${confirm?'requires warning and preserves existing pay/documents':'cancel makes no change'}`,async()=>{
 const handler=source.slice(source.indexOf('const handleRestoreCompletedLoad ='),source.indexOf('const handleSendCompletedLoadsToAccounting ='));
 const original={id:'LD-1',status:'Completed',driver:'DR-1',driverRate:'225',documents:[{id:'POD'}],billingStatus:''};
 let sent;let message;let refreshed=false;
 const ctx={window:{confirm:m=>{message=m;return confirm;}},normalizeDriverForStorage:v=>v,
 API_BASE:'/test',authToken:'fake',fetch:async(_url,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>sent};},
 setLoadsData:()=>{},setSelectedAccountingLoadId:()=>{},setSelectedCompletedReviewLoadId:()=>{},setCompletedSelectedIds:()=>{},setSelectedLoad:()=>{},setEditingLoad:()=>{},fetchLoads:async()=>{refreshed=true;},alert:()=>{},console};
 await vm.runInNewContext(handler+'\nhandleRestoreCompletedLoad',ctx)(original);
 assert.match(message,/⚠️/);assert.match(message,/payroll records will be kept/);
 if(confirm){assert.equal(sent.status,'Dispatched');assert.equal(sent.driverRate,'225');assert.deepEqual(sent.documents,original.documents);assert.equal(refreshed,true);}else{assert.equal(sent,undefined);assert.equal(refreshed,false);}
});
