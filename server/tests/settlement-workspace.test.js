import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('settlement workspace keeps weekly navigation and all drivers on one screen', async () => {
  const source = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /className="settlement-week-rail"/);
  assert.match(source, /settlementWorkspaceDrivers\.map/);
  assert.match(source, /setSelectedSettlementDriverId\(driver\.id\)/);
  assert.match(source, /Mark Reviewed/);
  assert.match(source, /Finalize Settlement/);
  assert.match(source, /Download PDF/);
  assert.match(source, /Send to Driver/);
});

test('settlement routes expose protected transitions, PDF, and reviewed email delivery', async () => {
  const source = await readFile(new URL('../routes/driverSettlements.js', import.meta.url), 'utf8');
  assert.match(source, /router\.post\('\/:id\/transition'/);
  assert.match(source, /router\.get\('\/:id\/pdf'/);
  assert.match(source, /\['reviewed', 'finalized'\]/);
});
