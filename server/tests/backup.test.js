import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sqlite3 from 'sqlite3';
import { runBackup } from '../backup-database.js';
import { createRecoveryBundle, restoreRecoveryBundle, verifyRecoveryBundle } from '../recovery-bundle.js';
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, e => e ? reject(e) : resolve()));
const close = db => new Promise(resolve => db.close(resolve));
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portflow-backup-test-'));
  const dbPath = path.join(dir, 'live.db');
  const db = new sqlite3.Database(dbPath);
  await exec(db, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE loads(id TEXT, pay INTEGER); INSERT INTO loads VALUES ('DROP',125),('PICKUP',80)");
  const uploadsDir = path.join(dir, 'uploads'); await fs.mkdir(uploadsDir);
  await fs.writeFile(path.join(uploadsDir, 'pod.pdf'), 'Synthetic document');
  t.after(async () => { await close(db); await fs.rm(dir, { recursive: true, force: true }); });
  return {dir,db,dbPath,uploadsDir};
}
test('verified snapshot includes committed WAL data and leaves original usable', async t => {
  const f = await fixture(t);
  const backup = await runBackup({dbPath:f.dbPath,backupDir:path.join(f.dir,'backups')});
  const copy = new sqlite3.Database(backup);
  const rows = await new Promise((resolve,reject)=>copy.all('SELECT * FROM loads ORDER BY id',(e,r)=>e?reject(e):resolve(r)));
  assert.deepEqual(rows,[{id:'DROP',pay:125},{id:'PICKUP',pay:80}]);
  await close(copy); await exec(f.db,"INSERT INTO loads VALUES ('NEXT',25)");
});
test('bundle restores database and documents to a new directory and rejects tampering or overwrite', async t => {
  const f = await fixture(t);
  const options={dbPath:f.dbPath,uploadsDir:f.uploadsDir,outputDir:path.join(f.dir,'bundles')};
  await assert.rejects(createRecoveryBundle(options), /Pause/);
  const bundle=await createRecoveryBundle({...options,writesPaused:true});
  const target=path.join(f.dir,'restored');
  await restoreRecoveryBundle(bundle,target);
  assert.equal(await fs.readFile(path.join(target,'uploads/pod.pdf'),'utf8'),'Synthetic document');
  await assert.rejects(restoreRecoveryBundle(bundle,target), /EEXIST/);
  await fs.writeFile(path.join(bundle,'uploads/pod.pdf'),'damaged');
  await assert.rejects(verifyRecoveryBundle(bundle), /checksum/);
});
test('failed backups retain existing copies and do not create missing source databases', async t => {
  const f=await fixture(t); const dest=path.join(f.dir,'backups');await fs.mkdir(dest);
  await fs.writeFile(path.join(dest,'keep.db'),'keep');
  await assert.rejects(runBackup({dbPath:path.join(f.dir,'missing.db'),backupDir:dest}));
  assert.equal(await fs.readFile(path.join(dest,'keep.db'),'utf8'),'keep');
  await assert.rejects(fs.access(path.join(f.dir,'missing.db')));
});
