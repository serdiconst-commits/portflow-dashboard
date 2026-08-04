import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

export const runBackup = ({ retentionDays } = {}) => {
  const dbPath = process.env.DB_PATH
    ? path.resolve(rootDir, process.env.DB_PATH)
    : path.join(__dirname, 'portflow.db');

  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(rootDir, process.env.BACKUP_DIR)
    : path.join(rootDir, 'backups');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `portflow-${timestamp}.db`);

  fs.copyFileSync(dbPath, backupPath);
  console.log(`Database backup created: ${backupPath}`);

  const effectiveRetentionDays = Number(retentionDays ?? process.env.BACKUP_RETENTION_DAYS ?? 14);
  const cutoff = Date.now() - effectiveRetentionDays * 24 * 60 * 60 * 1000;

  const removed = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith('portflow-') && name.endsWith('.db'))
    .filter((name) => {
      const filePath = path.join(backupDir, name);
      return fs.statSync(filePath).mtimeMs < cutoff;
    })
    .map((name) => {
      fs.unlinkSync(path.join(backupDir, name));
      return name;
    });

  if (removed.length) {
    console.log(`Pruned ${removed.length} backup(s) older than ${effectiveRetentionDays} day(s).`);
  }

  return backupPath;
};

const isMain = process.argv[1] === __filename;
if (isMain) {
  runBackup();
}
