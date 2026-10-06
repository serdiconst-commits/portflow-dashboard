import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import sqlite3 from 'sqlite3';
import { dbRun, dbGet } from '../services/dbUtils.js';
import { normalizePortDateTime, formatPortDateTime } from '../../shared/exportReceiving.js';
import { normalizeBookings } from '../portHoustonBookings.js';

test('receiving dates use Houston time in summer and winter, preserving wall times', () => {
  assert.equal(normalizePortDateTime('2026-10-05T13:00:00Z'),'2026-10-05T08:00');
  assert.equal(normalizePortDateTime('2026-12-05T13:00:00Z'),'2026-12-05T07:00');
  assert.equal(normalizePortDateTime('2026-10-05T08:00'),'2026-10-05T08:00');
  assert.equal(formatPortDateTime('2026-10-05T08:00'),'10/5/2026 8:00 AM');
  assert.equal(normalizePortDateTime('invalid'),'');
  const [record] = normalizeBookings([{nbr:'123',subType:'BOOK',timeBeginReceive:'2026-10-05T13:00:00Z',timeCargoCutoff:'2026-10-09T22:00:00Z'}],'123');
  assert.equal(record.beginReceiving,'2026-10-05T08:00');
  assert.equal(record.exportCutoff,'2026-10-09T17:00');
  assert.equal(normalizeBookings([{nbr:'123',subType:'BOOK'}],'123')[0].exportCutoff,'');
});

test('real EVP millisecond dates for booking 276944584 populate receiving and cutoff', () => {
  const [record] = normalizeBookings([{
    nbr: '276944584', subType: 'BOOK',
    timeBeginReceive: 1791349200000,
    timeCargoCutoff: 1791846000000,
    visit: { facilityId: 'BPT' },
  }], '276944584');
  assert.equal(record.beginReceiving, '2026-10-07T00:00');
  assert.equal(record.exportCutoff, '2026-10-12T18:00');
  assert.equal(formatPortDateTime(record.beginReceiving), '10/7/2026 12:00 AM');
  assert.equal(formatPortDateTime(record.exportCutoff), '10/12/2026 6:00 PM');
  assert.equal(normalizePortDateTime('1791349200000'), record.beginReceiving);
  assert.equal(normalizePortDateTime(Date.parse('2026-12-05T13:00:00Z')), '2026-12-05T07:00');
  for (const value of [null, undefined, '', 0, NaN, Infinity, -1, 1.5, 9999999999999999]) {
    assert.equal(normalizePortDateTime(value), '');
  }
});

test('export dates migrate, persist on creation, survive legacy edits and can be cleared without replacing LFD', async t => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../database.js', import.meta.url), 'utf8');
  const insert = source.slice(source.indexOf("app.post('/api/loads'")).match(/`(INSERT INTO loads \([\s\S]*?)`,\s*(\[[\s\S]*?\]),\s*function/);
  const update = source.slice(source.indexOf("app.put('/api/loads/:id'")).match(/`(UPDATE loads SET[\s\S]*?)`,\s*(\[[\s\S]*?\]),\s*function/);
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  let create = schema.match(/CREATE TABLE IF NOT EXISTS loads \([\s\S]*?\)/)[0];
  for (const field of ['loadType','beginReceiving','exportCutoff']) create=create.replace(`  ${field} TEXT,`,'');
  await dbRun(db, create);
  for (const match of schema.matchAll(/ALTER TABLE loads ADD COLUMN [a-zA-Z][^`]+/g)) {
    try { await dbRun(db,match[0]); } catch(error) { if (!error.message.includes('duplicate column name')) throw error; }
  }
  await dbRun(db,'ALTER TABLE loads ADD COLUMN miles REAL DEFAULT 0');
  await dbRun(db,'ALTER TABLE loads ADD COLUMN pod TEXT');
  const context = {
    generatedLoadId:'EXPORT-TEST',loadId:'EXPORT-TEST',companyId:'COMP-A',normalizedDriver:'',normalizedDroppedBy:'',nextStatus:'Pending',
    nextWorkflowType:'LIVE_DELIVERY',isTruthy:Boolean,parseNumericField:v=>Number(v)||0,
    body:{lastFreeDay:'2026-10-01'},existingLoad:{},
    l:{loadType:'EXPORT',beginReceiving:'2026-10-05T08:00',exportCutoff:'2026-10-09T17:00',lastFreeDay:'2026-10-01',pickup:'Bayport',returnLocation:'Bayport'},
  };
  await dbRun(db,insert[1],vm.runInNewContext(insert[2],context));
  const read=()=>dbGet(db,'SELECT * FROM loads WHERE id = ?',['EXPORT-TEST']);
  let row=await read();
  assert.equal(row.loadType,'EXPORT');assert.equal(row.beginReceiving,'2026-10-05T08:00');assert.equal(row.exportCutoff,'2026-10-09T17:00');
  context.existingLoad=row;
  context.l={};
  await dbRun(db,update[1],vm.runInNewContext(update[2],context));
  row=await read();
  assert.equal(row.loadType,'EXPORT');assert.equal(row.beginReceiving,'2026-10-05T08:00');assert.equal(row.exportCutoff,'2026-10-09T17:00');
  assert.equal(row.lastFreeDay,'2026-10-01');
  context.existingLoad=row;
  context.l={exportCutoff:'',beginReceiving:''};
  await dbRun(db,update[1],vm.runInNewContext(update[2],context));
  assert.equal((await read()).exportCutoff,'');assert.equal((await read()).lastFreeDay,'2026-10-01');
});
