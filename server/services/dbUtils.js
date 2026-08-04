export const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

export const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });

export const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

export const parseMoneyToCents = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const [rawDollars, rawCents = ''] = cleaned.split('.');
  const sign = rawDollars.startsWith('-') ? -1 : 1;
  const dollars = Math.abs(Number.parseInt(rawDollars || '0', 10)) || 0;
  const cents = Number.parseInt(rawCents.padEnd(2, '0').slice(0, 2) || '0', 10) || 0;
  return sign * (dollars * 100 + cents);
};

export const centsToMoney = (cents = 0) => Math.round(Number(cents || 0)) / 100;

export const normalizeDate = (value = '') => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
};

export const assertDateRange = (startDate, endDate) => {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  if (!start || !end) {
    const error = new Error('startDate and endDate are required in YYYY-MM-DD format.');
    error.status = 400;
    throw error;
  }
  if (start > end) {
    const error = new Error('startDate must be before or equal to endDate.');
    error.status = 400;
    throw error;
  }
  return { startDate: start, endDate: end };
};

export const jsonSafeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
