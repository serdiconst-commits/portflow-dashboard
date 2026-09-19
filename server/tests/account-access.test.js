import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import express from 'express';
import { accountAccessSchema, accountEmailConfig, createAccountAccessService, genericResetMessage } from '../accountAccess.js';
import { createAccountAuthenticator } from '../accountSession.js';
import routes from '../routes/accountAccess.js';
import { dbGet, dbRun, dbAll } from '../services/dbUtils.js';

const exec = (db,sql) => new Promise((resolve,reject)=>db.exec(sql,(err)=>err?reject(err):resolve()));
const password = 'Test-only-password-2026!';
const company = { name:'Fictitious QA Carrier',adminName:'QA Administrator',email:'qa@example.invalid',scac:'TEST',subscriptionPlan:'Trial',serviceStatus:'Trial' };
async function fixture(t) {
  const db = new sqlite3.Database(':memory:');
  await exec(db, `CREATE TABLE companies (id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,passwordHash TEXT,createdAt TEXT,serviceStatus TEXT,subscriptionPlan TEXT,subscriptionNotes TEXT,tenantUpdatedAt TEXT,portHoustonScac TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY,companyId TEXT,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,isActive INTEGER);${accountAccessSchema}`);
  let time = 1900000000000, rejectEmail = false;
  const messages = [];
  const service = createAccountAccessService({ db, now:()=>time,checkEmail:()=>{},sendEmail:async(message)=>{ if(rejectEmail)throw new Error('mock provider failure');messages.push(message); } });
  t.after(()=>new Promise((resolve)=>db.close(resolve)));
  return {db,service,messages,tick:(ms)=>{time+=ms;},rejectEmail:()=>{rejectEmail=true;}};
}
const lastLink = (f,purpose='invite') => f.messages.filter(m=>m.purpose===purpose).at(-1);
const activate = async(f) => f.service.complete({...lastLink(f),password});

 test('owner-created company is isolated and cannot sign in before one-use activation',async(t)=>{
  const f=await fixture(t);
  const result=await f.service.createCompany({...company,role:'owner',companyId:'someone-else'});
  assert.equal(result.invitationSent,true);
  let user=await dbGet(f.db,'SELECT * FROM users');
  assert.equal(user.role,'admin');assert.equal(user.companyId,result.id);assert.equal(user.isActive,0);
  assert.equal((await dbGet(f.db,'SELECT portHoustonScac FROM companies')).portHoustonScac,'TEST');
  const stored=await dbGet(f.db,'SELECT * FROM account_tokens');
  assert.notEqual(stored.hash,lastLink(f).token);assert.equal(stored.hash.length,64);
  const original=lastLink(f);
  await activate(f);
  user=await dbGet(f.db,'SELECT * FROM users');
  assert.equal(user.isActive,1);assert(await bcrypt.compare(password,user.password));
  assert.equal((await dbGet(f.db,'SELECT pending FROM account_access')).pending,0);
  await assert.rejects(f.service.complete({...original,password}),{status:400});
 });
 test('duplicate email normalization rolls back without adding companies',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);
  await assert.rejects(f.service.createCompany({...company,email:' QA@EXAMPLE.INVALID '}),{status:409});
  assert.equal((await dbGet(f.db,'SELECT COUNT(*) AS n FROM companies')).n,1);
 });
 test('resend invalidates old invitation and enforces cooldown',async(t)=>{
  const f=await fixture(t);const result=await f.service.createCompany(company);const old=lastLink(f);
  await assert.rejects(f.service.resend(result.id),{status:429});
  f.tick(60001);await f.service.resend(result.id);
  await assert.rejects(f.service.complete({...old,password}),{status:400});
  await activate(f);
  await assert.rejects(f.service.resend(result.id),{status:409});
 });
 test('expired, wrong-purpose and malformed links cannot change a password',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);
  await assert.rejects(f.service.complete({...lastLink(f),purpose:'reset',password}),{status:400});
  await assert.rejects(f.service.complete({token:'x',purpose:'invite',password}),{status:400});
  f.tick(86400001);await assert.rejects(activate(f),{status:400});
  assert.equal((await dbGet(f.db,'SELECT isActive FROM users')).isActive,0);
 });
 test('suspended tenant cannot activate or reset and keeps its status',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);
  await dbRun(f.db,"UPDATE companies SET serviceStatus='Suspended'");
  await assert.rejects(activate(f),{status:403});
  assert.equal((await dbGet(f.db,'SELECT isActive FROM users')).isActive,0);
  await dbRun(f.db,"UPDATE companies SET serviceStatus='Trial'");await activate(f);
  await f.service.requestReset(company.email);const link=lastLink(f,'reset');assert(link);
  await dbRun(f.db,"UPDATE companies SET serviceStatus='Canceled'");
  await assert.rejects(f.service.complete({...link,password}),{status:403});
  assert.equal((await dbGet(f.db,'SELECT serviceStatus FROM companies')).serviceStatus,'Canceled');
 });
 test('reset does not create users, activate invitations or reactivate disabled users',async(t)=>{
  const f=await fixture(t);await f.service.requestReset('unknown@example.invalid');
  assert.equal((await dbAll(f.db,'SELECT * FROM users')).length,0);
  await f.service.createCompany(company);await f.service.requestReset(company.email);
  assert.equal(lastLink(f,'reset'),undefined);
  await activate(f);await dbRun(f.db,'UPDATE users SET isActive=0');await f.service.requestReset(company.email);
  assert.equal(lastLink(f,'reset'),undefined);
 });
 test('password reset affects only the selected user and revokes old sessions; legacy sessions survive until reset',async(t)=>{
  const f=await fixture(t);const hash=await bcrypt.hash(password,4);
  await dbRun(f.db,"INSERT INTO companies (id,name,email,passwordHash,serviceStatus) VALUES ('legacy','Legacy','admin@example.invalid',?,'Active')",[hash]);
  await dbRun(f.db,"INSERT INTO users VALUES ('old','legacy','Old Admin','admin@example.invalid',?,'admin',1)",[hash]);
  await dbRun(f.db,"INSERT INTO users VALUES ('other','legacy','Other User','other@example.invalid',?,'dispatcher',1)",[hash]);
  const auth=createAccountAuthenticator(f.db,'test-secret');
  async function check(claims) {
    let status=200,passed=false;
    await auth({headers:{authorization:`Bearer ${jwt.sign(claims,'test-secret')}`}}, {status:(value)=>{status=value;return {json:()=>{}};}},()=>{passed=true;});
    return {status,passed};
  }
  assert.deepEqual(await check({id:'old'}),{status:200,passed:true});
  await f.service.requestReset('ADMIN@example.invalid');const link=lastLink(f,'reset');
  assert.equal((await dbGet(f.db,"SELECT password FROM users WHERE id='old'")).password,hash);
  await f.service.complete({...link,password:'A-different-password!'});
  assert.deepEqual(await check({id:'old'}),{status:401,passed:false});
  assert.deepEqual(await check({id:'old',accountVersion:1}),{status:200,passed:true});
  assert.deepEqual(await check({id:'other'}),{status:200,passed:true});
  assert.equal((await dbGet(f.db,"SELECT password FROM users WHERE id='other'")).password,hash);
  assert(await bcrypt.compare('A-different-password!',(await dbGet(f.db,'SELECT passwordHash FROM companies')).passwordHash));
 });
 test('changing an email or password invalidates an outstanding link',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);await activate(f);
  await f.service.requestReset(company.email);const link=lastLink(f,'reset');
  await dbRun(f.db,"UPDATE users SET email='changed@example.invalid'");
  await assert.rejects(f.service.complete({...link,password}),{status:400});
  await dbRun(f.db,'UPDATE users SET email=?, password=?',[company.email,'different-hash']);
  await assert.rejects(f.service.complete({...link,password}),{status:400});
 });
 test('parallel redemption succeeds exactly once',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);
  const results=await Promise.allSettled([activate(f),activate(f)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
 });
 test('email failure leaves a visible pending company, never an active login',async(t)=>{
  const f=await fixture(t);f.rejectEmail();
  const result=await f.service.createCompany(company);
  assert.equal(result.invitationSent,false);
  assert.equal((await dbGet(f.db,'SELECT isActive FROM users')).isActive,0);
  assert.notEqual((await dbGet(f.db,'SELECT consumedAt FROM account_tokens')).consumedAt,null);
 });
 test('reset mail cooldown and 30-minute expiry',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);await activate(f);
  await f.service.requestReset(company.email);await f.service.requestReset(company.email);
  assert.equal(f.messages.filter(m=>m.purpose==='reset').length,1);
  f.tick(1800001);await assert.rejects(f.service.complete({...lastLink(f,'reset'),password}),{status:400});
 });
 test('short or bcrypt-truncated passwords are rejected without consuming a valid link',async(t)=>{
  const f=await fixture(t);await f.service.createCompany(company);
  await assert.rejects(f.service.complete({...lastLink(f),password:'short'}),{status:400});
  await assert.rejects(f.service.complete({...lastLink(f),password:'é'.repeat(40)}),{status:400});
  await activate(f);
 });
 test('email configuration is explicit and requires HTTPS',()=>{
  assert.throws(()=>accountEmailConfig({}),{status:503});
  assert.throws(()=>accountEmailConfig({RESEND_API_KEY:'fake',DRIVER_COMPLIANCE_FROM_EMAIL:'test@example.invalid',PORTFLOW_PUBLIC_URL:'http://unsafe.invalid'}),{status:503});
  assert.equal(accountEmailConfig({RESEND_API_KEY:'fake',DRIVER_COMPLIANCE_FROM_EMAIL:'test@example.invalid'}).origin,'https://portflow-dashboard.onrender.com');
 });
 test('routes enforce owner authorization, reject public registration and return generic recovery replies',async(t)=>{
  const app=express();app.use(express.json());let calls=0;
  const service={createCompany:async()=>{calls++;return {ok:true};},requestReset:async()=>{},resend:async()=>({ok:true})};
  app.use('/api',routes(null,{service,authenticate:(req,res,next)=>req.headers.authorization?next():res.sendStatus(401),requireTenantOwner:(req,res,next)=>req.headers.authorization==='owner'?next():res.sendStatus(403)}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api`;
  const post=(path,authorization,body={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify(body)});
  assert.equal((await post('/tenant-management/companies')).status,401);
  assert.equal((await post('/tenant-management/companies','dispatcher')).status,403);
  assert.equal((await post('/tenant-management/companies','owner')).status,201);assert.equal(calls,1);
  assert.equal((await post('/tenant-management/companies/example/invitation','dispatcher')).status,403);
  assert.equal((await post('/auth/register',null,company)).status,403);
  const a=await (await post('/auth/forgot-password',null,{email:'exists@example.invalid'})).json();
  const b=await (await post('/auth/forgot-password',null,{email:'unknown@example.invalid'})).json();
  assert.deepEqual(a,b);assert.equal(a.message,genericResetMessage);
 });

test('open sessions use current role, email and company instead of stale signed claims', async(t)=>{
  const f=await fixture(t);
  await dbRun(f.db,"INSERT INTO users VALUES ('live-user','company-a','Current User','current@example.invalid','unused','admin',1)");
  const auth=createAccountAuthenticator(f.db,'session-test',{ownerEmail:'owner@example.invalid'});
  const token=jwt.sign({id:'live-user',role:'owner',email:'owner@example.invalid',companyId:'old-company',driverId:'old-driver'},'session-test');
  const check=async()=>{
    const req={headers:{authorization:`Bearer ${token}`}};
    let status=200,passed=false;
    await auth(req,{status(value){status=value;return this;},json(){}},()=>{passed=true;});
    return {status,passed,user:req.user};
  };
  let result=await check();
  assert.equal(result.user.role,'admin');
  assert.equal(result.user.companyId,'company-a');
  assert.equal(result.user.email,'current@example.invalid');
  assert.equal(result.user.driverId,null);
  assert.equal(result.user.password,undefined);
  await dbRun(f.db,"UPDATE users SET role='dispatcher' WHERE id='live-user'");
  assert.equal((await check()).user.role,'dispatcher');
  await dbRun(f.db,"UPDATE users SET email='owner@example.invalid' WHERE id='live-user'");
  assert.equal((await check()).user.role,'owner');
  await dbRun(f.db,"UPDATE users SET email='current@example.invalid', isActive=0 WHERE id='live-user'");
  result=await check();assert.equal(result.status,401);assert.equal(result.passed,false);
  await dbRun(f.db,"DELETE FROM users WHERE id='live-user'");
  assert.equal((await check()).status,401);
});
