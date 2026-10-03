import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocumentDate } from '../../shared/documentDates.js';
test('document dates use M/D/YYYY without shifting calendar days', () => {
  for (const date of ['2026-10-03','2026-10-03T00:00:00Z','2026-10-03T23:00:00-07:00','10/03/2026']) assert.equal(formatDocumentDate(date),'10/3/2026');
  assert.equal(formatDocumentDate('2026-01-02'),'1/2/2026');
  assert.equal(formatDocumentDate('2024-02-29'),'2/29/2024');
  for (const value of [null,'','invalid','2026-02-29','2026-13-01']) assert.equal(formatDocumentDate(value,'-'),'-');
});
