import test from 'node:test';
import assert from 'node:assert/strict';
import { previousPayrollPeriod } from '../../src/utils/payrollPeriod.js';

test('payroll defaults to the previous Monday through Friday throughout the current week', () => {
  for (let day = 12; day <= 18; day++) {
    assert.deepEqual(previousPayrollPeriod(new Date(`2026-10-${day}T18:00:00Z`)), {
      start: '2026-10-05', end: '2026-10-09',
    });
  }
});

test('payroll follows company midnight and handles year and DST boundaries', () => {
  const cases = [
    ['2026-10-19T04:59:59Z', '2026-10-05', '2026-10-09'],
    ['2026-10-19T05:00:00Z', '2026-10-12', '2026-10-16'],
    ['2026-01-05T18:00:00Z', '2025-12-29', '2026-01-02'],
    ['2026-03-09T18:00:00Z', '2026-03-02', '2026-03-06'],
    ['2026-11-02T18:00:00Z', '2026-10-26', '2026-10-30'],
  ];
  for (const [now, start, end] of cases) {
    assert.deepEqual(previousPayrollPeriod(new Date(now)), { start, end });
  }
  assert.deepEqual(previousPayrollPeriod(new Date('2026-10-19T05:00:00Z'), 'America/Los_Angeles'), {
    start: '2026-10-05', end: '2026-10-09',
  });
});
