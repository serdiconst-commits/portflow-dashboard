import 'dotenv/config';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { verifyRecoveryBundle } from './recovery-bundle.js';

export function backupConfig(env = process.env) {
  const endpoint = String(env.BACKUP_R2_ENDPOINT || '').replace(/\/$/, '');
  if (!/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint)) throw new Error('Invalid BACKUP_R2_ENDPOINT.');
  const bucket = env.BACKUP_R2_BUCKET;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '')) throw new Error('Invalid BACKUP_R2_BUCKET.');
  if (!env.BACKUP_R2_ACCESS_KEY_ID || !env.BACKUP_R2_SECRET_ACCESS_KEY) throw new Error('R2 backup credentials are missing.');
  if (!/^[a-f0-9]{64}$/i.test(env.BACKUP_ENCRYPTION_KEY || '')) throw new Error('BACKUP_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  return { endpoint, bucket, key: Buffer.from(env.BACKUP_ENCRYPTION_KEY, 'hex'), credentials: {
    accessKeyId: env.BACKUP_R2_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_R2_SECRET_ACCESS_KEY,
  } };
}
export function backupClient(config) {
  return new S3Client({ region: 'auto', endpoint: config.endpoint, credentials: config.credentials,
    maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
}
const send = (client, command) => client.send(command, { abortSignal: AbortSignal.timeout(300000) });
const magic = Buffer.from('PFB1');
export async function encryptBackupFile(source, target, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(magic);
  await fs.writeFile(target, Buffer.concat([magic, nonce]), { flag: 'wx', mode: 0o600 });
  await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: 'a' }));
  await fs.appendFile(target, cipher.getAuthTag());
}
export async function decryptBackupFile(source, target, key) {
  const size = (await fs.stat(source)).size;
  if (size < 32) throw new Error('Invalid encrypted backup.');
  const handle = await fs.open(source, 'r');
  const header = Buffer.alloc(16), tag = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); await handle.read(tag, 0, 16, size - 16); }
  finally { await handle.close(); }
  if (!header.subarray(0, 4).equals(magic)) throw new Error('Unsupported encrypted backup format.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(4));
  decipher.setAAD(magic); decipher.setAuthTag(tag);
  // Reserve a new destination and never overwrite existing plaintext.
  const reserved = await fs.open(target, 'wx', 0o600);
  await reserved.close();
  try {
    if (size === 32) decipher.final();
    else await pipeline(createReadStream(source, { start: 16, end: size - 17 }), decipher, createWriteStream(target, { flags: 'r+' }));
  } catch {
    await fs.rm(target, { force: true });
    throw new Error('Backup authentication failed; no restored file was retained.');
  }
}
async function download(client, config, object, destination) {
  const result = await send(client, new GetObjectCommand({ Bucket: config.bucket, Key: object }));
  if (!result.Body) throw new Error('Empty R2 response.');
  await pipeline(result.Body, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
}
export async function uploadRecoveryBundle(bundle, config, client = backupClient(config)) {
  const manifest = await verifyRecoveryBundle(bundle);
  const id = randomUUID();
  const prefix = `recovery/${id}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'portflow-r2-'));
  const index = { version: 1, files: [] };
  try {
    for (const name of [...manifest.files.map(row => row.name), 'manifest.json']) {
      const number = index.files.length;
      const encrypted = path.join(temp, `${number}.enc`);
      await encryptBackupFile(path.join(bundle, name), encrypted, config.key);
      const object = `${prefix}/${number}.enc`;
      await send(client, new PutObjectCommand({ Bucket: config.bucket, Key: object,
        Body: createReadStream(encrypted), ContentLength: (await fs.stat(encrypted)).size, ContentType: 'application/octet-stream', IfNoneMatch: '*' }));
      // Read back and authenticate every uploaded object before committing its index.
      const readback = path.join(temp, `${number}.readback`), plain = path.join(temp, `${number}.plain`);
      await download(client, config, object, readback);
      await decryptBackupFile(readback, plain, config.key);
      // Compare bytes by streaming hash without loading large backups into memory.
      const { createHash } = await import('node:crypto');
      const digest = async file => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
      if (await digest(plain) !== await digest(path.join(bundle, name))) throw new Error('R2 readback mismatch.');
      index.files.push({ name, object });
      await Promise.all([encrypted, readback, plain].map(file => fs.unlink(file)));
    }
    await verifyRecoveryBundle(bundle);
    const indexFile = path.join(temp, 'index.json'), sealed = path.join(temp, 'index.enc');
    await fs.writeFile(indexFile, JSON.stringify(index), { mode: 0o600 });
    await encryptBackupFile(indexFile, sealed, config.key);
    const object = `${prefix}/index.enc`;
    await send(client, new PutObjectCommand({ Bucket: config.bucket, Key: object, Body: createReadStream(sealed),
      ContentLength: (await fs.stat(sealed)).size, ContentType: 'application/octet-stream', IfNoneMatch: '*' }));
    await download(client, config, object, path.join(temp, 'index.readback'));
    await decryptBackupFile(path.join(temp, 'index.readback'), path.join(temp, 'index.verified'), config.key);
    if (!(await fs.readFile(indexFile)).equals(await fs.readFile(path.join(temp, 'index.verified')))) throw new Error('R2 index verification failed.');
    return object;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
export async function downloadRecoveryBundle(object, destination, config, client = backupClient(config)) {
  if (!/^recovery\/[a-f0-9-]{36}\/index\.enc$/.test(object)) throw new Error('Invalid backup index key.');
  const prefix = object.slice(0, -'index.enc'.length);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'portflow-r2-restore-'));
  try {
    await download(client, config, object, path.join(temp, 'index.enc'));
    await decryptBackupFile(path.join(temp, 'index.enc'), path.join(temp, 'index.json'), config.key);
    if ((await fs.stat(path.join(temp, 'index.json'))).size > 16 * 1024 * 1024) throw new Error('Backup index too large.');
    const index = JSON.parse(await fs.readFile(path.join(temp, 'index.json'), 'utf8'));
    if (index.version !== 1 || !Array.isArray(index.files) || !index.files.length) throw new Error('Invalid backup index.');
    const names = new Set();
    for (const row of index.files) {
      if (typeof row.name !== 'string' || !/^(portflow\.db|manifest\.json|uploads\/.+)$/.test(row.name) ||
          row.name.split('/').some(part => !part || part === '.' || part === '..') || row.name.includes('\\') || row.name.includes('\0') ||
          names.has(row.name) || !row.object.startsWith(prefix) || !/^\d+\.enc$/.test(row.object.slice(prefix.length))) throw new Error('Unsafe backup index.');
      names.add(row.name);
    }
    const staging = path.join(temp, 'bundle'); await fs.mkdir(staging, { mode: 0o700 });
    for (let i = 0; i < index.files.length; i++) {
      const row = index.files[i], encrypted = path.join(temp, `${i}.enc`), plain = path.join(staging, row.name);
      await fs.mkdir(path.dirname(plain), { recursive: true, mode: 0o700 });
      await download(client, config, row.object, encrypted);
      await decryptBackupFile(encrypted, plain, config.key);
      await fs.unlink(encrypted);
    }
    await verifyRecoveryBundle(staging);
    await fs.mkdir(destination, { mode: 0o700 });
    for (const name of await fs.readdir(staging)) await fs.cp(path.join(staging, name), path.join(destination, name), { recursive: true, force: false, errorOnExist: true });
    await verifyRecoveryBundle(destination);
    return destination;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, destination] = process.argv.slice(2);
  try {
    const config = backupConfig();
    if (command === 'upload' && source) console.log('Verified R2 backup index:', await uploadRecoveryBundle(source, config));
    else if (command === 'download' && source && destination) { await downloadRecoveryBundle(source, destination, config); console.log('Downloaded and verified recovery bundle.'); }
    else throw new Error('Use upload <verified-bundle> or download <index-key> <new-directory>.');
  } catch { console.error('R2 backup operation failed. Check configuration, permissions, connectivity and available disk space.'); process.exitCode = 1; }
}
