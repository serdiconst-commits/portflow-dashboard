import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import sqlite3 from 'sqlite3';
import { createRecoveryBundle } from '../recovery-bundle.js';
import { backupConfig, encryptBackupFile, decryptBackupFile, uploadRecoveryBundle, downloadRecoveryBundle } from '../r2-backups.js';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r2-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('encryption authenticates plaintext, rejects wrong keys and tampering, and never overwrites files', async t => {
  const dir = await fixture(t), key = randomBytes(32), input = path.join(dir,'source');
  await fs.writeFile(input, 'private backup contents');
  const encrypted = path.join(dir,'sealed'); await encryptBackupFile(input,encrypted,key);
  assert(!(await fs.readFile(encrypted)).includes(Buffer.from('private backup contents')));
  await decryptBackupFile(encrypted,path.join(dir,'restored'),key);
  assert.equal(await fs.readFile(path.join(dir,'restored'),'utf8'),'private backup contents');
  await assert.rejects(decryptBackupFile(encrypted,input,key),/EEXIST/);
  await assert.rejects(decryptBackupFile(encrypted,path.join(dir,'bad'),randomBytes(32)),/authentication/);
  await assert.rejects(fs.access(path.join(dir,'bad')));
  const data=await fs.readFile(encrypted);data[20]^=1;await fs.writeFile(encrypted,data);
  await assert.rejects(decryptBackupFile(encrypted,path.join(dir,'bad'),key),/authentication/);
});
test('R2 round trip restores database and POD; failed uploads never publish the index', async t => {
  const dir=await fixture(t), dbPath=path.join(dir,'source.db'), uploadsDir=path.join(dir,'uploads');
  const db=new sqlite3.Database(dbPath);
  await new Promise((resolve,reject)=>db.exec("CREATE TABLE loads(id TEXT);INSERT INTO loads VALUES ('QA-ONLY')",e=>e?reject(e):resolve()));
  await new Promise(resolve=>db.close(resolve));
  await fs.mkdir(uploadsDir);await fs.writeFile(path.join(uploadsDir,'pod.pdf'),'QA-POD');
  const bundle=await createRecoveryBundle({dbPath,uploadsDir,outputDir:path.join(dir,'bundles'),writesPaused:true});
  const store=new Map();let fail=false;
  const client={async send(command){
    const {Key,Body,Bucket}=command.input;assert.equal(Bucket,'test-bucket');
    if(command.constructor.name==='PutObjectCommand') {
      if(fail) throw new Error('simulated network failure');
      assert.equal(command.input.IfNoneMatch,'*');assert(!store.has(Key));
      const chunks=[];for await(const chunk of Body)chunks.push(chunk);store.set(Key,Buffer.concat(chunks));return {};
    }
    assert(store.has(Key));return {Body:Readable.from([store.get(Key)])};
  }};
  const config={bucket:'test-bucket',key:randomBytes(32)};
  const object=await uploadRecoveryBundle(bundle,config,client);
  assert([...store.values()].every(bytes=>!bytes.includes(Buffer.from('QA-POD'))));
  const destination=path.join(dir,'restored');await downloadRecoveryBundle(object,destination,config,client);
  assert.equal(await fs.readFile(path.join(destination,'uploads/pod.pdf'),'utf8'),'QA-POD');
  await assert.rejects(downloadRecoveryBundle(object,destination,config,client),/EEXIST/);
  const count=store.size;fail=true;await assert.rejects(uploadRecoveryBundle(bundle,config,client),/network/);assert.equal(store.size,count);
  const corrupted=Buffer.from(store.get(object));corrupted[17]^=1;store.set(object,corrupted);
  await assert.rejects(downloadRecoveryBundle(object,path.join(dir,'corrupt'),config,client),/authentication/);
  await assert.rejects(fs.access(path.join(dir,'corrupt')));
});
test('configuration requires separate encryption key and HTTPS Cloudflare endpoint',()=>{
  const env={BACKUP_R2_ENDPOINT:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',BACKUP_R2_BUCKET:'test-bucket',BACKUP_R2_ACCESS_KEY_ID:'test-id',BACKUP_R2_SECRET_ACCESS_KEY:'test-secret',BACKUP_ENCRYPTION_KEY:'a'.repeat(64)};
  assert.equal(backupConfig(env).key.length,32);
  assert.throws(()=>backupConfig({...env,BACKUP_R2_ENDPOINT:'https://attacker.invalid'}),/ENDPOINT/);
  assert.throws(()=>backupConfig({...env,BACKUP_ENCRYPTION_KEY:''}),/ENCRYPTION/);
});
