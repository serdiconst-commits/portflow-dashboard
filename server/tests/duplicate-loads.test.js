import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { unassignDuplicate, createLoadCopies, isExportLoadDraft } from '../../shared/duplicateLoads.js';
const source = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const original = {id:'LD-1',driver:'DR-1',truck:'T1',containerNumber:'CONT1',status:'Dispatched',customer:'Customer',referenceNumber:'REF',pickup:'Port',delivery:'Warehouse',bookingNumber:'BOOK',loadType:'EXPORT',driverRate:'200',rate:'500',notes:'Keep',duplicatedFromLoadId:'LD-1'};
test('copies preserve business fields without mutating source or inheriting assignments', async () => {
 const saved=[];
 const result=await createLoadCopies(original,3,async payload=>({...payload,id:`LD-${saved.length+2}`}), row=>saved.push(row));
 assert.equal(result.created.length,3);assert.equal(result.remaining,0);
 assert.equal(new Set(saved.map(row=>row.id)).size,3);
 for(const row of saved){for(const field of ['driver','truck','containerNumber']) assert.equal(row[field],''); assert.equal(row.status,'Pending');for(const field of ['customer','referenceNumber','bookingNumber','driverRate','rate','notes','loadType']) assert.equal(row[field],original[field]);}
 assert.equal(original.driver,'DR-1');assert.equal(original.containerNumber,'CONT1');
});
test('batch stops on failure and remaining count excludes confirmed copies',async()=>{
 let attempts=0;const saved=[];
 const result=await createLoadCopies(original,4,async payload=>{if(++attempts===3)throw Error('Rejected');return {...payload,id:`LD-${attempts}`};},row=>saved.push(row));
 assert.equal(attempts,3);assert.equal(saved.length,2);assert.equal(result.remaining,2);assert.match(result.error.message,/Rejected/);
});
test('invalid quantities never write',async()=>{
 for(const count of [0,-1,1.5,101,NaN]) await assert.rejects(createLoadCopies(original,count,()=>assert.fail('Unexpected write'),()=>{}));
});
test('normal creation retains explicitly assigned driver and container',async()=>{
 const payload={...original,duplicatedFromLoadId:''};
 await createLoadCopies(payload,1,async row=>{assert.equal(row.driver,'DR-1');assert.equal(row.containerNumber,'CONT1');return row;},()=>{});
});
test('Duplicate opens an unassigned export draft with no documents or billing history',()=>{
 let draft,preset,count;
 const code=source.slice(source.indexOf('const handleDuplicateLoad ='),source.indexOf('const handleUpdateLoad ='));
 const context={unassignDuplicate,emptyLoad:{},getTodayDate:()=> '2026-11-01',setDuplicateCount:v=>count=v,setNewLoad:v=>draft=v,setSelectedPresetName:v=>preset=v,setSelectedLoad:()=>{},setIsEditing:()=>{},setShowForm:()=>{},window:{setTimeout:()=>{}}};
 vm.runInNewContext(code+'\nhandleDuplicateLoad',context)({...original,documents:[{id:'POD'}],billingStatus:'Ready To Bill'});
 assert.equal(count,1);assert.equal(preset,'Export Load');assert.equal(draft.driver,'');assert.equal(draft.containerNumber,'');assert.equal(draft.status,'Pending');assert.equal(draft.documents.length,0);assert.equal(draft.billingStatus,'');assert.equal(draft.bookingNumber,'BOOK');
});
function setupSave({count=3,pending=false,failAt=0,duplicate=true,loadType='EXPORT',preset='Export Load'}={}){
 const state={requests:[],loads:[],alerts:[],count,closed:false};
 const ctx={isExportLoadDraft,newLoad:{...original,loadType,containerNumber:duplicate?'':'CONT1',duplicatedFromLoadId:duplicate?'LD-1':''},duplicateCount:count,selectedPresetName:preset,loadCreatePending:{current:pending},setLoadCreating:v=>state.busy=v,findDuplicateContainerLoad:()=>null,canReuseContainerAsStreetTurn:()=>false,alert:m=>state.alerts.push(m),saveLocationIfNotExists:async()=>{},getLoadMilesForSave:async()=>10,getTodayDate:()=>'',getDriverTruck:()=> 'T1',calculateLoadSettlement:()=>200,getPaperworkStatusFromDocuments:()=> 'Pending',normalizeDriverForStorage:v=>v,getStatusAfterDriverAssignment:()=> 'Dispatched',createLoadCopies,API_BASE:'/test',authToken:'fake',fetch:async(url,options)=>{state.requests.push(JSON.parse(options.body));return{ok:state.requests.length!==failAt,json:async()=>state.requests.length===failAt?{error:'Rejected'}:{...JSON.parse(options.body),id:`LD-${state.requests.length+1}`}};},setLoadsData:f=>state.loads=f(state.loads),setDuplicateCount:v=>state.count=v,setInvoiceLoadId:()=>{},setShowForm:()=>state.closed=true,setNewLoad:()=>{},emptyLoad:{},setSelectedPresetName:()=>{},fetchLoads:async()=>{},fetchLocations:async()=>{},fetchSelectedLoadAuditLogs:async()=>{},handleAuthError:()=>false,console};
 const code=source.slice(source.indexOf('const handleAddLoad ='),source.indexOf('const handleEditClick ='));
 return {state,send:vm.runInNewContext(code+'\nhandleAddLoad',ctx)};
}
test('actual save handler submits requested copies unassigned and resets form',async()=>{
 const {state,send}=setupSave();await send({preventDefault(){}});
 assert.equal(state.requests.length,3);assert.equal(state.loads.length,3);assert.equal(state.closed,true);assert.equal(state.busy,false);
 for(const body of state.requests){assert.equal(body.driver,'');assert.equal(body.containerNumber,'');assert.equal(body.status,'Pending');}
});
test('actual save handler retains remaining quantity after partial failure',async()=>{
 const {state,send}=setupSave({failAt:2});await send({preventDefault(){}});
 assert.equal(state.requests.length,2);assert.equal(state.loads.length,1);assert.equal(state.count,2);assert.equal(state.closed,false);assert.equal(state.busy,false);assert.match(state.alerts[0],/1 of 3/);
});
test('in-flight save guard prevents duplicate submissions',async()=>{
 const {state,send}=setupSave({pending:true});await send({preventDefault(){}});assert.equal(state.requests.length,0);
});
test('POST route strips assignments even when a client sends them in a duplicate request',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const start=server.indexOf("app.post('/api/loads',");
 const end=server.indexOf('\napp.',start+1);
 let handler,insert;
 const db={get:(_sql,_args,callback)=>callback(null,{value:10}),run:(sql,args,callback)=>{
  if(sql.includes('UPDATE counters')) callback(null);
  else {const columns=sql.match(/INSERT INTO loads \(([\s\S]*?)\) VALUES/)[1].split(',').map(x=>x.trim());insert=Object.fromEntries(columns.map((column,i)=>[column,args[i]]));}
 }};
 vm.runInNewContext(server.slice(start,end),{app:{post:(_path,...args)=>handler=args.at(-1)},authenticate:()=>{},requireRoles:()=>()=>{},dispatchLocationRoles:[],unassignDuplicate,db,normalizeDriverAssignment:(_company,driver,callback)=>callback(null,driver),findDuplicateContainerLoad:(_company,container,_id,callback)=>{assert.equal(container,'');callback(null,null);},getStatusAfterDriverAssignment:(_driver,status)=>status,isTruthy:Boolean,parseNumericField:Number,console});
 handler({body:original,company:{companyId:'TEST'}},{});
 assert.equal(insert.id,'LD-0011');assert.equal(insert.companyId,'TEST');assert.equal(insert.driver,'');assert.equal(insert.truck,'');assert.equal(insert.containerNumber,'');assert.equal(insert.status,'Pending');assert.equal(insert.bookingNumber,'BOOK');assert.equal(insert.driverRate,'200');
});

for (const loadType of ['', 'EXPORT']) {
  test(`duplicate preserves ${loadType || 'import'} type despite a conflicting preset`, async () => {
    const {state,send}=setupSave({loadType,preset:loadType === 'EXPORT' ? '' : 'Export Load'});
    await send({preventDefault(){}});
    assert.equal(state.requests.length,3);
    for (const body of state.requests) {
      assert.equal(body.loadType,loadType);
      assert.equal(body.driver,'');
      assert.equal(body.containerNumber,'');
      for (const field of ['customer','referenceNumber','bookingNumber','pickup','delivery','rate','driverRate','notes']) assert.equal(body[field],original[field]);
    }
  });
}

test('new-load preset behavior stays unchanged; duplicate fields follow source type', () => {
  assert.equal(isExportLoadDraft({loadType:''},'Export Load'),true);
  assert.equal(isExportLoadDraft({loadType:'EXPORT'},''),false);
  assert.equal(isExportLoadDraft({duplicatedFromLoadId:'LD-1',loadType:''},'Export Load'),false);
  assert.equal(isExportLoadDraft({duplicatedFromLoadId:'LD-1',loadType:'EXPORT'},''),true);
});
