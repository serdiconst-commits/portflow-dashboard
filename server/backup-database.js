import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

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
