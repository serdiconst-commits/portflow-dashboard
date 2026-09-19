import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const fixtureCode=`
  import express from 'express';
  import bcrypt from 'bcrypt';
  import jwt from 'jsonwebtoken';
  import { dbRun } from './server/services/dbUtils.js';
  globalThis.fetch=async(url,options)=>{
    if(url!=='https://api.resend.com/emails') throw new Error('External network forbidden in account test');
    const body=JSON.parse(options.body);
    if(!body.to.every(email=>email.endsWith('@example.invalid'))) throw new Error('Real recipient forbidden');
    process.send({kind:'mail',subject:body.subject,text:body.text});
    return Response.json({id:'mock-email'});
  };
  let server;
  const listen=express.application.listen;
  express.application.listen=function(...args){server=listen.apply(this,args);return server;};
  await import('./server/server.js');
  const {db}=await import('./server/database.js');
  const hash=await bcrypt.hash('Existing-owner-password!',4);
  await dbRun(db,"INSERT INTO companies (id,name,email,passwordHash,createdAt,serviceStatus) VALUES ('QA-OWNER','QA Owner','owner@example.invalid',?,?,'Active')",[hash,new Date().toISOString()]);
  await dbRun(db,"INSERT INTO users (id,companyId,name,email,password,role,isActive) VALUES ('QA-OWNER-USER','QA-OWNER','QA Owner','owner@example.invalid',?,'owner',1)",[hash]);
  if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  const roleTokens={};
  for(const role of ['driver','dispatcher','payroll','manager','admin','carrier']) {
    const id='QA-ROLE-'+role;
    await dbRun(db,'INSERT INTO users (id,companyId,name,email,password,role,isActive) VALUES (?,?,?,?,?,?,1)',[id,'QA-OWNER',role,role+'-role@example.invalid',hash,role]);
    roleTokens[role]=jwt.sign({id,companyId:'QA-OWNER',role},process.env.JWT_SECRET,{expiresIn:'5m'});
  }
  process.send({kind:'ready',port:server.address().port,roleTokens});
`;

test('real server: owner creates tenant, recipient activates, resets and signs in; earlier owner and tenant controls survive', {timeout:30000},async(t)=>{
  const dir=await mkdtemp(path.join(tmpdir(),'portflow-account-test-'));
  const child=spawn(process.execPath,['--input-type=module','-e',fixtureCode],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:'0',DB_PATH:path.join(dir,'test.db'),UPLOADS_DIR:path.join(dir,'uploads'),JWT_SECRET:'test-only-key',PORTFLOW_OWNER_EMAIL:'owner@example.invalid',PORTFLOW_OWNER_RESET_CODE:'test-only-owner-recovery',RESEND_API_KEY:'mock-not-a-real-key',DRIVER_COMPLIANCE_FROM_EMAIL:'sender@example.invalid'},stdio:['ignore','pipe','pipe','ipc']});
  let logs='';child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  const mails=[];child.on('message',message=>{if(message.kind==='mail')mails.push(message);});
  t.after(async()=>{child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
  const {port,roleTokens}=await new Promise((resolve,reject)=>{
    child.on('message',m=>{if(m.kind==='ready')resolve(m);});
    child.once('exit',()=>reject(new Error(`Fixture failed: ${logs}`)));
  });
  const call=async(route,body,token,method=body?'POST':'GET')=>{
    const res=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,data:await res.json()};
  };
  const login=await call('/api/login',{email:'owner@example.invalid',password:'Existing-owner-password!'});assert.equal(login.status,200);
  const owner=login.data.token;
  // Exercise real route middleware before any account writes or password hashing.
  for(const route of ['/api/users','/api/staff-users','/api/drivers']) {
    assert.equal((await call(route,{})).status,401);
    for(const role of ['driver','payroll']) {
      assert.equal((await call(route,{name:'Forbidden',email:'forbidden@example.invalid',password:'Test-password!',role:'admin'},roleTokens[role])).status,403,route+' '+role);
    }
  }
  for(const role of ['dispatcher','manager']) {
    for(const route of ['/api/users','/api/staff-users']) {
      assert.equal((await call(route,{name:'Forbidden',email:'forbidden@example.invalid',password:'Test-password!',role:'admin'},roleTokens[role])).status,403);
    }
    const driver=await call('/api/drivers',{name:'Allowed driver',email:role+'-created@example.invalid',password:'Test-password!',companyId:'OTHER-TENANT'},roleTokens[role]);
    assert.equal(driver.status,200,JSON.stringify(driver));
    assert.equal(driver.data.driver.companyId,'QA-OWNER');
  }
  for(const role of ['admin','carrier']) {
    const user=await call('/api/users',{name:'Allowed staff',email:role+'-created@example.invalid',password:'Test-password!',role:'dispatcher',companyId:'OTHER-TENANT'},roleTokens[role]);
    assert.equal(user.status,200,JSON.stringify(user));
    assert.equal(user.data.user.companyId,'QA-OWNER');
    assert.equal((await call('/api/users',{name:'Forbidden owner',email:'owner-escalation@example.invalid',password:'Test-password!',role:'owner'},roleTokens[role])).status,400);
  }
  // Driver operational routes stay available, but generic load and billing access do not.
  for(const [route,method] of [['/api/loads','POST'],['/api/loads/unknown','PUT'],['/api/invoices','GET'],['/api/invoices','POST'],['/api/invoices/unknown/status','PUT'],['/api/invoices/unknown/payment','PUT']]) {
    assert.equal((await call(route,method==='GET'?null:{},roleTokens.driver,method)).status,403,route);
    assert.equal((await call(route,method==='GET'?null:{},null,method)).status,401,route);
  }
  assert.equal((await call('/api/loads',{},roleTokens.payroll)).status,403);
  assert.equal((await call('/api/loads',null,roleTokens.driver)).status,200);
  const dispatchLoad=await call('/api/loads',{customer:'QA customer',pickup:'Bayport',delivery:'QA delivery',status:'Pending',companyId:'FORGED'},roleTokens.dispatcher);
  assert.equal(dispatchLoad.status,200,JSON.stringify(dispatchLoad));
  assert.equal(dispatchLoad.data.companyId,'QA-OWNER');
  const payrollEdit=await call('/api/loads/'+dispatchLoad.data.id,{...dispatchLoad.data,driverRate:'125'},roleTokens.payroll,'PUT');
  assert.equal(payrollEdit.status,200,JSON.stringify(payrollEdit));
  assert.equal(Number(payrollEdit.data.driverRate),125);

  assert.equal((await call('/api/loads/unknown/status',{status:'In Transit'},roleTokens.driver,'PUT')).status,404);
  assert.equal((await call('/api/invoices',null,roleTokens.dispatcher)).status,403);
  for(const role of ['admin','carrier','manager','payroll']) {
    assert.equal((await call('/api/invoices',null,roleTokens[role])).status,200,role);
  }
  const invoice=await call('/api/invoices',{customerName:'QA customer',amount:125,companyId:'FORGED'},roleTokens.payroll);
  assert.equal(invoice.status,201,JSON.stringify(invoice));
  const invoiceList=await call('/api/invoices',null,roleTokens.payroll);
  assert.equal(invoiceList.data.length,1);
  assert.equal(invoiceList.data[0].companyId,'QA-OWNER');
  // The already-issued admin token must lose admin rights on the next request.
  assert.equal((await call('/api/users/QA-ROLE-admin/role',{role:'dispatcher'},owner,'PUT')).status,200);
  assert.equal((await call('/api/users',{name:'Stale admin',email:'stale-admin@example.invalid',password:'Test-password!',role:'admin'},roleTokens.admin)).status,403);
  assert.equal((await call('/api/company',null,roleTokens.admin)).status,200);
  assert.equal((await call('/api/all-users',null,roleTokens.carrier)).status,200);
  const usersAfter=await call('/api/all-users',null,owner);
  assert.equal(usersAfter.status,200);
  assert(!JSON.stringify(usersAfter.data).includes('forbidden@example.invalid'));

  assert.equal((await call('/api/tenant-management/companies')).status,401);
  const created=await call('/api/tenant-management/companies',{name:'QA Fictitious Freight',adminName:'QA Admin',email:'recipient@example.invalid',scac:'TEST',serviceStatus:'Trial',subscriptionPlan:'QA'},owner);
  assert.equal(created.status,201,JSON.stringify(created));assert.equal(created.data.invitationSent,true);
  const id=created.data.id;
  let tenants=await call('/api/tenant-management/companies',null,owner);
  assert.equal(tenants.data.find(c=>c.id===id).invitationStatus,'Invitation sent');
  assert.equal(tenants.data.find(c=>c.id===id).portHoustonScac,'TEST');
  assert.equal((await call(`/api/tenant-management/companies/${id}`,{serviceStatus:'Active',subscriptionPlan:'QA'},owner,'PUT')).status,200);
  assert.equal((await call('/api/login',{email:'recipient@example.invalid',password:'not-set'})).status,401);
  const invitation=mails.find(m=>m.subject==='Activate your PortFlow account');assert(invitation);
  const params=new URL(invitation.text.match(/https:\/\/\S+/)[0]).hash;
  const token=new URLSearchParams(params.slice(1)).get('token');
  assert.equal((await call('/api/auth/complete-password',{purpose:'invite',token,password:'Recipient-password!'})).status,200);
  const recipient=await call('/api/login',{email:'recipient@example.invalid',password:'Recipient-password!'});assert.equal(recipient.status,200);
  assert.equal(recipient.data.user.companyId,id);assert.equal(recipient.data.user.role,'admin');
  const otherInvoice=invoiceList.data[0].id;
  assert.equal((await call('/api/invoices',null,recipient.data.token)).data.length,0);
  assert.equal((await call('/api/invoices/'+otherInvoice,null,recipient.data.token)).status,404);
  assert.equal((await call('/api/invoices/'+otherInvoice+'/status',{status:'Paid'},recipient.data.token,'PUT')).status,404);

  assert.equal((await call('/api/tenant-management/companies',null,recipient.data.token)).status,403);
  assert.equal((await call('/api/users',{name:'Escalation test',email:'escalation@example.invalid',password:'Test-password!',role:'owner'},recipient.data.token)).status,400);
  for (const route of ['/api/users','/api/staff-users','/api/drivers']) {
    assert.equal((await call(route,{name:'Reserved email test',email:' OWNER@example.invalid ',password:'Test-password!',role:'admin'},recipient.data.token)).status,403);
  }
  const staff=await call('/api/staff-users',{name:'QA Dispatcher',email:'dispatcher@example.invalid',password:'Test-staff-password!',role:'dispatcher'},recipient.data.token);
  assert.equal(staff.status,200);
  assert.equal((await call(`/api/users/${staff.data.user.id}/credentials`,{email:'OWNER@example.invalid'},recipient.data.token,'PUT')).status,403);
  assert.equal((await call('/api/auth/register',{name:'Public signup',email:'public@example.invalid',password:'public-password!'})).status,403);
  await call('/api/auth/forgot-password',{email:'recipient@example.invalid'});
  for(let i=0;i<50&&!mails.some(m=>m.subject==='Reset your PortFlow password');i++)await new Promise(r=>setTimeout(r,20));
  const reset=mails.find(m=>m.subject==='Reset your PortFlow password');assert(reset);
  // Delivery is mocked but its acceptance is recorded asynchronously, as in production.
  await new Promise(r=>setTimeout(r,50));
  const resetToken=new URLSearchParams(new URL(reset.text.match(/https:\/\/\S+/)[0]).hash.slice(1)).get('token');
  assert.equal((await call('/api/auth/complete-password',{purpose:'reset',token:resetToken,password:'Recipient-new-password!'})).status,200);
  assert.equal((await call('/api/company',null,recipient.data.token)).status,401);
  assert.equal((await call('/api/login',{email:'recipient@example.invalid',password:'Recipient-new-password!'})).status,200);
  assert.equal((await call('/api/login',{email:'recipient@example.invalid',password:'Recipient-password!'})).status,401);
  assert.equal((await call('/api/tenant-management/companies',null,owner)).status,200);
  assert.equal((await call('/api/owner/reset-password',{email:'owner@example.invalid',resetCode:'test-only-owner-recovery',newPassword:'New-owner-password!'})).status,200);
  assert.equal((await call('/api/login',{email:'owner@example.invalid',password:'New-owner-password!'})).status,200);
  tenants=await call('/api/tenant-management/companies',null,owner);
  assert.equal(tenants.data.find(c=>c.id===id).invitationStatus,'Activated');
  await call(`/api/tenant-management/companies/${id}`,{serviceStatus:'Suspended'},owner,'PUT');
  assert.equal((await call('/api/login',{email:'recipient@example.invalid',password:'Recipient-new-password!'})).status,401);
  assert(!logs.includes(token));assert(!logs.includes(resetToken));
});
