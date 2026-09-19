import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { backupConfig, backupClient, uploadRecoveryBundle, downloadRecoveryBundle } from './r2-backups.js';
import { createRecoveryBundle } from './recovery-bundle.js';

// Deliberately never imports server/database.js or uses DB_PATH / UPLOADS_DIR.
let temp, client;
try {
  const config = backupConfig();
  client = backupClient(config);
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'portflow-r2-self-test-'));
  const dbPath = path.join(temp, 'synthetic.db'), uploadsDir = path.join(temp, 'uploads');
  const db = new sqlite3.Database(dbPath);
  try {
    await new Promise((resolve,reject) => db.exec("CREATE TABLE qa_backup_probe (message TEXT); INSERT INTO qa_backup_probe VALUES ('PORTFLOW SYNTHETIC BACKUP TEST - NO CUSTOMER DATA')", err => err ? reject(err) : resolve()));
  } finally { await new Promise((resolve,reject) => db.close(err => err ? reject(err) : resolve())); }
  await fs.mkdir(uploadsDir);
  await fs.writeFile(path.join(uploadsDir, 'synthetic.txt'), 'PORTFLOW SYNTHETIC DOCUMENT - NO CUSTOMER DATA');
  const bundle = await createRecoveryBundle({ dbPath, uploadsDir, outputDir: path.join(temp, 'bundles'), writesPaused: true });
  const index = await uploadRecoveryBundle(bundle, config, client);
  const restored = await downloadRecoveryBundle(index, path.join(temp, 'restored'), config, client);
  if ((await fs.readFile(path.join(restored, 'uploads/synthetic.txt'), 'utf8')) !== 'PORTFLOW SYNTHETIC DOCUMENT - NO CUSTOMER DATA') throw new Error('Restore mismatch');
  console.log(JSON.stringify({ ok: true, check: 'synthetic-r2-round-trip', encrypted: true, restored: true, index, productionDataAccessed: false }));
} catch (err) {
  console.error(JSON.stringify({ ok: false, check: 'synthetic-r2-round-trip', httpStatus: err?.$metadata?.httpStatusCode || null,
    configurationError: /^(Invalid BACKUP_R2_|R2 backup credentials|BACKUP_ENCRYPTION_KEY)/.test(err?.message || '') ? err.message : undefined }));
  process.exitCode = 1;
} finally {
  client?.destroy();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
}
