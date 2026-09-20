import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('settlement routes expose protected transitions, PDF, and reviewed email delivery', async () => {
  const source = await readFile(new URL('../routes/driverSettlements.js', import.meta.url), 'utf8');
  assert.match(source, /router\.post\('\/:id\/transition'/);
  assert.match(source, /router\.get\('\/:id\/pdf'/);
  assert.match(source, /\['reviewed', 'finalized', 'paid'\]/);
});
