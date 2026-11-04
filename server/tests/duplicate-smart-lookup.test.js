import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../../src/App.jsx',import.meta.url),'utf8');
const button = app.slice(app.indexOf('onClick={handleSmartPortLookup}'));
const disabled = button.match(/disabled=\{([\s\S]*?)\n      \}/)[1];
function isDisabled(overrides={}) {
 return vm.runInNewContext(disabled,{newLoad:{duplicatedFromLoadId:'LD-1',containerNumber:'NEW1'},loadCreating:false,smartPortLookupLoading:false,...overrides});
}
test('duplicate with a manually entered container can click Smart Lookup',()=>assert.equal(isDisabled(),false));
test('lookup only blocks for saving, querying or missing lookup identifiers',()=>{
 assert.equal(isDisabled({loadCreating:true}),true);
 assert.equal(isDisabled({smartPortLookupLoading:true}),true);
 assert.equal(Boolean(isDisabled({newLoad:{duplicatedFromLoadId:'LD-1'}})),true);
 assert.equal(isDisabled({newLoad:{duplicatedFromLoadId:'LD-1',referenceNumber:'BOL'}}),false);
});
test('duplicate lookup queries the new container and keeps assignments, documents and type untouched',async()=>{
 let draft={duplicatedFromLoadId:'LD-1',containerNumber:'NEW1',referenceNumber:'BOL',driver:'',documents:[],pod:'',loadType:''};
 let requested,status,busy;
 const context={newLoad:draft,API_BASE:'/test',authToken:'fake',URLSearchParams,
 setSmartPortLookupLoading:v=>busy=v,setSmartPortLookupStatus:v=>status=v,
 fetch:async url=>{requested=url;return{ok:true,json:async()=>({suggested:{containerNumber:'NEW1',containerSize:'40',shipLine:'LINE',availabilityStatus:'Available'}})};},
 getPortHoustonPickupLocation:v=>v||'',normalizePortShipLineForForm:v=>v||'',getLocalDatePortion:v=>v||'',
 fillEmptyPortField:(old,next)=>old||next||'',setNewLoad:f=>draft=f(draft),console};
 const handler=app.slice(app.indexOf('const handleSmartPortLookup ='),app.indexOf('const handleCheckPortHouston ='));
 await vm.runInNewContext(handler+'\nhandleSmartPortLookup',context)();
 assert.match(requested,/containerNumber=NEW1/);assert.equal(draft.containerSize,'40');assert.equal(draft.driver,'');assert.equal(draft.documents.length,0);assert.equal(draft.pod,'');assert.equal(draft.loadType,'');assert.equal(busy,false);assert.match(status,/Port Houston returned/);
});
test('container and BOL lookups start together and retain both results',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const route=server.slice(server.indexOf("app.get('/api/port-houston/load-lookup'"));
 const block=route.slice(route.indexOf('    const [availability'),route.indexOf('    const primaryContainer'));
 let resolveContainer,bolStarted=false;
 const container=new Promise(resolve=>resolveContainer=resolve);
 const run=vm.runInNewContext('(async()=>{'+block+'\n return {availability,bolAvailability};})',{
 containerNumber:'NEW1',bolNumber:'BOL',credentials:{},facility:'BCT',
 getContainerAvailability:()=>container,getBolAvailability:async()=>{bolStarted=true;return{containers:[]};}});
 const pending=run();assert.equal(bolStarted,true);resolveContainer({found:true});
 const result=await pending;assert.equal(result.availability.found,true);assert.equal(result.bolAvailability.containers.length,0);
});
