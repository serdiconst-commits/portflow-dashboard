import test from 'node:test';
import assert from 'node:assert/strict';
import { getLfdTodayAlerts, lfdCalendarDate, companyCalendarDate } from '../../src/utils/lfdAlerts.js';
const today = new Date('2026-10-01T15:00:00Z');
const load = { id: 'L1', containerNumber: 'MRKU123456', lastFreeDay: '10/1/2026', driver: '', status: 'Dispatched' };

test('today LFD alert clears on assignment and returns on removal, regardless of stale movement driver', () => {
  assert.deepEqual(getLfdTodayAlerts([load], today), [load]);
  const assigned = { ...load, driver: 'DRV-A' };
  assert.deepEqual(getLfdTodayAlerts([assigned], today), []);
  const removed = { ...assigned, driver: '', currentMove: { driverId: 'DRV-A' } };
  assert.deepEqual(getLfdTodayAlerts([removed], today), [removed]);
});
test('alerts follow the company calendar through midnight, not browser or UTC dates', () => {
  const midnightUtc = new Date('2026-10-02T00:30:00Z');
  assert.equal(companyCalendarDate(midnightUtc, 'America/Chicago'), '2026-10-01');
  assert.equal(getLfdTodayAlerts([load], midnightUtc, 'America/Chicago').length, 1);
  assert.equal(getLfdTodayAlerts([load], midnightUtc, 'UTC').length, 0);
  assert.equal(getLfdTodayAlerts([load], new Date('2026-10-02T05:00:00Z')).length, 0);
});
test('past, future, invalid and finished loads do not alert', () => {
  for (const lastFreeDay of ['2026-09-30', '2026-10-02', '2026-02-30', '', 'bad']) {
    assert.equal(getLfdTodayAlerts([{ ...load, lastFreeDay }], today).length, 0);
  }
  for (const status of ['Completed', 'Delivered', 'Cancelled', 'CANCELED']) {
    assert.equal(getLfdTodayAlerts([{ ...load, status }], today).length, 0);
  }
  assert.equal(getLfdTodayAlerts([{ ...load, deletedAt: '2026-10-01' }], today).length, 0);
});
test('date-only values and legacy missing-driver labels remain valid', () => {
  assert.equal(lfdCalendarDate('2026-10-01'), '2026-10-01');
  assert.equal(lfdCalendarDate('2026-10-01T00:00:00Z'), '2026-10-01');
  assert.equal(lfdCalendarDate('10/1/2026'), '2026-10-01');
  for (const driver of [null, ' ', 'No Driver', '-- No Driver --', 'Assign later', 'Not assigned', 'Unassigned']) {
    assert.equal(getLfdTodayAlerts([{ ...load, driver, lastFreeDay: '', lfd: '2026-10-01' }], today).length, 1);
  }
});

test('priority watch includes past, today and tomorrow, ordered by urgency and stable container order', async () => {
  const { getLfdPriorityAlerts } = await import('../../src/utils/lfdAlerts.js');
  const rows = ['2026-10-02','2026-09-28','2026-10-01','2026-10-03'].map((lastFreeDay,i)=>({...load,id:String(i),lastFreeDay}));
  assert.deepEqual(getLfdPriorityAlerts(rows,today).map(a=>[a.days,a.priority]),[[-3,'overdue'],[0,'today'],[1,'tomorrow']]);
  assert.equal(getLfdPriorityAlerts(rows.map(l=>({...l,driver:'DRV-A'})),today).length,0);
  assert.equal(getLfdPriorityAlerts(rows.map(l=>({...l,status:'Completed'})),today).length,0);
  assert.equal(getLfdPriorityAlerts([{...load,lastFreeDay:'invalid'}],today).length,0);
});
test('priority watch respects DST calendar boundaries and restores removed assignments', async () => {
  const { getLfdPriorityAlerts } = await import('../../src/utils/lfdAlerts.js');
  const day = new Date('2026-11-01T18:00:00Z');
  const row = {...load,lastFreeDay:'2026-11-02'};
  assert.equal(getLfdPriorityAlerts([row],day)[0].days,1);
  assert.equal(getLfdPriorityAlerts([{...row,driver:'DRV-A'}],day).length,0);
  assert.equal(getLfdPriorityAlerts([{...row,driver:'',currentMove:{driverId:'DRV-A'}}],day).length,1);
});

test('yard and customer drops clear both LFD lists without an assigned driver', async () => {
  const { getLfdPriorityAlerts } = await import('../../src/utils/lfdAlerts.js');
  for (const dropType of ['Yard', 'Customer']) {
    const dropped = {...load, driver:'', status:'Dropped', dropType};
    assert.equal(getLfdTodayAlerts([dropped],today).length,0);
    for (const lastFreeDay of ['2026-09-30','2026-10-01','2026-10-02']) {
      assert.equal(getLfdPriorityAlerts([{...dropped,lastFreeDay}],today).length,0);
    }
  }
});
test('completed drop history keeps alert cleared after next driver assignment and removal', async () => {
  const { getLfdPriorityAlerts } = await import('../../src/utils/lfdAlerts.js');
  for (const moveType of ['PRE_PULL','DROP']) {
    for (const driver of ['DRV-B','']) {
      const nextLeg = {...load,status:'Dispatched',driver,moves:[
        {moveType,status:'Completed',driverId:'DRV-A'},
        {moveType:'DELIVERY',status:driver?'Assigned':'Planned',driverId:driver},
      ]};
      assert.equal(getLfdTodayAlerts([nextLeg],today).length,0);
      assert.equal(getLfdPriorityAlerts([nextLeg],today).length,0);
    }
  }
  assert.equal(getLfdPriorityAlerts([{...load,dropMoveStatus:'Complete'}],today).length,0);
});
test('planned or cancelled drops do not hide a pickup deadline', async () => {
  const { getLfdPriorityAlerts } = await import('../../src/utils/lfdAlerts.js');
  for (const status of ['Planned','Assigned','Cancelled']) {
    const notDropped = {...load,dropType:'Yard',dropLocation:'Main Yard',dropDateTime:'2026-10-01T10:00:00Z',dropMoveStatus:status,moves:[{moveType:'PRE_PULL',status}]};
    assert.equal(getLfdTodayAlerts([notDropped],today).length,1);
    assert.equal(getLfdPriorityAlerts([notDropped],today).length,1);
  }
});
