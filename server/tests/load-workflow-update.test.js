import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('edit-load route normalizes workflows and resyncs the remaining movement plan', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf("app.put('/api/loads/:id'");
  const end = source.indexOf("app.put('/api/loads/:id/drop-hook'", start);
  const updateRoute = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'edit-load route was not found');
  assert.match(updateRoute, /const nextWorkflowType = normalizeLoadWorkflow/);
  assert.match(updateRoute, /nextWorkflowType === 'PRE_PULL_LIVE' && !nextDropLocation/);
  assert.match(updateRoute, /syncLoadMoves\(updatedLoad/);
  assert.match(updateRoute, /attachMovesToLoads\(\[updatedLoad\]/);
});
