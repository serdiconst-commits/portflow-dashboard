import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollRoster } from '../../src/utils/payrollRoster.js';

test('pay period lists all drivers without creating or estimating payroll', () => {
  const drivers = [{id:'A',name:'Ana'},{id:'B',name:'Ben'}];
  const rows = [{id:'S1',driverId:'A',status:'Draft',netPay:450,periodStart:'2026-10-05',periodEnd:'2026-10-09'}];
  const original = JSON.stringify({drivers,rows});
  const result = payrollRoster(drivers,rows,'2026-10-05','2026-10-09');
  assert.equal(result.length,2);
  assert.equal(result[0].netPay,450);
  assert.equal(result[0].unprepared,undefined);
  assert.equal(result[1].driverId,'B');
  assert.equal(result[1].status,'Not prepared');
  assert.equal(result[1].periodStart,'2026-10-05');
  assert.equal(result[1].netPay,undefined);
  assert.equal(JSON.stringify({drivers,rows}),original);
  const nextPeriod=payrollRoster(drivers,[],'2026-10-12','2026-10-16');
  assert.equal(nextPeriod.length,2);
  assert.ok(nextPeriod.every(row=>row.unprepared && row.periodStart==='2026-10-12'));
});

test('roster preserves corrections and settlements for drivers outside the current list', () => {
  const settlements=[{id:'S1',driverId:'A',status:'Paid'},
    {id:'S2',driverId:'A',correctionOf:'S1',status:'Draft'},
    {id:'S3',driverId:'OLD',driverName:'Former driver',status:'Finalized'}];
  const result=payrollRoster([{id:'A',name:'Ana'},{id:'B',name:'Ben'},{id:'B',name:'Ben'}],settlements,'2026-10-05','2026-10-09');
  assert.equal(result.length,4);
  assert.equal(result.filter(row=>row.driverId==='A').length,2);
  assert.equal(result.find(row=>row.id==='S2').correctionOf,'S1');
  assert.equal(result.find(row=>row.id==='S3').status,'Finalized');
  assert.equal(result.filter(row=>row.unprepared).length,1);
});
