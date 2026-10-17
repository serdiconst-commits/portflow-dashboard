import test from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from './fixtures/payrollDb.js';
import {dbRun,dbGet,dbAll} from '../services/dbUtils.js';
import {saveLoadWithDropDate} from '../services/dropDateEdit.js';
const oldDate='2026-10-17T10:00', newDate='2026-10-09T10:00';
async function setup(t,type='DROP') {
 const db=await createDb();t.after(()=>new Promise(resolve=>db.close(resolve)));
 await dbRun(db,"INSERT INTO loads(id,companyId,status,dropDateTime,driverRate,droppedBy) VALUES('L','COMP-A','Dropped',?,'150','DRV-A')",[oldDate]);
 await dbRun(db,"INSERT INTO load_moves(id,companyId,loadId,sequence,moveType,status,completedAt,completedBy,driverRate) VALUES('M','COMP-A','L',1,?,'Completed',?,'DRV-A','150')",[type,oldDate]);
 await dbRun(db,"INSERT INTO load_moves(id,companyId,loadId,sequence,moveType,status,completedAt,completedBy,driverRate) VALUES('NEXT','COMP-A','L',2,'DELIVERY','Completed','2026-10-17T15:00','DRV-B','250')");
 return db;
}
async function edit(db,date=newDate,overrides={}) {
 const previous=await dbGet(db,"SELECT * FROM loads WHERE id='L'");
 return new Promise((resolve,reject)=>saveLoadWithDropDate(db,previous,{dropDateTime:date},'UPDATE loads SET dropDateTime=? WHERE id=? AND companyId=?',[date,previous.id,previous.companyId],function(error){error?reject(error):resolve(this);},overrides));
}
for(const type of ['DROP','PRE_PULL','LIVE_DELIVERY']) test(`Edit Load backdates only the ${type} movement and keeps pay and delivery history`,async t=>{
 const db=await setup(t,type);const result=await edit(db);
 assert.equal((await dbGet(db,"SELECT * FROM loads WHERE id='L'")).dropDateTime,newDate);
 const move=await dbGet(db,"SELECT * FROM load_moves WHERE id='M'");assert.equal(move.completedAt,newDate);assert.equal(move.driverRate,'150');assert.equal(move.completedBy,'DRV-A');assert.equal(move.status,'Completed');
 assert.equal((await dbGet(db,"SELECT * FROM load_moves WHERE id='NEXT'")).completedAt,'2026-10-17T15:00');
 assert.equal(result.dropDateChange.moveId,'M');
 const period=await dbAll(db,"SELECT id FROM load_moves WHERE companyId='COMP-A' AND DATE(SUBSTR(completedAt,1,10)) BETWEEN '2026-10-05' AND '2026-10-11'");assert.deepEqual(period.map(x=>x.id),['M']);
});
test('settlement-linked drop rejects the edit before changing either record',async t=>{
 const db=await setup(t);await dbRun(db,"INSERT INTO settlements(id,companyId,driverId,status) VALUES('S','COMP-A','DRV-A','Draft')");await dbRun(db,"INSERT INTO settlement_loads(id,settlementId,loadId,moveId,payAmount) VALUES('SL','S','L','M',150)");
 await assert.rejects(edit(db),/settlement\/payroll/);assert.equal((await dbGet(db,"SELECT * FROM loads WHERE id='L'")).dropDateTime,oldDate);
});
test('invalid and cleared dates leave history intact',async t=>{
 const db=await setup(t);for(const date of ['','invalid']) await assert.rejects(edit(db,date),/valid Drop Date/);
 assert.equal((await dbGet(db,"SELECT * FROM load_moves WHERE id='M'")).completedAt,oldDate);
});
test('movement failure rolls back the load edit',async t=>{
 const db=await setup(t);await dbRun(db,"CREATE TRIGGER fail_date BEFORE UPDATE OF completedAt ON load_moves BEGIN SELECT RAISE(ABORT,'test failure'); END");await assert.rejects(edit(db),/test failure/);
 assert.equal((await dbGet(db,"SELECT * FROM loads WHERE id='L'")).dropDateTime,oldDate);
});
test('ambiguous completed drops require review; an exact previous timestamp identifies the correct one',async t=>{
 const db=await setup(t);await dbRun(db,"INSERT INTO load_moves(id,companyId,loadId,moveType,status,completedAt) VALUES('OLDER','COMP-A','L','DROP','Completed','2026-10-01T09:00')");
 await edit(db);assert.equal((await dbGet(db,"SELECT * FROM load_moves WHERE id='OLDER'")).completedAt,'2026-10-01T09:00');
 await dbRun(db,"UPDATE loads SET dropDateTime='' WHERE id='L'");await assert.rejects(edit(db,'2026-10-08T08:00'),/uniquely/);
});
test('another company movement cannot be selected',async t=>{
 const db=await setup(t);await dbRun(db,"UPDATE load_moves SET companyId='COMP-B' WHERE id='M'");await assert.rejects(edit(db),/uniquely/);
});
test('payroll-linked drop rejects the date change without touching saved pay',async t=>{
 const db=await setup(t);await dbRun(db,"INSERT INTO payroll_runs(id,companyId,status) VALUES('P','COMP-A','Finalized')");await dbRun(db,"INSERT INTO payroll_items(id,companyId,payrollRunId,loadId,driverId,baseDriverPay) VALUES('PI','COMP-A','P','L','DRV-A',150)");
 await assert.rejects(edit(db),/settlement\/payroll/);assert.equal((await dbGet(db,"SELECT * FROM load_moves WHERE id='M'")).completedAt,oldDate);
});
test('an ordinary live delivery without a recorded drop is not rewritten as a drop',async t=>{
 const db=await setup(t,'LIVE_DELIVERY');await dbRun(db,"UPDATE loads SET status='Delivered',dropDateTime='' WHERE id='L'");await assert.rejects(edit(db),/uniquely/);
});
