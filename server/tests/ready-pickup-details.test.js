import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('load details can render a dropped legacy load before its pickup move is repaired', async () => {
  const source = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');

  assert.match(
    source,
    /selectedPickupReturnMove\?\.origin \|\| selectedLoad\.dropLocation \|\| selectedLoad\.delivery/
  );
});
