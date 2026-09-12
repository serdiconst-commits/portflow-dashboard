import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import fs from 'node:fs';
import sqlite3 from 'sqlite3';
import {readFile} from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as scope from '../portHoustonScope.js';
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const run=(db,sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,err=>err?reject(err):resolve()));
const get=(db,sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(err,row)=>err?reject(err):resolve(row)));
async function setup(t) {
 const db=new sqlite3.Database(':memory:');
 t.after(()=>new Promise(resolve=>db.close(resolve)));
 await run(db,'CREATE TABLE companies (id TEXT PRIMARY KEY, portHoustonScac TEXT DEFAULT "")');
 await run(db,'CREATE TABLE loads (id TEXT PRIMARY KEY,companyId TEXT,containerNumber TEXT,referenceNumber TEXT,poNumber TEXT,loadDate TEXT)');
 await run(db,'CREATE TABLE documents (id TEXT PRIMARY KEY,loadId TEXT,name TEXT,category TEXT,filePath TEXT,uploadedAt TEXT,portHoustonMetadataJson TEXT)');
 await run(db,'INSERT INTO companies VALUES (?,?),(?,?)',['liberty','LCTM','new-company','ABCD']);
 await run(db,'INSERT INTO loads VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',['LD-0432','liberty','TCKU6053101','','','2026-09-10','LD-NEW','new-company','TCKU6053101','','','2026-09-10']);
 for (const [id,loadId,scac] of [['own','LD-0432','LCTM'],['foreign','LD-0432','JVXC'],['second','LD-NEW','ABCD']]) {
  const metadata=scope.portHoustonDocumentMetadata({nbr:id,truckingCompany:scac,containerNumber:'TCKU6053101'},scac,'TCKU6053101');
  await run(db,'INSERT INTO documents VALUES (?,?,?,?,?,?,?)',[id,loadId,id+'.pdf','OUT EIR','/private/tmp/'+id+'.pdf','2026-09-10',metadata]);
 }
 await run(db,'INSERT INTO documents VALUES (?,?,?,?,?,?,?)',['old','LD-0432','TCKU6053101-out-eir-21416143-portflow-summary.pdf','OUT EIR','/private/tmp/old.pdf','2026-09-10',null]);
 return db;
}
function context(db,extras={}) {return {...scope,db,path,fs,Buffer,console:{log(){},error(){}},authenticate(){},requireRoles:()=>()=>{},adminRoles:[],writeAuditLog(){},rootDir:'/private/tmp',...extras};}
function route(db,from,to,extras={}) {
 let handler;
 const values=context(db,{app:{get:(_path,...callbacks)=>handler=callbacks.at(-1),put:(_path,...callbacks)=>handler=callbacks.at(-1)},...extras});
 // Same realm for pdf-lib's Array checks; dependencies and database remain test doubles.
 new Function(...Object.keys(values),slice(from,to))(...Object.values(values));
 return req=>new Promise((resolve,reject)=>{
  let status=200;
  const res={status(v){status=v;return this;},setHeader(){},json(body){resolve({status,body});},send(body){resolve({status,body});},redirect(url){resolve({status:302,url});},sendFile(file){resolve({status,file});}};
  try{Promise.resolve(handler(req,res)).catch(reject);}catch(err){reject(err);}
 });
}

test('SCAC settings update only the authenticated company, including a new company', async t=>{
 const db=await setup(t);
 const save=route(db,"app.put('/api/company/port-houston/scac'","app.put('/api/company/port-houston'");
 const result=await save({company:{companyId:'new-company'},body:{scac:' xyz ',companyId:'liberty'}});
 assert.equal(result.status,200);
 assert.equal((await get(db,'SELECT portHoustonScac FROM companies WHERE id=?',['new-company'])).portHoustonScac,'XYZ');
 assert.equal((await get(db,'SELECT portHoustonScac FROM companies WHERE id=?',['liberty'])).portHoustonScac,'LCTM');
 assert.equal((await save({company:{companyId:'new-company'},body:{scac:'LCTM or 1=1'}})).status,422);
});

test('load attachments hide legacy and foreign automatic EIRs and keep each tenant isolated', async t=>{
 const db=await setup(t);const ctx=context(db);
 vm.runInNewContext(slice('const attachDocumentsToLoads','const flattenPortHoustonValues')+'\nthis.attach=attachDocumentsToLoads;',ctx);
 const rows=await new Promise((resolve,reject)=>ctx.attach([{id:'LD-0432'},{id:'LD-NEW'}],(err,rows)=>err?reject(err):resolve(rows)));
 assert.deepEqual(Array.from(rows[0].documents,d=>d.id),['own']);
 assert.deepEqual(Array.from(rows[1].documents,d=>d.id),['second']);
});

test('direct document and old upload URLs cannot bypass company SCAC', async t=>{
 const db=await setup(t);
 for (const [from,to,param] of [["app.get('/api/documents/:id/file'","app.delete('/api/documents/:id'",'id'],["app.get('/uploads/:filename'","app.get('/api/company'",'filename']]) {
  const open=route(db,from,to,{fs:{existsSync:()=>true}});
  for(const id of ['foreign','old','second']) {
   const result=await open({company:{companyId:'liberty'},params:{[param]:param==='id'?id:id+'.pdf'}});
   assert.equal(result.status,404);
  }
  assert.equal((await open({company:{companyId:'liberty'},params:{[param]:param==='id'?'own':'own.pdf'}})).status,200);
  await run(db,'UPDATE companies SET portHoustonScac=? WHERE id=?',['ZZZZ','liberty']);
  assert.equal((await open({company:{companyId:'liberty'},params:{[param]:param==='id'?'own':'own.pdf'}})).status,404);
  await run(db,'UPDATE companies SET portHoustonScac=? WHERE id=?',['LCTM','liberty']);
 }
});

test('callbacks cannot choose another tenant sharing the same container or guess among two loads', async t=>{
 const db=await setup(t);const ctx=context(db);
 vm.runInNewContext(slice('const findLoadForPortHoustonMapping',"app.post('/api/port-houston/events'")+'\nthis.find=findLoadForPortHoustonMapping;',ctx);
 await assert.rejects(ctx.find({containerNumber:'TCKU6053101'}),/companyId/);
 assert.equal((await ctx.find({containerNumber:'TCKU6053101',companyId:'liberty',scac:'LCTM'})).id,'LD-0432');
 assert.equal(await ctx.find({containerNumber:'TCKU6053101',companyId:'new-company',scac:'LCTM'}),null);
 await run(db,'INSERT INTO loads VALUES (?,?,?,?,?,?)',['LD-DUP','liberty','TCKU6053101','','','2026-09-11']);
 await assert.rejects(ctx.find({containerNumber:'TCKU6053101',companyId:'liberty',scac:'LCTM'}),/Multiple loads/);
});

test('customer packet reads only verified EIR bytes, not JVXC or legacy documents', async t=>{
 const db=await setup(t);
 const file=await PDFDocument.create();file.addPage();const bytes=await file.save();
 const reads=[];
 const packet=route(db,"app.get('/api/loads/:id/customer-packet'","app.post('/api/loads/:id/documents'",{
  PDFDocument,StandardFonts,rgb,customerPacketOrder:['OUT EIR','IN EIR','POD'],
  normalizePacketCategory:value=>String(value).toUpperCase(),companyProfileSelect:'id',
  sanitizePdfFilename:value=>value,parseInvoiceSettings:()=>({}),invoicePdfColor:()=>rgb(0,0,0),
  getMimeTypeFromName:()=> 'application/pdf',
  fs:{existsSync:()=>false,readFileSync:filePath=>{reads.push(filePath);return bytes;}},
 });
 const result=await packet({company:{companyId:'liberty'},params:{id:'LD-0432'}});
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.deepEqual(reads,['/private/tmp/own.pdf']);
 assert.equal((await PDFDocument.load(result.body)).getPageCount(),2);
});

test('storage rechecks the tenant SCAC before accepting a document', async t=>{
 const db=await setup(t);let saves=0;
 const ctx=context(db,{getCompanyPortHoustonCredentials:async()=>({scac:'LCTM'})});
 vm.runInNewContext(slice('const saveScopedPortHoustonDocument','const formatPortHoustonDate')+'\nthis.save=saveScopedPortHoustonDocument;',ctx);
 const saveDocument=async()=>{saves++;return {id:'own'};};
 await assert.rejects(ctx.save(saveDocument,{loadId:'LD-0432',companyId:'liberty',transaction:{nbr:'21416143',truckingCompany:'JVXC',containerNumber:'TCKU6053101'}}),/could not be verified/);
 assert.equal(saves,0);
 await ctx.save(saveDocument,{loadId:'LD-0432',companyId:'liberty',transaction:{nbr:'21416144',truckingCompany:'LCTM',containerNumber:'TCKU6053101'}});
 assert.equal(saves,1);
 assert.equal(JSON.parse((await get(db,'SELECT portHoustonMetadataJson FROM documents WHERE id="own"')).portHoustonMetadataJson).scac,'LCTM');
});

test('automatic EIR selection ignores legacy or mismatched paperwork and skips unconfigured companies',async t=>{
 const db=await setup(t);
 await run(db,'ALTER TABLE companies ADD COLUMN portHoustonUsername TEXT');
 await run(db,'ALTER TABLE companies ADD COLUMN portHoustonCredentialsJson TEXT');
 await run(db,'UPDATE companies SET portHoustonUsername="test-only"');
 const ctx=context(db,{autoEirBatchSize:100});
 vm.runInNewContext(slice('const queryLoadsForAutomaticEirCheck','const getLoadsForAutomaticEirCheck')+'\nthis.query=queryLoadsForAutomaticEirCheck;',ctx);
 await run(db,'INSERT INTO documents VALUES (?,?,?,?,?,?,?)',['bad','LD-0432','old-other.pdf','IN EIR','/private/tmp/bad.pdf','2026-09-10','not-json']);
 assert.equal((await ctx.query(0)).some(load=>load.id==='LD-0432'),true);
 const meta=scope.portHoustonDocumentMetadata({nbr:'in',truckingCompany:'LCTM',containerNumber:'TCKU6053101'},'LCTM','TCKU6053101');
 await run(db,'UPDATE documents SET portHoustonMetadataJson=? WHERE id="bad"',[meta]);
 assert.equal((await ctx.query(0)).some(load=>load.id==='LD-0432'),false);
 await run(db,'UPDATE companies SET portHoustonScac="" WHERE id="new-company"');
 assert.equal((await ctx.query(0)).some(load=>load.id==='LD-NEW'),false);
});

test('additive migrations preserve old settings and leave a new company SCAC blank',async t=>{
 const db=new sqlite3.Database(':memory:');t.after(()=>new Promise(resolve=>db.close(resolve)));
 await run(db,'CREATE TABLE companies (id TEXT, name TEXT)');
 await run(db,'CREATE TABLE documents (id TEXT, name TEXT)');
 await run(db,'INSERT INTO companies VALUES ("liberty","Liberty")');
 await run(db,'INSERT INTO documents VALUES ("legacy","old.pdf")');
 const databaseSource=await readFile(new URL('../database.js',import.meta.url),'utf8');
 for(const field of ['portHoustonScac','portHoustonMetadataJson']) {
  const match=databaseSource.match(new RegExp('ALTER TABLE \\w+ ADD COLUMN '+field+'[^`]+'));
  assert.ok(match);
  await run(db,match[0]);
 }
 assert.equal((await get(db,'SELECT portHoustonScac FROM companies')).portHoustonScac,'');
 assert.equal((await get(db,'SELECT name FROM documents')).name,'old.pdf');
 await run(db,'INSERT INTO companies (id,name) VALUES ("new","New company")');
 assert.equal((await get(db,'SELECT portHoustonScac FROM companies WHERE id="new"')).portHoustonScac,'');
});
