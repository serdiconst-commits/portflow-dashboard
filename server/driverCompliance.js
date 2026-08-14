import { v4 as uuidv4 } from 'uuid';

export const DRIVER_EXPIRATION_REMINDER_DAYS = 5;
const TIME_ZONE = 'America/Chicago';

export const isDriverReminderEmailConfigured = () => Boolean(
  String(process.env.RESEND_API_KEY || '').trim() &&
  String(process.env.DRIVER_COMPLIANCE_FROM_EMAIL || '').trim()
);

export const normalizeExpirationDate = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? normalized
    : null;
};

const calendarDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const dayDifference = (later, earlier) => {
  const utc = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(later) - utc(earlier)) / 86400000);
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const sendReminder = async ({ driver, documentLabel, expirationDate, daysRemaining }) => {
  const timing = daysRemaining === 0
    ? 'expires today'
    : `expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${String(process.env.RESEND_API_KEY || '').trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: String(process.env.DRIVER_COMPLIANCE_FROM_EMAIL || '').trim(),
      to: [driver.email],
      subject: `${documentLabel} expiration reminder - ${expirationDate}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:auto">
        <h2 style="color:#0f766e">Document expiration reminder</h2>
        <p>Hello ${escapeHtml(driver.name || 'Driver')},</p>
        <p>Your <strong>${escapeHtml(documentLabel)}</strong> ${timing}, on <strong>${expirationDate}</strong>.</p>
        <p>Please renew it and provide the updated expiration date to ${escapeHtml(driver.companyName || 'your company')}.</p>
        <p style="color:#64748b;font-size:13px">This is an automatic PortFlow compliance reminder.</p>
      </div>`,
    }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
};

const dbAll = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows = []) => (error ? reject(error) : resolve(rows)));
});
const dbGet = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
});
const dbRun = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (error) => (error ? reject(error) : resolve()));
});

let running = false;
export const runDriverExpirationReminderCheck = async (db) => {
  if (running || !isDriverReminderEmailConfigured()) return;
  running = true;
  try {
    const today = calendarDate();
    const drivers = await dbAll(db, `SELECT d.*, c.name AS companyName FROM drivers d
      LEFT JOIN companies c ON c.id = d.companyId
      WHERE d.isActive = 1 AND TRIM(COALESCE(d.email, '')) <> ''`);
    for (const driver of drivers) {
      const documents = [
        ['DRIVER_LICENSE', 'Driver license', driver.licenseExpirationDate],
        ['TWIC_CARD', 'TWIC card', driver.twicExpirationDate],
      ];
      for (const [documentType, documentLabel, rawDate] of documents) {
        const expirationDate = normalizeExpirationDate(rawDate);
        if (!expirationDate) continue;
        const daysRemaining = dayDifference(expirationDate, today);
        if (daysRemaining < 0 || daysRemaining > DRIVER_EXPIRATION_REMINDER_DAYS) continue;
        const existing = await dbGet(db, `SELECT id FROM driver_expiration_notifications
          WHERE companyId = ? AND driverId = ? AND documentType = ? AND expirationDate = ?`,
          [driver.companyId, driver.id, documentType, expirationDate]);
        if (existing) continue;
        try {
          await sendReminder({ driver, documentLabel, expirationDate, daysRemaining });
          await dbRun(db, `INSERT OR IGNORE INTO driver_expiration_notifications
            (id, companyId, driverId, documentType, expirationDate, sentAt, recipientEmail)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), driver.companyId, driver.id, documentType, expirationDate, new Date().toISOString(), driver.email]);
          console.log(`[driver-expiration-reminders] Sent ${documentType} reminder to ${driver.email}.`);
        } catch (error) {
          console.error(`[driver-expiration-reminders] ${driver.id} ${documentType}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error('[driver-expiration-reminders] Check failed:', error.message);
  } finally {
    running = false;
  }
};

export const startDriverExpirationReminderChecks = (db) => {
  if (!isDriverReminderEmailConfigured()) {
    console.log('[driver-expiration-reminders] Disabled until email variables are configured.');
    return;
  }
  setTimeout(() => runDriverExpirationReminderCheck(db), 20000);
  setInterval(() => runDriverExpirationReminderCheck(db), 24 * 60 * 60 * 1000);
};
