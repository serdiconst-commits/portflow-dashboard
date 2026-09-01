import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dropped Drop & Pick loads can repair a missing pickup-return movement', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/loads/:id/pickup-return'");
  const end = source.indexOf("app.put('/api/load-moves/:id/ready'", start);
  const route = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'pickup-return repair route was not found');
  assert.match(route, /normalizeLoadWorkflow\(load\.workflowType\) !== 'DROP_AND_PICK'/);
  assert.match(route, /moveType: 'PICKUP_RETURN'/);
  assert.match(route, /status: 'Waiting Customer'/);
  assert.match(route, /action: 'MOVE_PLAN_REPAIRED'/);
});
