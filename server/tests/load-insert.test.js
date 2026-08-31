import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('create-load INSERT has one placeholder for every column', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const createRoute = source.slice(source.indexOf("app.post('/api/loads'"));
  const insert = createRoute.match(/INSERT INTO loads \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)`/);

  assert.ok(insert, 'create-load INSERT statement was not found');

  const columns = insert[1]
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
  const placeholders = insert[2].match(/\?/g) || [];

  assert.equal(placeholders.length, columns.length);
});
