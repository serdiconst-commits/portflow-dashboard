import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('completing a load preserves its driver and truck assignment', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('const updateCurrentMoveForLoadStatus');
  const end = source.indexOf("app.put('/api/loads/:id/status'", start);
  const updateCurrentMove = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'load status movement helper was not found');
  assert.match(
    updateCurrentMove,
    /const releaseAssignment = Boolean\(nextMove\) && nextLoadStatus !== 'Delivered'/
  );
  assert.match(updateCurrentMove, /driver = CASE WHEN \? = 1 THEN '' ELSE driver END/);
  assert.match(updateCurrentMove, /truck = CASE WHEN \? = 1 THEN '' ELSE truck END/);
});
