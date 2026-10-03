import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import sqlite3 from 'sqlite3';
import { dbRun, dbGet } from '../services/dbUtils.js';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../database.js', import.meta.url), 'utf8');
const insert = source.slice(source.indexOf("app.post('/api/loads'")).match(/`(INSERT INTO loads \([\s\S]*?)`,\s*(\[[\s\S]*?\]),\s*function/);
const update = source.slice(source.indexOf("app.put('/api/loads/:id'")).match(/`(UPDATE loads SET[\s\S]*?)`,\s*(\[[\s\S]*?\]),\s*function/);

test('Appointment # persists through create, edit and legacy updates without changing other references', async t => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  // Start with the existing schema to exercise the additive migration too.
  const create = schema.match(/CREATE TABLE IF NOT EXISTS loads \([\s\S]*?\)/)[0];
  await dbRun(db, create.replace('  appointmentNumber TEXT,', ''));
  for (const match of schema.matchAll(/ALTER TABLE loads ADD COLUMN [a-zA-Z][^`]+/g)) {
    try { await dbRun(db, match[0]); } catch (err) {
      if (!err.message.includes('duplicate column name')) throw err;
    }
  }
  await dbRun(db, 'ALTER TABLE loads ADD COLUMN miles REAL DEFAULT 0');
  await dbRun(db, 'ALTER TABLE loads ADD COLUMN pod TEXT');
  const context = {
    generatedLoadId: 'APPT-QA', loadId: 'APPT-QA', companyId: 'COMP-A',
    normalizedDriver: 'DRV-A', normalizedDroppedBy: '', nextStatus: 'Dispatched',
    nextWorkflowType: 'LIVE_DELIVERY', isTruthy: Boolean, parseNumericField: v => Number(v) || 0,
    body: {}, existingLoad: {},
    l: { appointmentNumber: '  001-APT  ', reservationNumber: 'RES-01', returnNumber: 'RET-02', appointmentTime: '2026-10-10T09:00' },
  };
  await dbRun(db, insert[1], vm.runInNewContext(insert[2], context));
  const read = () => dbGet(db, 'SELECT * FROM loads WHERE id = ?', ['APPT-QA']);
  assert.equal((await read()).appointmentNumber, '001-APT');
  for (const [value, expected] of [['002-APT', '002-APT'], [undefined, '002-APT'], ['', '']]) {
    context.existingLoad = await read();
    context.l.appointmentNumber = value;
    await dbRun(db, update[1], vm.runInNewContext(update[2], context));
    const row = await read();
    assert.equal(row.appointmentNumber, expected);
    assert.equal(row.reservationNumber, 'RES-01');
    assert.equal(row.returnNumber, 'RET-02');
    assert.equal(row.appointmentTime, '2026-10-10T09:00');
  }
});
