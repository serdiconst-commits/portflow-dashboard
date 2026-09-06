import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sqlite3 from 'sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { signedPodSchema, podEmailSchema, validatePod, buildSignedPodPdf } from '../driverPod.js';
import createDriverPodRoutes from '../routes/driverPods.js';

const draft = () => ({requestId:'a1234567-1234-4567-8123-123456789abc',receiverName:'José Receiver',notes:'One carton dented; received with exception.',signedAt:'2026-09-05T19:30:00.000Z',signature:[[{x:.1,y:.7},{x:.2,y:.2},{x:.3,y:.7},{x:.5,y:.3}]]});
const sql = (db,query,args=[]) => new Promise((resolve,reject) => db.run(query,args,e => e ? reject(e) : resolve()));
const get = (db,query) => new Promise((resolve,reject) => db.get(query,(e,r) => e ? reject(e) : resolve(r)));

async function fixture(t) {
  const db = new sqlite3.Database(':memory:');
  const dir = await mkdtemp(path.join(tmpdir(),'driver-pod-test-'));
  await sql(db,'CREATE TABLE loads (id TEXT PRIMARY KEY,companyId TEXT,driver TEXT,customer TEXT,delivery TEXT,containerNumber TEXT,referenceNumber TEXT)');
  await sql(db,'CREATE TABLE load_moves (loadId TEXT,companyId TEXT,driverId TEXT,status TEXT)');
  await sql(db,'CREATE TABLE companies (id TEXT PRIMARY KEY,name TEXT,companyTimezone TEXT)');
  await sql(db,'CREATE TABLE drivers (id TEXT,companyId TEXT,name TEXT)');
  await sql(db,'CREATE TABLE customers (companyId TEXT,name TEXT,email TEXT)');
  await sql(db,'CREATE TABLE documents (id TEXT PRIMARY KEY,loadId TEXT,name TEXT,size TEXT,type TEXT,category TEXT,filePath TEXT,uploadedAt TEXT)');
  await sql(db,signedPodSchema); await sql(db,podEmailSchema);
  await sql(db,'INSERT INTO companies VALUES (?,?,?)',['C1','Test Carrier','America/Chicago']);
  await sql(db,'INSERT INTO drivers VALUES (?,?,?)',['D1','C1','Test Driver']);
  await sql(db,'INSERT INTO customers VALUES (?,?,?)',['C1','Test Customer','receiver@example.com']);
  await sql(db,'INSERT INTO loads VALUES (?,?,?,?,?,?,?)',['LD-001','C1','D1','Test Customer','100 Delivery Street, Houston TX','TEST1234567','REF-100']);
  let emails = 0; let failEmail = false;
  const audit = [];
  const app = express(); app.use(express.json({limit:'512kb'}));
  app.use((req,res,next) => {req.user={role:req.headers['x-role'] || 'driver',driverId:req.headers['x-driver'] || 'D1',name:'Driver'};req.company={companyId:req.headers['x-company'] || 'C1'};next();});
  app.use('/pods',createDriverPodRoutes(db,{uploadsDir:dir,audit:(req,event)=>audit.push(event),email:async payload => {
    if (failEmail) throw new Error('offline');
    emails++; assert.ok(payload.buffer.subarray(0,4).equals(Buffer.from('%PDF'))); assert.match(payload.idempotencyKey,/^pod-/); return 'provider-123';
  }}));
  const server = await new Promise((resolve,reject) => {const s=app.listen(0,'127.0.0.1',e=>e ? reject(e) : resolve(s));});
  t.after(async () => {await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>db.close(resolve));await rm(dir,{recursive:true,force:true});});
  const call = async (url,body,headers={}) => {
    const r=await fetch(`http://127.0.0.1:${server.address().port}/pods/${url}`,{method:body ? 'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body ? JSON.stringify(body):undefined});
    return {status:r.status,data:r.headers.get('content-type')?.includes('application/pdf') ? Buffer.from(await r.arrayBuffer()) : await r.json()};
  };
  return {db,dir,call,audit,emailCount:()=>emails,failEmail:v=>{failEmail=v;}};
}

test('signed POD becomes a real PDF attachment and retry creates only one document',async t=>{
  const f=await fixture(t);
  const first=await f.call('LD-001',draft()); assert.equal(first.status,200); assert.equal(first.data.document.category,'POD');
  const again=await f.call('LD-001',draft()); assert.deepEqual(again.data,first.data);
  assert.equal((await get(f.db,'SELECT count(*) n FROM documents')).n,1);
  assert.equal(f.audit.filter(e=>e.action==='SIGNED_POD_CREATED').length,1);
  const pdf=await f.call(`LD-001/${first.data.podId}/file`); assert.equal(pdf.status,200);
  assert.equal((await PDFDocument.load(pdf.data)).getPageCount(),1);
  const record=await get(f.db,'SELECT * FROM documents'); assert.ok((await readFile(record.filePath)).length>1000);
  const conflict=await f.call('LD-001',{...draft(),receiverName:'Different Person'}); assert.equal(conflict.status,409);
});

test('POD creation and email enforce driver assignment and company boundaries',async t=>{
  const f=await fixture(t);
  for (const headers of [{'x-driver':'D2'},{'x-company':'C2'}]) assert.equal((await f.call('LD-001',draft(),headers)).status,404);
  assert.equal((await f.call('LD-001',draft(),{'x-role':'dispatcher'})).status,403);
  const saved=await f.call('LD-001',draft());
  assert.equal((await f.call(`LD-001/${saved.data.podId}/email`,{recipient:'receiver@example.com'},{'x-driver':'D2'})).status,404);
  assert.equal((await f.call(`LD-001/${saved.data.podId}/file`,null,{'x-company':'C2'})).status,404);
  assert.equal(f.emailCount(),0);
});

test('historical assigned movement permits retry after driver is released',async t=>{
  const f=await fixture(t);
  await sql(f.db,"UPDATE loads SET driver = ''");
  await sql(f.db,'INSERT INTO load_moves VALUES (?,?,?,?)',['LD-001','C1','D1','Completed']);
  assert.equal((await f.call('LD-001',draft())).status,200);
  await sql(f.db,"UPDATE load_moves SET status = 'Cancelled'");
  assert.equal((await f.call('LD-001',draft())).status,404);
});

test('email is optional, preserves saved PDF on failure, and deduplicates retries',async t=>{
  const f=await fixture(t);
  const saved=await f.call('LD-001',draft()); assert.equal(f.emailCount(),0);
  const url=`LD-001/${saved.data.podId}/email`;
  assert.equal((await f.call(url,{recipient:'a@example.com,b@example.com'})).status,400);
  f.failEmail(true); assert.equal((await f.call(url,{recipient:'receiver@example.com'})).status,502);
  assert.equal((await get(f.db,'SELECT count(*) n FROM documents')).n,1);
  f.failEmail(false); assert.equal((await f.call(url,{recipient:'receiver@example.com'})).status,200);
  const retry=await f.call(url,{recipient:'receiver@example.com'}); assert.equal(retry.data.alreadySent,true); assert.equal(f.emailCount(),1);
  const options=await f.call('LD-001/options'); assert.equal(options.data.customerEmail,'receiver@example.com');
});

test('missing and malformed signature data is rejected before documents are written',async t=>{
  const f=await fixture(t);
  for (const patch of [{receiverName:''},{signature:[]},{signature:[[{x:2,y:0}]]},{signedAt:'invalid'},{notes:'x'.repeat(601)}]) {
    assert.equal((await f.call('LD-001',{...draft(),...patch})).status,400);
  }
  assert.equal((await get(f.db,'SELECT count(*) n FROM documents')).n,0);
  assert.throws(()=>validatePod({...draft(),signature:Array.from({length:101},()=>[{x:0,y:0}])}));
});

test('long delivery text and notes paginate without PDF font failures',async()=>{
  const pdf=await buildSignedPodPdf({load:{id:'LD-TEST',customer:'配送 / Cliente José',delivery:'Long address '.repeat(80)},company:{name:'Test Company',companyTimezone:'invalid'},driverName:'Driver',pod:validatePod({...draft(),notes:'Delivery condition. '.repeat(30)})});
  assert.ok((await PDFDocument.load(pdf)).getPageCount()>1);
});
