import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runBackup, verifyDatabase } from './backup-database.js';

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Recovery bundles do not allow symbolic links.');
    if (entry.isDirectory()) result.push(...await files(path.join(dir, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('Unsupported file in recovery bundle.');
  }
  return result.sort();
}
export async function createRecoveryBundle({ dbPath, uploadsDir, outputDir, writesPaused = false }) {
  if (!writesPaused) throw new Error('Pause application writes before creating a database + documents bundle.');
  const uploads = await fs.realpath(uploadsDir);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const output = await fs.realpath(outputDir);
  if (output === uploads || output.startsWith(uploads + path.sep)) throw new Error('Bundle output must be outside uploads.');
  const staging = await fs.mkdtemp(path.join(output, '.recovery-'));
  const database = await runBackup({ dbPath, backupDir: staging, retentionDays: 0 });
  await fs.rename(database, path.join(staging, 'portflow.db'));
  await fs.mkdir(path.join(staging, 'uploads'), { mode: 0o700 });
  for (const name of await files(uploads)) {
    const destination = path.join(staging, 'uploads', name);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(path.join(uploads, name), destination);
    await fs.chmod(destination, 0o600);
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), files: [] };
  for (const name of await files(staging)) manifest.files.push({ name, sha256: await hash(path.join(staging, name)) });
  await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const destination = path.join(output, path.basename(staging).replace('.recovery-', 'recovery-'));
  await fs.rename(staging, destination);
  return destination;
}
export async function verifyRecoveryBundle(bundle) {
  const names = await files(bundle); // Reject symlinks before reading anything inside.
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid recovery manifest.');
  const expected = manifest.files.map(item => item.name);
  if (new Set(expected).size !== expected.length || !expected.includes('portflow.db') ||
      JSON.stringify([...expected, 'manifest.json'].sort()) !== JSON.stringify(names)) throw new Error('Bundle file list mismatch.');
  for (const item of manifest.files) {
    if (await hash(path.join(bundle, item.name)) !== item.sha256) throw new Error('Bundle checksum mismatch.');
  }
  await verifyDatabase(path.join(bundle, 'portflow.db'));
  return manifest;
}
export async function restoreRecoveryBundle(bundle, destination) {
  await verifyRecoveryBundle(bundle);
  // Exclusive creation: never overwrite an existing directory or live database.
  await fs.mkdir(destination, { mode: 0o700 });
  for (const name of await fs.readdir(bundle)) {
    await fs.cp(path.join(bundle, name), path.join(destination, name), { recursive: true, errorOnExist: true, force: false });
  }
  await verifyRecoveryBundle(destination);
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, destination] = process.argv.slice(2);
  let operation;
  if (command === 'verify' && source) operation = verifyRecoveryBundle(source);
  else if (command === 'restore' && source && destination) operation = restoreRecoveryBundle(source, destination);
  else if (command === 'create' && process.env.BACKUP_WRITES_PAUSED === 'true' && process.env.DB_PATH && process.env.UPLOADS_DIR && source) {
    operation = createRecoveryBundle({ dbPath: path.resolve(process.env.DB_PATH), uploadsDir: path.resolve(process.env.UPLOADS_DIR), outputDir: source, writesPaused: true });
  } else operation = Promise.reject(new Error('Use verify <bundle>, restore <bundle> <new-directory>, or create <output-directory> with DB_PATH, UPLOADS_DIR and BACKUP_WRITES_PAUSED=true.'));
  operation.then(() => console.log('Recovery operation verified.')).catch(err => { console.error(err.message); process.exitCode = 1; });
}
