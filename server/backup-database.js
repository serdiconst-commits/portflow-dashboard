import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(filename), '..');
const open = (file) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, err => err ? reject(err) : resolve(db));
});
const close = db => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
export async function verifyDatabase(file) {
  const db = await open(file);
  try {
    const rows = await new Promise((resolve, reject) => db.all('PRAGMA integrity_check', (err, rows) => err ? reject(err) : resolve(rows)));
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('Backup integrity check failed.');
  } finally { await close(db); }
}

export async function runBackup({ retentionDays = process.env.BACKUP_RETENTION_DAYS ?? 14,
  dbPath = process.env.DB_PATH ? path.resolve(process.cwd(), process.env.DB_PATH) : path.join(rootDir, 'server/portflow.db'),
  backupDir = process.env.BACKUP_DIR ? path.resolve(process.cwd(), process.env.BACKUP_DIR) : path.join(rootDir, 'backups') } = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days < 0) throw new Error('Invalid backup retention.');
  await fs.access(dbPath);
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `portflow-${stamp}-${randomUUID()}.db`);
  const partial = `${target}.partial`;
  const db = await open(dbPath);
  try {
    db.configure('busyTimeout', 30000);
    // Includes committed WAL pages and leaves the live database unchanged.
    await new Promise((resolve, reject) => db.run('VACUUM INTO ?', [partial], err => err ? reject(err) : resolve()));
    await fs.chmod(partial, 0o600);
    await verifyDatabase(partial);
    await fs.rename(partial, target);
  } catch (err) {
    await fs.rm(partial, { force: true });
    throw err;
  } finally { await close(db); }
  // Prune only after a new, verified database has been published. Zero disables pruning.
  if (days > 0) {
    const cutoff = Date.now() - days * 86400000;
    for (const name of await fs.readdir(backupDir)) {
      if (!/^portflow-[\dT-]+(?:Z)(?:-[a-f\d-]+)?\.db$/.test(name)) continue;
      const file = path.join(backupDir, name);
      const stat = await fs.lstat(file);
      if (file !== target && stat.isFile() && stat.mtimeMs < cutoff) await fs.unlink(file);
    }
  }
  console.log(`Verified database backup created: ${target}`);
  return target;
}
if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  runBackup().catch(err => { console.error('Backup failed:', err.message); process.exitCode = 1; });
}
