import { randomBytes, randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { dbGet, dbRun } from './services/dbUtils.js';

// Additive tables: existing users and password hashes are not migrated or rewritten.
export const accountAccessSchema = `
CREATE TABLE IF NOT EXISTS account_access (
  userId TEXT PRIMARY KEY, pending INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0, invitedAt TEXT, activatedAt TEXT
);
CREATE TABLE IF NOT EXISTS account_tokens (
  hash TEXT PRIMARY KEY, userId TEXT NOT NULL, purpose TEXT NOT NULL,
  passwordSnapshot TEXT NOT NULL, emailSnapshot TEXT NOT NULL,
  createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
  consumedAt INTEGER, sentAt INTEGER
);
CREATE INDEX IF NOT EXISTS account_tokens_user ON account_tokens(userId, purpose, createdAt);
`;
export const genericResetMessage = 'If an eligible account exists, a password reset link will arrive by email. Check your spam folder or contact PortFlow for help.';
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const enabled = (status) => ['Active', 'Trial'].includes(status || 'Active');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function accountEmailConfig(env = process.env) {
  const from = env.PORTFLOW_ACCOUNT_FROM_EMAIL || env.DRIVER_COMPLIANCE_FROM_EMAIL;
  const base = new URL(env.PORTFLOW_PUBLIC_URL || 'https://portflow-dashboard.onrender.com');
  if (base.protocol !== 'https:' || base.username || base.password) throw fail(503, 'Account links require a trusted HTTPS PORTFLOW_PUBLIC_URL.');
  if (!env.RESEND_API_KEY || !from) throw fail(503, 'Account email is not configured. Set RESEND_API_KEY and PORTFLOW_ACCOUNT_FROM_EMAIL (or DRIVER_COMPLIANCE_FROM_EMAIL).');
  return { from, origin: base.origin, key: env.RESEND_API_KEY };
}
export async function sendAccountEmail({ to, name, companyName, purpose, token }, env = process.env) {
  const config = accountEmailConfig(env);
  const invite = purpose === 'invite';
  const changed = purpose === 'changed';
  const title = changed ? 'Your PortFlow password was changed' : invite ? 'Activate your PortFlow account' : 'Reset your PortFlow password';
  const url = `${config.origin}/account.html#purpose=${purpose}&token=${token || ''}`;
  const description = changed ? 'Your password was changed. If this was not you, contact PortFlow immediately.' : invite
    ? `You have been invited to manage ${companyName}. Choose your own password to activate your account. This link expires in 24 hours.`
    : 'Use this link to choose a new password. It expires in 30 minutes. If you did not request this, you can ignore this email.';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.from, to: [to], subject: title,
      text: `Hello ${name},\n\n${description}${changed ? '' : `\n\n${url}`}\n\nPortFlow`,
      html: `<div style="font-family:Arial,sans-serif;color:#122b46;max-width:560px;margin:auto;padding:24px"><p style="color:#087e8b;font-weight:bold">PORTFLOW</p><h1 style="font-size:26px">${title}</h1><p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(description)}</p>${changed ? '' : `<p style="margin:30px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1262ef;color:white;padding:14px 22px;border-radius:10px;text-decoration:none">${invite ? 'Activate my account' : 'Reset password'}</a></p><p>This link can only be used once. Do not forward it.</p>`}<p>PortFlow</p></div>`,
    }),
  });
  // Do not log provider payloads, email addresses or reset links.
  if (!response.ok) throw fail(502, 'The email provider did not accept the message. Please try again.');
}

export function createAccountAccessService({ db, sendEmail = sendAccountEmail, checkEmail = accountEmailConfig, now = Date.now, ownerEmail = process.env.PORTFLOW_OWNER_EMAIL || 'oliver@portflow-net.com' }) {
  // A separate connection keeps transactions isolated from the legacy server's callbacks.
  const connection = db.filename && db.filename !== ':memory:' ? new sqlite3.Database(db.filename) : db;
  connection.configure('busyTimeout', 5000);
  let queue = Promise.resolve();
  const exclusive = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const transaction = async (work) => {
    await dbRun(connection, 'BEGIN IMMEDIATE');
    try { const result = await work(); await dbRun(connection, 'COMMIT'); return result; }
    catch (error) { await dbRun(connection, 'ROLLBACK'); throw error; }
  };
  const getUser = (id) => dbGet(connection, `SELECT u.*, c.name AS companyName, c.serviceStatus,
    COALESCE(a.pending,0) AS pending FROM users u LEFT JOIN companies c ON c.id=u.companyId
    LEFT JOIN account_access a ON a.userId=u.id WHERE u.id=?`, [id]);
  const isOwner = (user) => user.role === 'owner' || user.email.toLowerCase() === ownerEmail.toLowerCase();
  const issue = async (user, purpose) => {
    const token = randomBytes(32).toString('base64url');
    const hash = hashToken(token);
    const createdAt = now();
    await transaction(async () => {
      await dbRun(connection, 'DELETE FROM account_tokens WHERE userId=? AND purpose=?', [user.id, purpose]);
      await dbRun(connection, `INSERT INTO account_tokens (hash,userId,purpose,passwordSnapshot,emailSnapshot,createdAt,expiresAt)
        VALUES (?,?,?,?,?,?,?)`, [hash,user.id,purpose,user.password,user.email,createdAt,createdAt+(purpose === 'invite' ? 86400000 : 1800000)]);
    });
    try {
      await sendEmail({ to: user.email, name: user.name, companyName: user.companyName, purpose, token });
      await dbRun(connection, 'UPDATE account_tokens SET sentAt=? WHERE hash=?', [now(),hash]);
      return true;
    } catch {
      await dbRun(connection, 'UPDATE account_tokens SET consumedAt=? WHERE hash=?', [now(),hash]);
      console.error('[account-access] Email delivery failed; no credentials logged.');
      return false;
    }
  };
  return {
    async createCompany(input) {
      const name = String(input.name || '').trim();
      const adminName = String(input.adminName || '').trim();
      const email = String(input.email || '').trim().toLowerCase();
      const scac = String(input.scac || '').trim().toUpperCase();
      const plan = String(input.subscriptionPlan || 'Trial').trim();
      const status = input.serviceStatus || 'Trial';
      if (!name || name.length > 150 || !adminName || adminName.length > 150 || !emailPattern.test(email) || email.length > 254 || plan.length > 100 || !plan || !enabled(status) || (scac && !/^[A-Z]{2,4}$/.test(scac))) {
        throw fail(400, 'Enter a company, administrator name, valid email, plan, and a 2–4 letter SCAC when applicable. Status must be Active or Trial.');
      }
      checkEmail();
      const password = await bcrypt.hash(randomBytes(48).toString('base64url'), 12);
      return exclusive(async () => {
        const companyId = randomUUID(), userId = randomUUID(), createdAt = new Date(now()).toISOString();
        await transaction(async () => {
          const duplicate = await dbGet(connection, `SELECT id FROM users WHERE LOWER(email)=? UNION ALL SELECT id FROM companies WHERE LOWER(email)=? LIMIT 1`, [email,email]);
          if (duplicate) throw fail(409, 'This email already belongs to an account. Use password recovery for an existing account.');
          await dbRun(connection, `INSERT INTO companies (id,name,email,passwordHash,createdAt,serviceStatus,subscriptionPlan,subscriptionNotes,tenantUpdatedAt,portHoustonScac)
            VALUES (?,?,?,?,?,?,?,'Created by the PortFlow owner.',?,?)`, [companyId,name,email,password,createdAt,status,plan,createdAt,scac]);
          await dbRun(connection, `INSERT INTO users (id,companyId,name,email,password,role,isActive) VALUES (?,?,?,?,?,'admin',0)`, [userId,companyId,adminName,email,password]);
          await dbRun(connection, `INSERT INTO account_access (userId,pending,invitedAt) VALUES (?,1,?)`, [userId,createdAt]);
        });
        const invitationSent = await issue(await getUser(userId), 'invite');
        return { ok:true, id:companyId, invitationSent, message: invitationSent ? 'Company created. Activation email sent; the administrator must choose a password before signing in.' : 'Company created, but the activation email could not be sent. Use Resend invitation; do not create the company again.' };
      });
    },
    resend(companyId) {
      checkEmail();
      return exclusive(async () => {
        const row = await dbGet(connection, `SELECT u.id FROM users u JOIN account_access a ON a.userId=u.id WHERE u.companyId=? AND a.pending=1 AND u.role='admin'`, [companyId]);
        if (!row) throw fail(409, 'No pending invitation exists for this company. Existing users can use Forgot password.');
        const recent = await dbGet(connection, 'SELECT createdAt FROM account_tokens WHERE userId=? AND purpose=\'invite\' ORDER BY createdAt DESC LIMIT 1', [row.id]);
        if (recent && now()-recent.createdAt < 60000) throw fail(429, 'Wait one minute before resending an invitation.');
        const invitationSent = await issue(await getUser(row.id), 'invite');
        return { ok:true, invitationSent, message: invitationSent ? 'A new activation email was sent. Previous activation links no longer work.' : 'The activation email could not be sent. Please try again.' };
      });
    },
    requestReset(email) {
      return exclusive(async () => {
        const normalized = String(email || '').trim().toLowerCase();
        if (!emailPattern.test(normalized) || normalized.length > 254) return;
        checkEmail();
        const row = await dbGet(connection, 'SELECT id FROM users WHERE LOWER(email)=? AND isActive=1', [normalized]);
        if (!row) return;
        const user = await getUser(row.id);
        if (user.pending || (!isOwner(user) && !enabled(user.serviceStatus))) return;
        const recent = await dbGet(connection, `SELECT createdAt FROM account_tokens WHERE userId=? AND purpose='reset' ORDER BY createdAt DESC LIMIT 1`, [user.id]);
        if (recent && now()-recent.createdAt < 300000) return;
        await issue(user, 'reset');
      });
    },
    async complete({ token, purpose, password }) {
      if (!['invite','reset'].includes(purpose) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw fail(400, 'This link is invalid or expired. Request a new link.');
      if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password,'utf8') > 72) throw fail(400, 'Use at least 8 characters and no more than 72 bytes for your password.');
      const passwordHash = await bcrypt.hash(password,12);
      const result = await exclusive(() => transaction(async () => {
        const record = await dbGet(connection, 'SELECT * FROM account_tokens WHERE hash=? AND purpose=? AND consumedAt IS NULL AND expiresAt>? AND sentAt IS NOT NULL', [hashToken(token),purpose,now()]);
        if (!record) throw fail(400, 'This link is invalid or expired. Request a new link.');
        const user = await getUser(record.userId);
        if (!user || user.password !== record.passwordSnapshot || user.email !== record.emailSnapshot || (purpose === 'invite' ? !user.pending : user.pending || !user.isActive)) throw fail(400, 'This link is invalid or expired. Request a new link.');
        if (!isOwner(user) && !enabled(user.serviceStatus)) throw fail(403, 'Company access is disabled. Contact PortFlow to reactivate it.');
        await dbRun(connection, 'UPDATE users SET password=?, isActive=1 WHERE id=?', [passwordHash,user.id]);
        // Keep the legacy company hash in sync only for its own administrator email.
        await dbRun(connection, 'UPDATE companies SET passwordHash=? WHERE id=? AND LOWER(email)=LOWER(?)', [passwordHash,user.companyId,user.email]);
        await dbRun(connection, `INSERT INTO account_access (userId,pending,version,activatedAt) VALUES (?,0,1,?) ON CONFLICT(userId) DO UPDATE SET pending=0,version=version+1,activatedAt=COALESCE(activatedAt,excluded.activatedAt)`, [user.id,new Date(now()).toISOString()]);
        await dbRun(connection, 'DELETE FROM account_tokens WHERE userId=?', [user.id]);
        return user;
      }));
      // A notification failure must not roll back a successfully changed password.
      sendEmail({to:result.email,name:result.name,purpose:'changed'}).catch(() => console.error('[account-access] Password change notification failed.'));
      return { ok:true, message: purpose === 'invite' ? 'Your account is activated. You can sign in now.' : 'Your password was updated. Sign in again with your new password.' };
    },
    close: () => connection === db ? Promise.resolve() : new Promise((resolve,reject) => connection.close((err) => err ? reject(err) : resolve())),
  };
}
