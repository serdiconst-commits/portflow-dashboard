import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import sqlite3 from 'sqlite3';
import {dbRun,dbGet} from '../services/dbUtils.js';
import {isReadyForAccounting} from '../../shared/accountingReview.js';
const client=await readFile(new URL('../../src/App.jsx',import.meta.url),'utf8');
const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
test('explicit review return overrides existing invoice until sent again',()=>{
 const invoices=[{loadId:'A'}];
 assert.equal(isReadyForAccounting({id:'A',billingStatus:''},invoices),true);
 assert.equal(isReadyForAccounting({id:'A',billingStatus:'Needs Review'},invoices),false);
 assert.equal(isReadyForAccounting({id:'A',billingStatus:'Ready To Bill'},invoices),true);
 assert.equal(isReadyForAccounting({id:'B',billingStatus:''},invoices),false);
});
for(const confirm of [false,true])test(`return to Completed ${confirm?'uses billing-only request and opens review':'cancel keeps Accounting unchanged'}`,async()=>{
 const code=client.slice(client.indexOf('const handleReturnAccountingLoadToCompleted ='),client.indexOf('const handleRestoreCompletedLoad ='));
 const load={id:'A',status:'Completed',driverRate:'180',billingStatus:'Ready To Bill'};
 let payload,view='accounting',rows=[load],dateFilter='today';
 const noop=()=>{};
 const context={window:{confirm:()=>confirm},accountingRestorePending:{current:false},setAccountingRestoreSaving:noop,
 API_BASE:'/test',authToken:'fake',fetch:async(url,options)=>{assert.match(url,/\/billing-status$/);payload=JSON.parse(options.body);return{ok:true,json:async()=>({...load,...payload})};},
 setLoadsData:f=>rows=f(rows),setSelectedLoad:noop,setSelectedAccountingLoadId:noop,setSelectedCompletedReviewLoadId:noop,setCompletedEditingLoadId:noop,
 setCompletedLoadDateFilter:v=>dateFilter=v,setCompletedLoadSearchTerm:noop,setCompletedSendStatus:noop,setActiveView:v=>view=v,alert:m=>assert.fail(m)};
 await vm.runInNewContext(code+'\nhandleReturnAccountingLoadToCompleted',context)(load);
 assert.equal(context.accountingRestorePending.current,false);
 if(confirm){assert.deepEqual(payload,{billingStatus:'Needs Review'});assert.equal(view,'completed');assert.equal(dateFilter,'all');assert.equal(rows[0].driverRate,'180');assert.equal(rows[0].status,'Completed');}
 else {assert.equal(payload,undefined);assert.equal(view,'accounting');}
});
test('billing review endpoint preserves load pay/status and enforces company, completion and driver guard',async()=>{
 const db=new sqlite3.Database(':memory:');
 try {
 await dbRun(db,`CREATE TABLE loads(id TEXT,companyId TEXT,containerNumber TEXT,billingStatus TEXT,status TEXT,deletedAt TEXT,driverRate TEXT,notes TEXT)`);
 await dbRun(db,`INSERT INTO loads VALUES('A','C','CONT','Ready To Bill','Completed','','180','keep')`);
 await dbRun(db,`INSERT INTO loads VALUES('B','C','ACTIVE','','Dispatched','','200','keep')`);
 let handler;const audits=[];
 const start=server.indexOf("app.put('/api/loads/:id/billing-status'");const end=server.indexOf('const updateCurrentMoveForLoadStatus',start);
 vm.runInNewContext(server.slice(start,end),{app:{put:(_path,_auth,fn)=>handler=fn},authenticate:()=>{},db,console,
 writeAuditLog:(_req,entry)=>audits.push(entry),syncLoadMoves:(_load,cb)=>cb(null),attachMovesToLoads:(loads,cb)=>cb(null,loads)});
 const call=(id,companyId='C',role='admin',billingStatus='Needs Review')=>new Promise(resolve=>{
 let status=200;handler({params:{id},company:{companyId},user:{role},body:{billingStatus}},{status:n=>{status=n;return{json:body=>resolve({status,body})};},json:body=>resolve({status,body})});
 });
 assert.equal((await call('A','C','driver')).status,403);
 assert.equal((await call('A','OTHER')).status,404);
 assert.equal((await call('B')).status,409);
 const response=await call('A');assert.equal(response.status,200);
 const load=await dbGet(db,'SELECT * FROM loads WHERE id=?',['A']);
 assert.equal(load.billingStatus,'Needs Review');assert.equal(load.status,'Completed');assert.equal(load.driverRate,'180');assert.equal(load.notes,'keep');
 assert.equal(audits.length,1);assert.equal(audits[0].action,'BILLING_STATUS_CHANGE');
 assert.equal((await call('A','C','admin','Ready To Bill')).status,200);
 assert.equal((await dbGet(db,'SELECT billingStatus FROM loads WHERE id=?',['A'])).billingStatus,'Ready To Bill');
 } finally {await new Promise(resolve=>db.close(resolve));}
});
