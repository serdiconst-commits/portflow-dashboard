import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { shiftPayrollPeriod } from '../../src/utils/payrollPeriod.js';
import { formatDocumentDate } from '../../shared/documentDates.js';

test('previous and next preserve the workweek and custom range across month/year/DST boundaries', () => {
  assert.deepEqual(shiftPayrollPeriod('2026-10-05','2026-10-09',1),{start:'2026-10-12',end:'2026-10-16'});
  assert.deepEqual(shiftPayrollPeriod('2026-10-12','2026-10-16',-1),{start:'2026-10-05',end:'2026-10-09'});
  for (const [start,end] of [['2025-12-29','2026-01-02'],['2026-03-02','2026-03-06'],['2026-10-26','2026-10-30'],['2026-10-01','2026-10-14']]) {
    const next=shiftPayrollPeriod(start,end,1);
    assert.deepEqual(shiftPayrollPeriod(next.start,next.end,-1),{start,end});
  }
  assert.equal(shiftPayrollPeriod('','',1),null);
  assert.equal(shiftPayrollPeriod('2026-02-30','2026-03-01',1),null);
  assert.equal(shiftPayrollPeriod('2026-10-16','2026-10-12',1),null);
});

test('finalize confirmation shows driver, period, movements and net pay; cancel performs no mutation', async () => {
  const source=fs.readFileSync(new URL('../../src/components/DriverPayroll.jsx',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('  async function transition(action)'),source.indexOf('  async function download('));
  for (const approved of [false,true]) {
    const calls=[];let message='';
    const context={statement:{driver:{name:'QA Driver'},totals:{loadCount:3,netPay:725}},active:{periodStart:'2026-10-05',periodEnd:'2026-10-09'},formatDocumentDate,money:value=>`$${value.toFixed(2)}`,window:{confirm:text=>{message=text;return approved;}},run:fn=>fn(),mutate:(...args)=>calls.push(args)};
    vm.createContext(context);
    await vm.runInContext(fn+'\ntransition("finalize")',context);
    for (const text of ['QA Driver','10/5/2026','10/9/2026','Movements: 3','$725.00','locks this settlement','Select Cancel']) assert.ok(message.includes(text),text);
    assert.equal(calls.length,approved?1:0);
    if(approved) assert.equal(calls[0][2].action,'finalize');
  }
});
