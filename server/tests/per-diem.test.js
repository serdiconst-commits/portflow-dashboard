import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDb } from './fixtures/payrollDb.js';
import {dbAll,dbGet,dbRun}from '../services/dbUtils.js';
import {mountPerDiemRoutes,capturePortOutDay,getPerDiemCalendar}from '../services/perDiem.js';
import {DEFAULT_PER_DIEM_CALENDAR as calendar,perDiemDeadline,perDiemTracking,matchesPerDiemFilter,portOutDay,validDay}from '../../shared/perDiem.js';
import {unassignDuplicate}from '../../shared/duplicateLoads.js';
for(const [out,expected]of [['2026-11-02','2026-11-05'],['2026-11-06','2026-11-11'],['2026-11-07','2026-11-12'],['2026-11-25','2026-12-02'],['2026-04-02','2026-04-08']])test(`four inclusive working days from ${out} = ${expected}`,()=>assert.equal(perDiemDeadline(out,calendar).date,expected));
test('invalid dates and unknown future holiday calendars do not invent deadlines',()=>{
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2026-13-01'),false);
 assert.equal(perDiemDeadline('2026-02-30',calendar).date,'');assert.match(perDiemDeadline('2026-12-31',calendar).error,/2027/);
 const extended={...calendar,'2027':['2027-01-01']};assert.equal(perDiemDeadline('2026-12-31',extended).date,'2027-01-06');
});
const base={id:'L1',containerNumber:'CONT1',perDiemContainerNumber:'CONT1',perDiemPortOutDate:'2026-11-02',loadType:'',status:'Delivered'};
test('delivered-at-customer and yard drop remain tracked; only final return stops alerts',()=>{
 for(const status of ['Delivered','Completed','Dropped','In Transit'])assert.equal(perDiemTracking({...base,status},'2026-11-06',calendar).status,'overdue');
 assert.equal(perDiemTracking({...base,moves:[{moveType:'EMPTY_YARD',status:'Completed'}]},'2026-11-06',calendar).status,'overdue');
 for(const type of ['RETURN','PICKUP_RETURN','YARD_RETURN'])assert.equal(perDiemTracking({...base,moves:[{moveType:type,status:'Completed'}]},'2026-11-06',calendar).status,'returned');
 assert.equal(perDiemTracking({...base,perDiemReturnedDate:'2026-11-05'},'2026-11-06',calendar).status,'returned');
});
test('deadline filters include today, overdue and next working day across weekends/holidays',()=>{
 assert.equal(matchesPerDiemFilter(base,'2026-11-05','today',calendar),true);
 assert.equal(matchesPerDiemFilter(base,'2026-11-06','overdue',calendar),true);
 const monday={...base,perDiemDueDate:'2026-11-09'};assert.equal(matchesPerDiemFilter(monday,'2026-11-06','soon',calendar),true);
 const afterHoliday={...base,perDiemDueDate:'2026-11-30'};assert.equal(matchesPerDiemFilter(afterHoliday,'2026-11-25','soon',calendar),true);
 assert.equal(matchesPerDiemFilter(base,'2026-11-01','upcoming',calendar),true);
});
test('exports, deleted loads, changed containers and copies do not inherit tracking',()=>{
 for(const patch of [{loadType:'EXPORT'},{deletedAt:'deleted'},{containerNumber:'NEWCONT'}])assert.equal(perDiemTracking({...base,...patch},'2026-11-06',calendar).tracked,false);
 const copy=unassignDuplicate(base);assert.equal(copy.perDiemPortOutDate,'');assert.equal(copy.perDiemDueDate,'');assert.equal(copy.perDiemReturnedDate,'');
});
test('port departure accepts only matching inventory and converts UTC to Houston date',()=>{
 const availability={found:true,containerNumber:'CONT1',timeOut:'2026-11-03T02:00:00Z'};
 assert.equal(portOutDay(base,availability),'2026-11-02');
 assert.equal(portOutDay(base,{...availability,timeOut:Date.parse(availability.timeOut)}),'2026-11-02');
 assert.equal(portOutDay(base,{...availability,containerNumber:'OTHER'}),'');
 assert.equal(portOutDay(base,{...availability,found:false}),'');
 assert.equal(portOutDay({...base,loadType:'EXPORT'},availability),'');
 assert.equal(portOutDay(base,{...availability,timeOut:''}),'');
});
async function fixture(t){
 const db=await createDb();t.after(()=>new Promise(resolve=>db.close(resolve)));
 for(const column of ['perDiemPortOutDate','perDiemDueDate','perDiemReturnedDate','perDiemOutSource','perDiemContainerNumber','loadType','billingStatus'])await dbRun(db,`ALTER TABLE loads ADD COLUMN ${column} TEXT`);
 await dbRun(db,"ALTER TABLE companies ADD COLUMN perDiemCalendarJson TEXT DEFAULT '{}'");
 await dbRun(db,"INSERT INTO loads(id,companyId,containerNumber,status,driver,driverRate,rate,loadType,deletedAt)VALUES('L1','COMP-A','CONT1','Delivered','DRV-A','125','500','','')");
 await dbRun(db,"INSERT INTO load_moves(id,companyId,loadId,moveType,status,driverRate)VALUES('M1','COMP-A','L1','DROP','Completed','125')");
 const app=express();app.use(express.json());const audit=[];
 const authenticate=(req,res,next)=>{req.company={companyId:req.headers['x-company'] || 'COMP-A'};req.user={role:req.headers['x-role'] || 'dispatcher'};next();};
 mountPerDiemRoutes(app,{db,authenticate,requireRoles:roles=>(req,res,next)=>roles.has(req.user.role)?next():res.status(403).json({error:'Not allowed'}),dispatchLocationRoles:new Set(['dispatcher']),writeAuditLog:(_req,event)=>audit.push(event)});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=async(path,method='GET',body,headers={})=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};};
 return{db,call,audit};
}
test('date endpoint is tenant scoped, validates dates, audits changes and leaves operational/payroll values intact',async t=>{
 const {db,call,audit}=await fixture(t);const before=await dbGet(db,"SELECT * FROM loads WHERE id='L1'");const moves=await dbAll(db,'SELECT * FROM load_moves');
 const body={portOutDate:'2026-11-02',dueDate:'',returnedDate:''};
 assert.equal((await call('/api/loads/L1/per-diem','PUT',body,{'x-role':'driver'})).status,403);
 assert.equal((await call('/api/loads/L1/per-diem','PUT',body,{'x-company':'COMP-B'})).status,404);
 for(const patch of [{portOutDate:'2026-02-30'},{dueDate:'2026-11-01'},{returnedDate:'2026-11-01'},{returnedDate:'2099-01-01'}])assert.equal((await call('/api/loads/L1/per-diem','PUT',{...body,...patch})).status,400);
 const result=await call('/api/loads/L1/per-diem','PUT',body);assert.equal(result.status,200);assert.equal(result.body.perDiemOutSource,'Manual');
 for(const key of Object.keys(before).filter(key=>!key.startsWith('perDiem')))assert.equal(result.body[key],before[key],key);
 assert.deepEqual(await dbAll(db,'SELECT * FROM load_moves'),moves);assert.equal(audit[0].action,'PER_DIEM_DATES');
 assert.equal(perDiemTracking(result.body,'2026-11-05',calendar).deadline,'2026-11-05');
 const returned=await call('/api/loads/L1/per-diem','PUT',{...body,returnedDate:'2026-11-05'});assert.equal(perDiemTracking(returned.body,'2026-11-06',calendar).status,'returned');
});
test('port capture fills missing date once and never overwrites a manual departure or another container',async t=>{
 const {db}=await fixture(t);const load=await dbGet(db,"SELECT * FROM loads WHERE id='L1'");
 await capturePortOutDay(db,load,{found:true,containerNumber:'CONT1',timeOut:'2026-11-03T02:00:00Z'});
 let saved=await dbGet(db,"SELECT * FROM loads WHERE id='L1'");assert.equal(saved.perDiemPortOutDate,'2026-11-02');assert.equal(saved.perDiemOutSource,'Port Houston');
 await dbRun(db,"UPDATE loads SET perDiemPortOutDate='2026-10-30',perDiemOutSource='Manual'");
 await capturePortOutDay(db,load,{found:true,containerNumber:'CONT1',timeOut:'2026-11-04T02:00:00Z'});
 saved=await dbGet(db,"SELECT * FROM loads WHERE id='L1'");assert.equal(saved.perDiemPortOutDate,'2026-10-30');
 await dbRun(db,"UPDATE loads SET containerNumber='CONT2',perDiemPortOutDate=''");
 await capturePortOutDay(db,load,{found:true,containerNumber:'CONT1',timeOut:'2026-11-04T02:00:00Z'});
 assert.equal((await dbGet(db,"SELECT * FROM loads WHERE id='L1'")).perDiemPortOutDate,'');
});
test('holiday calendar updates are validated and isolated by company',async t=>{
 const {db,call}=await fixture(t);
 assert.deepEqual((await call('/api/per-diem/calendar')).body,calendar);
 assert.equal((await call('/api/per-diem/calendar','PUT',{year:2027,dates:['2026-01-01']})).status,400);
 assert.equal((await call('/api/per-diem/calendar','PUT',{year:2027,dates:['2027-01-01']},{'x-role':'driver'})).status,403);
 assert.equal((await call('/api/per-diem/calendar','PUT',{year:2027,dates:['2027-01-01']})).status,200);
 const mine=await getPerDiemCalendar(db,'COMP-A');const other=await getPerDiemCalendar(db,'COMP-B');assert.deepEqual(mine['2027'],['2027-01-01']);assert.equal(other['2027'],undefined);
});
test('the actual Dispatch Per Diem branch includes customer-completed loads while the regular board does not',async()=>{
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');
 const source=await readFile(new URL('../../src/App.jsx',import.meta.url),'utf8');
 const start=source.indexOf('const baseFilteredLoadsData =');const end=source.indexOf('const normalizedSearchTerm',start);
 const code=source.slice(start,end)+'\nbaseFilteredLoadsData';
 const state={dashboardFilter:'per-diem',loadsData:[base],activeOperationsLoads:[],perDiemToday:'2026-11-06',perDiemFilter:'overdue',perDiemCalendar:calendar,matchesPerDiemFilter};
 assert.equal(vm.runInNewContext(code,state).length,1);
 assert.equal(vm.runInNewContext(code,{...state,dashboardFilter:'all'}).length,0);
});
