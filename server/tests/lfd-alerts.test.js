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
