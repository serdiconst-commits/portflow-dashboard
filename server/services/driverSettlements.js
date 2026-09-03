import { v4 as uuidv4 } from 'uuid';

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDate = (value) => String(value || '').slice(0, 10);

const normalizeSettlementStatus = (value) => {
  const status = String(value || 'Draft').trim().toLowerCase();
  if (status === 'complete' || status === 'completed' || status === 'finalized') return 'Finalized';
  if (status === 'reviewed') return 'Reviewed';
  return 'Draft';
};

const assertSettlementEditable = (settlement) => {
  const status = normalizeSettlementStatus(settlement?.status);
  if (status !== 'Draft') {
    const error = new Error(`${status} settlements are locked. Unreview the settlement before making changes.`);
    error.status = 409;
    throw error;
  }
};

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
    moveId: row.moveId || '',
    moveType: row.moveType || '',
    moveOrigin: row.moveOrigin || '',
    moveDestination: row.moveDestination || '',
    completedAt: row.moveCompletedAt || '',
    appointmentTime: row.appointmentTime || '',
    customer: row.customer || '',
    containerNumber: row.containerNumber || '',
    referenceNumber: row.referenceNumber || row.bookingNumber || '',
    miles: parseMoney(row.miles),
    movesCount: Number(row.movesCount || 1),
    payAmount: roundMoney(row.payAmount),
    source: row.source || 'auto',
    description: row.description || '',
  }));

  const grossPay = roundMoney(loadLines.reduce((sum, row) => sum + row.payAmount, 0));
  const grossAdjustments = deductions.filter((item) => (item.stage || 'gross_adjustment') !== 'net_deduction');
  const netDeductions = deductions.filter((item) => item.stage === 'net_deduction');
  const deductionsTotal = roundMoney(grossAdjustments.reduce((sum, item) => sum + parseMoney(item.amount), 0));
  const netDeductionsTotal = roundMoney(netDeductions.reduce((sum, item) => sum + Math.abs(parseMoney(item.amount)), 0));
  const netBeforeDeductions = roundMoney(grossPay + deductionsTotal);
  const netPay = roundMoney(netBeforeDeductions - netDeductionsTotal);

  return {
    settlement: {
      id: settlement.id,
      status: normalizeSettlementStatus(settlement.status),
      notes: settlement.notes || '',
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      version: Number(settlement.version || 1),
      reviewedAt: settlement.reviewedAt || '',
      reviewedBy: settlement.reviewedBy || '',
      finalizedAt: settlement.finalizedAt || '',
      finalizedBy: settlement.finalizedBy || '',
      unreviewReason: settlement.unreviewReason || '',
    },
    driver: {
      id: driver.id,
      name: driver.name,
      email: driver.email || '',
      payType: driver.payType || 'per_load',
    },
    totals: {
      grossPay,
      adjustmentsTotal: deductionsTotal,
      netBeforeDeductions,
      netDeductionsTotal,
      netPay,
      loadCount: loadLines.length,
    },
    loads: loadLines,
    deductions: grossAdjustments.map((item) => ({
      id: item.id,
      description: item.description,
      amount: roundMoney(item.amount),
      stage: item.stage || 'gross_adjustment',
      addedBy: item.added_by || '',
      createdAt: item.created_at,
    })),
    netDeductions: netDeductions.map((item) => ({
      id: item.id,
      description: item.description,
      amount: -Math.abs(roundMoney(item.amount)),
      stage: item.stage || 'net_deduction',
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
       sl.moveId,
       sl.payAmount,
       sl.movesCount,
       sl.description,
       sl.source,
       l.appointmentTime,
       l.customer,
       l.containerNumber,
       l.referenceNumber,
       l.bookingNumber,
       l.miles,
       lm.moveType,
       lm.origin AS moveOrigin,
       lm.destination AS moveDestination,
       lm.completedAt AS moveCompletedAt
     FROM settlement_loads sl
     LEFT JOIN loads l ON l.id = sl.loadId
     LEFT JOIN load_moves lm ON lm.id = sl.moveId
     WHERE sl.settlementId = ?
     ORDER BY COALESCE(lm.completedAt, l.appointmentTime, sl.createdAt), sl.createdAt`,
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

async function syncCompletedMovementLines(db, {
  companyId,
  settlementId,
  driverId,
  periodStart,
  periodEnd,
  createdAt = new Date().toISOString(),
}) {
  const completedMoves = await dbAll(
    db,
    `SELECT
       lm.*,
       l.customer,
       l.containerNumber,
       l.referenceNumber,
       l.bookingNumber
     FROM load_moves lm
     JOIN loads l ON l.id = lm.loadId AND l.companyId = lm.companyId
     LEFT JOIN settlement_loads paidMove ON paidMove.moveId = lm.id
     WHERE lm.companyId = ?
       AND LOWER(COALESCE(lm.status, '')) = 'completed'
       AND TRIM(LOWER(COALESCE(NULLIF(lm.completedBy, ''), lm.driverId))) = TRIM(LOWER(?))
       AND DATE(SUBSTR(lm.completedAt, 1, 10)) BETWEEN DATE(?) AND DATE(?)
       AND COALESCE(l.deletedAt, '') = ''
       AND paidMove.id IS NULL
     ORDER BY lm.completedAt, lm.loadId, lm.sequence`,
    [companyId, driverId, periodStart, periodEnd]
  );

  for (const move of completedMoves) {
    const moveType = String(move.moveType || 'MOVE').trim().replaceAll('_', ' ');
    const route = [move.origin, move.destination].filter(Boolean).join(' to ');
    await dbRun(
      db,
      `INSERT INTO settlement_loads (
         id, settlementId, loadId, moveId, payAmount, movesCount, description, source, createdAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        settlementId,
        move.loadId,
        move.id,
        roundMoney(parseMoney(move.driverRate)),
        1,
        `${moveType} move${route ? ` - ${route}` : ''}`,
        'completed_move',
        createdAt,
      ]
    );
  }

  return completedMoves.length;
}

export async function recalculateSettlement(db, companyId, settlementId, changedBy = '') {
  const settlementRecord = await dbGet(
    db,
    `SELECT * FROM settlements WHERE id = ? AND companyId = ?`,
    [settlementId, companyId]
  );
  if (!settlementRecord) return null;
  assertSettlementEditable(settlementRecord);
  if (normalizeSettlementStatus(settlementRecord.status) === 'Draft') {
    await syncCompletedMovementLines(db, {
      companyId,
      settlementId,
      driverId: settlementRecord.driverId,
      periodStart: settlementRecord.periodStart,
      periodEnd: settlementRecord.periodEnd,
    });
  }
  const parts = await getSettlementParts(db, companyId, settlementId);

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
    status: normalizeSettlementStatus(parts.settlement.status),
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
    `SELECT s.*, d.name AS driverName, d.email AS driverEmail,
            (SELECT COUNT(*) FROM settlement_loads sl WHERE sl.settlementId = s.id) AS loadCount
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
    const existing = await dbGet(
      db,
      `SELECT * FROM settlements WHERE id = ? AND companyId = ?`,
      [existingSettlement.id, companyId]
    );
    if (normalizeSettlementStatus(existing.status) !== 'Draft') {
      return getSettlement(db, companyId, existing.id);
    }
    const addedMoves = await syncCompletedMovementLines(db, {
      companyId,
      settlementId: existing.id,
      driverId,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
    });
    return addedMoves > 0
      ? recalculateSettlement(db, companyId, existing.id, createdBy)
      : getSettlement(db, companyId, existing.id);
  }

  const settlementId = input.id || uuidv4();
  const now = new Date().toISOString();

  await dbRun(db, 'BEGIN IMMEDIATE');
  try {
    await dbRun(
      db,
      `INSERT INTO settlements (id, companyId, driverId, periodStart, periodEnd, status, notes, createdAt, updatedAt, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        settlementId,
        companyId,
        driverId,
        periodStart,
        periodEnd,
        input.status || 'Draft',
        String(input.notes || ''),
        now,
        now,
        createdBy,
      ]
    );

    await syncCompletedMovementLines(db, {
      companyId,
      settlementId,
      driverId,
      periodStart,
      periodEnd,
      createdAt: now,
    });

    const config = getDriverPayConfig(driver);
    const loads = await dbAll(
      db,
      `SELECT *
       FROM loads
       WHERE companyId = ?
         AND COALESCE(deletedAt, '') = ''
         AND NOT EXISTS (
           SELECT 1 FROM load_moves lm
           WHERE lm.companyId = loads.companyId
             AND lm.loadId = loads.id
             AND LOWER(COALESCE(lm.status, '')) = 'completed'
         )
         AND (
           (driver = ? AND LOWER(COALESCE(status, '')) IN ('delivered', 'completed')
             AND DATE(SUBSTR(COALESCE(NULLIF(appointmentTime, ''), loadDate), 1, 10)) BETWEEN DATE(?) AND DATE(?))
           OR
           (droppedBy = ? AND LOWER(COALESCE(dropMoveStatus, '')) = 'complete'
             AND DATE(SUBSTR(dropDateTime, 1, 10)) BETWEEN DATE(?) AND DATE(?))
         )
       ORDER BY COALESCE(dropDateTime, appointmentTime, loadDate), id`,
      [companyId, driverId, periodStart, periodEnd, driverId, periodStart, periodEnd]
    );

    for (const load of loads) {
      const isDropHook = String(load.movementMode || '').toLowerCase() === 'drophook';
      const lines = [];
      if (isDropHook) {
        if (String(load.droppedBy || '').trim() === driverId && Number(load.dropPay || 0) > 0) {
          lines.push({ amount: Number(load.dropPay), description: `Drop move - ${load.dropLocation || load.containerNumber || load.id}`, source: 'drop_move' });
        }
        if (
          String(load.driver || '').trim() === driverId &&
          ['delivered', 'completed'].includes(String(load.status || '').toLowerCase()) &&
          Number(load.pickupPay || 0) > 0
        ) {
          lines.push({ amount: Number(load.pickupPay), description: `Hook / return move - ${load.dropLocation || load.containerNumber || load.id}`, source: 'hook_move' });
        }
      } else if (String(load.driver || '').trim() === driverId) {
        lines.push({
          amount: calculateLoadPay(load, config),
          description: 'Auto-added by appointment period',
          source: 'auto',
        });
      }

      for (const line of lines) {
        await dbRun(
          db,
          `INSERT INTO settlement_loads (id, settlementId, loadId, moveId, payAmount, movesCount, description, source, createdAt)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
          [uuidv4(), settlementId, load.id, line.amount, 1, line.description, line.source, now]
        );
      }
    }

    await dbRun(db, 'COMMIT');
  } catch (error) {
    await dbRun(db, 'ROLLBACK');
    throw error;
  }

  await writeSettlementAudit(db, settlementId, 'CREATE', null, { driverId, periodStart, periodEnd }, createdBy);
  return recalculateSettlement(db, companyId, settlementId, createdBy);
}

export async function updateSettlement(db, companyId, settlementId, input = {}, changedBy = '') {
  const existing = await getSettlement(db, companyId, settlementId);
  if (!existing) return null;

  const nextPeriodStart = normalizeDate(input.periodStart) || existing.periodStart;
  const nextPeriodEnd = normalizeDate(input.periodEnd) || existing.periodEnd;
  assertSettlementEditable(existing);
  const nextStatus = normalizeSettlementStatus(existing.status);
  const nextNotes = Object.prototype.hasOwnProperty.call(input, 'notes')
    ? String(input.notes || '')
    : existing.notes || '';

  await dbRun(
    db,
    `UPDATE settlements
     SET periodStart = ?, periodEnd = ?, status = ?, notes = ?, updatedAt = ?
     WHERE id = ? AND companyId = ?`,
    [nextPeriodStart, nextPeriodEnd, nextStatus, nextNotes, new Date().toISOString(), settlementId, companyId]
  );
  await writeSettlementAudit(db, settlementId, 'UPDATE', existing, input, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function deleteSettlement(db, companyId, settlementId, changedBy = '') {
  const existing = await getSettlement(db, companyId, settlementId);
  if (!existing) return false;
  assertSettlementEditable(existing);
  await writeSettlementAudit(db, settlementId, 'DELETE', existing, null, changedBy);
  await dbRun(db, `DELETE FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  return true;
}

export async function addSettlementLoad(db, companyId, settlementId, input = {}, changedBy = '') {
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;
  assertSettlementEditable(settlement);

  const loadId = String(input.loadId || '').trim();
  const load = loadId
    ? await dbGet(db, `SELECT * FROM loads WHERE id = ? AND companyId = ? AND COALESCE(deletedAt, '') = ''`, [loadId, companyId])
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

export async function updateSettlementLoad(db, companyId, settlementId, settlementLoadId, input = {}, changedBy = '') {
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;
  assertSettlementEditable(settlement);
  const existing = await dbGet(
    db,
    `SELECT sl.*
     FROM settlement_loads sl
     JOIN settlements s ON s.id = sl.settlementId
     WHERE sl.id = ? AND sl.settlementId = ? AND s.companyId = ?`,
    [settlementLoadId, settlementId, companyId]
  );
  if (!existing) return null;

  const payAmount = roundMoney(parseMoney(input.payAmount ?? existing.payAmount));
  const movesCount = Math.max(1, Number.parseInt(input.movesCount || existing.movesCount || 1, 10) || 1);
  const description = input.description !== undefined ? String(input.description || '') : existing.description;

  await dbRun(
    db,
    `UPDATE settlement_loads
     SET payAmount = ?, movesCount = ?, description = ?
     WHERE id = ? AND settlementId = ?`,
    [payAmount, movesCount, description, settlementLoadId, settlementId]
  );

  await writeSettlementAudit(
    db,
    settlementId,
    'UPDATE_LOAD_PAY',
    existing,
    { ...existing, payAmount, movesCount, description },
    changedBy
  );
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function removeSettlementLoad(db, companyId, settlementId, settlementLoadId, changedBy = '') {
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;
  assertSettlementEditable(settlement);
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
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;
  assertSettlementEditable(settlement);

  const description = String(input.description || '').trim();
  if (!description) {
    throw new Error('Deduction description is required.');
  }

  const stage = input.stage === 'net_deduction' ? 'net_deduction' : 'gross_adjustment';
  const amount = stage === 'net_deduction'
    ? -Math.abs(roundMoney(parseMoney(input.amount)))
    : roundMoney(parseMoney(input.amount));
  await dbRun(
    db,
    `INSERT INTO deductions (id, settlement_id, description, amount, stage, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), settlementId, description, amount, stage, input.addedBy || changedBy || '', new Date().toISOString()]
  );

  await writeSettlementAudit(db, settlementId, 'ADD_DEDUCTION', null, { description, amount, stage }, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function updateDeduction(db, companyId, settlementId, deductionId, input = {}, changedBy = '') {
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;
  assertSettlementEditable(settlement);
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

  const stage = input.stage === 'net_deduction' ? 'net_deduction' : existing.stage || 'gross_adjustment';
  const amount = stage === 'net_deduction'
    ? -Math.abs(roundMoney(parseMoney(input.amount)))
    : roundMoney(parseMoney(input.amount));
  const updated = {
    ...existing,
    description,
    amount,
    stage,
  };

  await dbRun(db, `UPDATE deductions SET description = ?, amount = ?, stage = ? WHERE id = ? AND settlement_id = ?`, [
    description,
    amount,
    stage,
    deductionId,
    settlementId,
  ]);
  await writeSettlementAudit(db, settlementId, 'UPDATE_DEDUCTION', existing, updated, changedBy);
  return recalculateSettlement(db, companyId, settlementId, changedBy);
}

export async function removeDeduction(db, companyId, settlementId, deductionId, changedBy = '') {
  const settlement = await dbGet(db, `SELECT * FROM settlements WHERE id = ? AND companyId = ?`, [settlementId, companyId]);
  if (!settlement) return null;
  assertSettlementEditable(settlement);
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

export async function transitionSettlement(db, companyId, settlementId, input = {}, changedBy = '') {
  const existing = await getSettlement(db, companyId, settlementId);
  if (!existing) return null;

  const action = String(input.action || '').trim().toLowerCase();
  const currentStatus = normalizeSettlementStatus(existing.status);
  const now = new Date().toISOString();
  let nextStatus = currentStatus;
  let auditAction = '';
  let extraSql = '';
  let extraParams = [];

  if (action === 'review') {
    if (currentStatus !== 'Draft') {
      const error = new Error('Only Draft settlements can be reviewed.');
      error.status = 409;
      throw error;
    }
    await recalculateSettlement(db, companyId, settlementId, changedBy);
    nextStatus = 'Reviewed';
    auditAction = 'REVIEW';
    extraSql = ', reviewedAt = ?, reviewedBy = ?, unreviewReason = ?';
    extraParams = [now, changedBy || '', ''];
  } else if (action === 'unreview') {
    if (currentStatus !== 'Reviewed') {
      const error = new Error('Only Reviewed settlements can be returned to Draft.');
      error.status = 409;
      throw error;
    }
    const reason = String(input.reason || '').trim();
    if (!reason) {
      const error = new Error('A reason is required to unreview a settlement.');
      error.status = 400;
      throw error;
    }
    nextStatus = 'Draft';
    auditAction = 'UNREVIEW';
    extraSql = ', unreviewReason = ?';
    extraParams = [reason];
  } else if (action === 'finalize') {
    if (currentStatus !== 'Reviewed') {
      const error = new Error('Review the settlement before finalizing it.');
      error.status = 409;
      throw error;
    }
    nextStatus = 'Finalized';
    auditAction = 'FINALIZE';
    extraSql = ', finalizedAt = ?, finalizedBy = ?';
    extraParams = [now, changedBy || ''];
  } else {
    const error = new Error('Settlement transition must be review, unreview, or finalize.');
    error.status = 400;
    throw error;
  }

  await dbRun(
    db,
    `UPDATE settlements SET status = ?, updatedAt = ?${extraSql} WHERE id = ? AND companyId = ?`,
    [nextStatus, now, ...extraParams, settlementId, companyId]
  );
  await writeSettlementAudit(db, settlementId, auditAction, { status: currentStatus }, { status: nextStatus, reason: input.reason || '' }, changedBy);
  return getSettlement(db, companyId, settlementId);
}
