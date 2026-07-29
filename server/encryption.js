import crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
const DEV_ENCRYPTION_KEY = 'portflow-dev-encryption-key-change-before-production';
const ENCRYPTION_KEY_SOURCE = process.env.ENCRYPTION_KEY || (!isProduction ? DEV_ENCRYPTION_KEY : '');

if (!ENCRYPTION_KEY_SOURCE) {
  throw new Error('ENCRYPTION_KEY is required when NODE_ENV=production');
}

const key = crypto.createHash('sha256').update(ENCRYPTION_KEY_SOURCE).digest();
const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'v1:';

export const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

export const encrypt = (plaintext) => {
  const text = String(plaintext ?? '');
  if (!text) return '';

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
};

export const decrypt = (payload) => {
  if (!isEncrypted(payload)) return payload || '';

  try {
    const [ivHex, authTagHex, cipherHex] = payload.slice(PREFIX.length).split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    console.error('Failed to decrypt value:', error.message);
    return '';
  }
};

export const safeCompare = (a, b) => {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};
