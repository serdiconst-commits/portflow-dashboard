import { v4 as uuidv4 } from 'uuid';

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDate = (value) => String(value || '').slice(0, 10);

const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const getDriverPayConfig = (driver = {}) => ({
  payType: String(driver.payType || 'per_load').trim().toLowerCase().replace(/\s+/g, '_'),
  payPerMileRate: parseMoney(driver.payPerMileRate),
  payPerLoadRate: parseMoney(driver.payPerLoadRate),
  payPercentageRate: parseMoney(driver.payPercentageRate),
  payHourlyRate: parseMoney(driver.payHourlyRate),
  dispatchPercentage: parseMoney(driver.dispatchPercentage),
  driverSplitPercentage: parseMoney(driver.driverSplitPercentage || 100),
  weeklyInsurance: parseMoney(driver.weeklyInsurance),
  weeklyOccupationalAccident: parseMoney(driver.weeklyOccupationalAccident),
});

const calculateLoadPay = (load = {}, config = {}) => {
  const revenue = parseMoney(load.revenue ?? load.rate);
  const existingDriverRate = parseMoney(load.driverRate);
  const miles = parseMoney(load.miles);
  const hours = parseMoney(load.hoursWorked);
  const movesCount = Math.max(1, Number.parseInt(load.movesCount || 1, 10) || 1);
  const type = config.payType || 'per_load';

  if (type === 'per_mile') {
    return roundMoney(miles * config.payPerMileRate || existingDriverRate);
  }

  if (type === 'percentage') {
    return roundMoney(revenue * (config.payPercentageRate / 100) || existingDriverRate);
  }

  if (type === 'hourly') {
    return roundMoney(hours * config.payHourlyRate || existingDriverRate);
  }

  if (type === 'mixed' || type === 'hybrid') {
    const mixedPay =
      movesCount * config.payPerLoadRate +
      miles * config.payPerMileRate +
      revenue * (config.payPercentageRate / 100) +
      hours * config.payHourlyRate;
    return roundMoney(mixedPay || existingDriverRate);
  }

  return roundMoney(movesCount * config.payPerLoadRate || existingDriverRate);
};

const buildStatement = ({ settlement, driver, loads, deductions, auditLogs }) => {
  const loadLines = loads.map((row) => ({
    settlementLoadId: row.settlementLoadId,
    loadId: row.loadId,
    appointmentTime: row.appointmentTime || '',
    customer: row.customer || '',
    containerNumber: row.containerNumber || '',
    referenceNumber: row.referenceNumber || row.bookingNumber || '',
    movesCount: Number(row.movesCount || 1),
    payAmount: roundMoney(row.payAmount),
    source: row.source || 'auto',
    description: row.description || '',
  }));

  const grossPay = roundMoney(loadLines.reduce((sum, row) => sum + row.payAmount, 0));
  const deductionsTotal = roundMoney(deductions.reduce((sum, item) => sum + parseMoney(item.amount), 0));
  const netPay = roundMoney(grossPay + deductionsTotal);

  return {
    settlement: {
      id: settlement.id,
      status: settlement.status || 'Draft',
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      version: Number(settlement.version || 1),
    },
    driver: {
      id: driver.id,
      name: driver.name,
      payType: driver.payType || 'per_load',
    },
    totals: {
      grossPay,
      adjustmentsTotal: deductionsTotal,
      netPay,
      loadCount: loadLines.length,
    },
    loads: loadLines,
    deductions: deductions.map((item) => ({
      id: item.id,
      description: item.description,
      amount: roundMoney(item.amount),
      addedBy: item.added_by || '',
      createdAt: item.created_at,
    })),
    auditTrail: auditLogs.map((item) => ({
      id: item.id,
      action: item.action,
      changedBy: item.changedBy || '',
      createdAt: item.createdAt,
    })),
  };
};

async function getSettlementParts(db, companyId, settlementId) {
  const settlement = await dbGet(
    db,
    `SELECT * FROM settlements WHERE id = ? AND companyId = ?`,
    [settlementId, companyId]
  );
  if (!settlement) return null;

  const driver = await dbGet(
    db,
    `SELECT * FROM drivers WHERE id = ? AND companyId = ?`,
    [settlement.driverId, companyId]
  );
  const loads = await dbAll(
    db,
    `SELECT
       sl.id AS settlementLoadId,
       sl.loadId,
       sl.payAmount,
       sl.movesCount,
       sl.description,
       sl.source,
       l.appointmentTime,
       l.customer,
       l.containerNumber,
       l.referenceNumber,
       l.bookingNumber
     FROM settlement_loads sl
     LEFT JOIN loads l ON l.id = sl.loadId
     WHERE sl.settlementId = ?
     ORDER BY COALESCE(l.appointmentTime, sl.createdAt), sl.createdAt`,
    [settlementId]
  );
  const deductions = await dbAll(
    db,
    `SELECT * FROM deductions WHERE settlement_id = ? ORDER BY created_at`,
    [settlementId]
  );
  const auditLogs = await dbAll(
    db,
    `SELECT * FROM settlement_audit_logs WHERE settlementId = ? ORDER BY createdAt DESC`,
    [settlementId]
  );

  return { settlement, driver, loads, deductions, auditLogs };
}

async function writeSettlementAudit(db, settlementId, action, oldValue, newValue, changedBy) {
  await dbRun(
    db,
    `INSERT INTO settlement_audit_logs (id, settlementId, action, oldValue, newValue, changedBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      settlementId,
      action,
      oldValue ? JSON.stringify(oldValue) : '',
      newValue ? JSON.stringify(newValue) : '',
      changedBy || '',
      new Date().toISOString(),
    ]
  );
}

export async function recalculateSettlement(db, companyId, settlementId, changedBy = '') {
  const parts = await getSettlementParts(db, companyId, settlementId);
  if (!parts) return null;

  const statement = buildStatement(parts);
  const now = new Date().toISOString();
  await dbRun(
    db,
    `UPDATE settlements
     SET grossPay = ?,
         deductionsTotal = ?,
         netPay = ?,
         statementJson = ?,
         version = COALESCE(version, 1) + 1,
         updatedAt = ?
     WHERE id = ? AND companyId = ?`,
    [
      statement.totals.grossPay,
      statement.totals.adjustmentsTotal,
      statement.totals.netPay,
      JSON.stringify(statement),
      now,
      settlementId,
      companyId,
    ]
  );

  await writeSettlementAudit(db, settlementId, 'RECALCULATE', null, statement.totals, changedBy);

  return getSettlement(db, companyId, settlementId);
}

export async function getSettlement(db, companyId, settlementId) {
  const parts = await getSettlementParts(db, companyId, settlementId);
  if (!parts) return null;
  return {
    ...parts.settlement,
    statement: buildStatement(parts),
  };
}

export async function listSettlements(db, companyId, filters = {}) {
  const clauses = ['s.companyId = ?'];
  const params = [companyId];

  if (filters.driverId) {
    clauses.push('s.driverId = ?');
    params.push(filters.driverId);
  }
  if (filters.periodStart) {
    clauses.push('s.periodStart >= ?');
    params.push(filters.periodStart);
  }
  if (filters.periodEnd) {
    clauses.push('s.periodEnd <= ?');
    params.push(filters.periodEnd);
  }

  return dbAll(
    db,
    `SELECT s.*, d.name AS driverName
     FROM settlements s
     LEFT JOIN drivers d ON d.id = s.driverId AND d.companyId = s.companyId
     WHERE ${clauses.join(' AND ')}
     ORDER BY s.periodStart DESC, d.name`,
    params
  );
}

export async function createSettlement(db, companyId, input = {}, createdBy = '') {
  const driverId = String(input.driverId || '').trim();
  const periodStart = normalizeDate(input.periodStart);
  const periodEnd = normalizeDate(input.periodEnd);

  if (!driverId || !periodStart || !periodEnd) {
    throw new Error('driverId, periodStart, and periodEnd are required.');
  }

  const driver = await dbGet(db, `SELECT * FROM drivers WHERE id = ? AND companyId = ?`, [driverId, companyId]);
  if (!driver) {
    const err = new Error('Driver not found.');
    err.status = 404;
    throw err;
  }

  const existingSettlement = await dbGet(
    db,
    `SELECT id FROM settlements
     WHERE companyId = ? AND driverId = ? AND periodStart = ? AND periodEnd = ?
     ORDER BY createdAt DESC
     LIMIT 1`,
    [companyId, driverId, periodStart, periodEnd]
  );
  if (existingSettlement?.id) {
    return getSettlement(db, companyId, existingSettlement.id);
  }

  const settlementId = input.id || uuidv4();
  const now = new Date().toISOString();
  await dbRun(
    db,
    `INSERT INTO settlements (id, companyId, driverId, periodStart, periodEnd, status, createdAt, updatedAt, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [settlementId, companyId, driverId, periodStart, periodEnd, input.status || 'Draft', now, now, createdBy]
  );

  const config = getDriverPayConfig(driver);
  const loads = await dbAll(
    db,
    `SELECT *
     FROM loads
     WHERE companyId = ?
       AND driver = ?
       AND LOWER(COALESCE(status, '')) IN ('delivered', 'completed')
       AND DATE(SUBSTR(COALESCE(NULLIF(appointmentTime, ''), loadDate), 1, 10)) BETWEEN DATE(?) AND DATE(?)
     ORDER BY appointmentTime, id`,
    [companyId, driverId, periodStart, periodEnd]
  );

  for (const load of loads) {
    await dbRun(
      db,
      `INSERT INTO settlement_loads (id, settlementId, loadId, payAmount, movesCount, description, source, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        settlementId,
        load.id,
        calculateLoadPay(load, config),
        Math.max(1, Number.parseInt(load.movesCount || 1, 10) || 1),
        'Auto-added by appointment period',
        'auto',
        now,
      ]
    );
  }

  await writeSettlementAudit(db, settlementId, 'CREATE', null, { driverId, periodStart, periodEnd }, createdBy);
  return recalculateSettlement(db, companyId, settlementId, createdBy);
}

export async function updateSettlement(db, companyId, settlementId, input = {}, changedBy = '') {
  const existing = await getSettlement(db, companyId, settlementId);
  if (!existing) return null;

  const nextPeriodStart = normalizeDate(input.periodStart) || existing.periodStart;
  const nextPeriodEnd = normalizeDate(input.periodEnd) || existing.periodEnd;
  const nextStatus = input.status || existing.status || 'Draft';

  await dbRun(
    db,
    `UPDATE settlements
     SET periodStart = ?, periodEnd = ?, status = ?, updatedAt = ?
     WHERE id = ? AND companyId = ?`,
    [nextPeriodStart, nextPeriodEnd, nextStatus, new Date().toISOString(), settlementId, companyId]
  );
  await writeSettlementAudit(db, settlementId, 'UPDATE', existing, input, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function deleteSettlement(db, companyId, settlementId, changedBy = '') {
  const existing = await getSettlement(db, companyId, settlementId);
  if (!existing) return false;
  await writeSettlementAudit(db, settlementId, 'DELETE', existing, null, changedBy);
  await dbRun(db, `DELETE FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  return true;
}

export async function addSettlementLoad(db, companyId, settlementId, input = {}, changedBy = '') {
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;

  const loadId = String(input.loadId || '').trim();
  const load = loadId
    ? await dbGet(db, `SELECT * FROM loads WHERE id = ? AND companyId = ?`, [loadId, companyId])
    : null;
  const payAmount = parseMoney(input.payAmount);
  const movesCount = Math.max(1, Number.parseInt(input.movesCount || load?.movesCount || 1, 10) || 1);
  const driver = await dbGet(db, `SELECT * FROM drivers WHERE id = ? AND companyId = ?`, [settlement.driverId, companyId]);
  const calculatedPay = load && !payAmount ? calculateLoadPay(load, getDriverPayConfig(driver)) : payAmount;

  await dbRun(
    db,
    `INSERT INTO settlement_loads (id, settlementId, loadId, payAmount, movesCount, description, source, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      settlementId,
      loadId || null,
      roundMoney(calculatedPay),
      movesCount,
      input.description || (load ? 'Manual load add' : 'Manual payment'),
      input.source || 'manual',
      new Date().toISOString(),
    ]
  );

  await writeSettlementAudit(db, settlementId, 'ADD_LOAD_OR_PAYMENT', null, input, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function removeSettlementLoad(db, companyId, settlementId, settlementLoadId, changedBy = '') {
  const existing = await dbGet(
    db,
    `SELECT sl.*
     FROM settlement_loads sl
     JOIN settlements s ON s.id = sl.settlementId
     WHERE sl.id = ? AND sl.settlementId = ? AND s.companyId = ?`,
    [settlementLoadId, settlementId, companyId]
  );
  if (!existing) return null;

  await dbRun(db, `DELETE FROM settlement_loads WHERE id = ? AND settlementId = ?`, [settlementLoadId, settlementId]);
  await writeSettlementAudit(db, settlementId, 'REMOVE_LOAD_OR_PAYMENT', existing, null, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function addDeduction(db, companyId, settlementId, input = {}, changedBy = '') {
  const settlement = await dbGet(db, `SELECT id FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;

  const description = String(input.description || '').trim();
  if (!description) {
    throw new Error('Deduction description is required.');
  }

  const amount = roundMoney(parseMoney(input.amount));
  await dbRun(
    db,
    `INSERT INTO deductions (id, settlement_id, description, amount, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), settlementId, description, amount, input.addedBy || changedBy || '', new Date().toISOString()]
  );

  await writeSettlementAudit(db, settlementId, 'ADD_DEDUCTION', null, { description, amount }, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function updateDeduction(db, companyId, settlementId, deductionId, input = {}, changedBy = '') {
  const existing = await dbGet(
    db,
    `SELECT d.*
     FROM deductions d
     JOIN settlements s ON s.id = d.settlement_id
     WHERE d.id = ? AND d.settlement_id = ? AND s.companyId = ?`,
    [deductionId, settlementId, companyId]
  );
  if (!existing) return null;

  const description = String(input.description || '').trim();
  if (!description) {
    throw new Error('Deduction description is required.');
  }

  const amount = roundMoney(parseMoney(input.amount));
  const updated = {
    ...existing,
    description,
    amount,
  };

  await dbRun(db, `UPDATE deductions SET description = ?, amount = ? WHERE id = ? AND settlement_id = ?`, [
    description,
    amount,
    deductionId,
    settlementId,
  ]);
  await writeSettlementAudit(db, settlementId, 'UPDATE_DEDUCTION', existing, updated, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function removeDeduction(db, companyId, settlementId, deductionId, changedBy = '') {
  const existing = await dbGet(
    db,
    `SELECT d.*
     FROM deductions d
     JOIN settlements s ON s.id = d.settlement_id
     WHERE d.id = ? AND d.settlement_id = ? AND s.companyId = ?`,
    [deductionId, settlementId, companyId]
  );
  if (!existing) return null;

  await dbRun(db, `DELETE FROM deductions WHERE id = ? AND settlement_id = ?`, [deductionId, settlementId]);
  await writeSettlementAudit(db, settlementId, 'REMOVE_DEDUCTION', existing, null, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}
