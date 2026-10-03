import { ensureLifecycle, lifecycleInfo, fail, validPayrollDate } from './payrollLifecycle.js';
import { ensureAdjustmentSchema, normalizeAdjustment, saveSpec, validateSavedSelection, resolveAdjustments } from './payrollAdjustments.js';
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
  if (status === 'paid') return 'Paid';
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
      calculation: item.calculation || null,
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
  await ensureLifecycle(db);
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
       COALESCE(NULLIF(TRIM(l.containerNumber), ''), container.containerNumber) AS containerNumber,
       l.referenceNumber,
       l.bookingNumber,
       l.miles,
       lm.moveType,
       COALESCE(NULLIF(route.origin, ''), lm.origin) AS moveOrigin,
       COALESCE(NULLIF(route.destination, ''), lm.destination) AS moveDestination,
       lm.completedAt AS moveCompletedAt
     FROM settlement_loads sl
     JOIN settlements owner ON owner.id = sl.settlementId
     LEFT JOIN load_moves lm ON lm.id = sl.moveId AND lm.companyId = owner.companyId
     LEFT JOIN loads l ON l.id = COALESCE(NULLIF(sl.loadId, ''), lm.loadId) AND l.companyId = owner.companyId
     LEFT JOIN settlement_line_containers container ON container.settlementLoadId = sl.id AND container.companyId = owner.companyId
     LEFT JOIN settlement_line_routes route ON route.settlementLoadId = sl.id AND route.companyId = ?
     WHERE sl.settlementId = ?
     ORDER BY COALESCE(lm.completedAt, l.appointmentTime, sl.createdAt), sl.createdAt`,
    [companyId, settlementId]
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

  return { settlement, driver, loads, deductions: await resolveAdjustments(db, settlement, loads, deductions), auditLogs };
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
  await ensureLifecycle(db);
  if ((await lifecycleInfo(db,companyId,settlementId)).correction) return 0;
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
       AND NOT EXISTS (SELECT 1 FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payrollRunId WHERE pi.companyId=lm.companyId AND pi.loadId=lm.loadId AND pi.driverId=? AND LOWER(pr.status)!='voided')
       AND NOT EXISTS (SELECT 1 FROM settlement_move_exclusions e WHERE e.settlementId=? AND e.moveId=lm.id)
     ORDER BY lm.completedAt, lm.loadId, lm.sequence`,
    [companyId, driverId, periodStart, periodEnd, driverId, settlementId]
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
  for (const item of parts.deductions) {
    if (item.calculation) await dbRun(db, 'UPDATE deductions SET amount=? WHERE id=? AND settlement_id=?', [item.amount,item.id,settlementId]);
  }

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
  const info=await lifecycleInfo(db,companyId,settlementId);
  let statement=buildStatement(parts);
  if (['Reviewed','Finalized'].includes(normalizeSettlementStatus(parts.settlement.status)) && parts.settlement.statementJson) {
    try { statement=JSON.parse(parts.settlement.statementJson); } catch { /* Legacy statements use their saved lines. */ }
    statement.auditTrail=buildStatement(parts).auditTrail;
  }
  // Repair missing display data only; never recalculate or overwrite a saved snapshot.
  statement.loads = (statement.loads || []).map(line => {
    if (String(line.containerNumber || '').trim()) return line;
    const matches = parts.loads.filter(row => line.settlementLoadId
      ? row.settlementLoadId === line.settlementLoadId
      : line.moveId ? row.moveId === line.moveId : line.loadId && row.loadId === line.loadId);
    const containers = [...new Set(matches.map(row => String(row.containerNumber || '').trim()).filter(Boolean))];
    if (containers.length === 1) return { ...line, containerNumber: containers[0] };
    // Older manual entries sometimes stored the container in the reason field.
    const mentioned = [...new Set(`${line.loadId || ''} ${line.description || ''}`.toUpperCase().match(/\b[A-Z]{3}[UJZ]\d{7}\b/g) || [])];
    return !line.moveId && mentioned.length === 1 ? { ...line, containerNumber: mentioned[0] } : line;
  });
  const status=info.payment?'Paid':normalizeSettlementStatus(parts.settlement.status);
  statement.settlement={...statement.settlement,status,version:parts.settlement.version,correctionOf:info.correction?.parentId||'',payment:info.payment};
  return {...parts.settlement,status,statement,...info};
}

export async function listSettlements(db, companyId, filters = {}) {
  await ensureLifecycle(db);
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
    `SELECT s.*, CASE WHEN p.settlementId IS NOT NULL THEN 'Paid' ELSE s.status END AS status, c.parentId AS correctionOf, d.name AS driverName, d.email AS driverEmail,
            (SELECT COUNT(*) FROM settlement_loads sl WHERE sl.settlementId = s.id) AS loadCount
     FROM settlements s
     LEFT JOIN settlement_payments p ON p.settlementId=s.id AND p.companyId=s.companyId
     LEFT JOIN settlement_corrections c ON c.settlementId=s.id AND c.companyId=s.companyId
     LEFT JOIN drivers d ON d.id = s.driverId AND d.companyId = s.companyId
     WHERE ${clauses.join(' AND ')}
     ORDER BY s.periodStart DESC, d.name`,
    params
  );
}

export async function createSettlement(db, companyId, input = {}, createdBy = '') {
  await ensureLifecycle(db);
  const driverId = String(input.driverId || '').trim();
  const periodStart = normalizeDate(input.periodStart);
  const periodEnd = normalizeDate(input.periodEnd);

  if (!driverId || !validPayrollDate(periodStart) || !validPayrollDate(periodEnd) || periodStart>periodEnd) {
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
       AND NOT EXISTS (SELECT 1 FROM settlement_corrections c WHERE c.settlementId=settlements.id)
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

  const settlementId = uuidv4();
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
        'Draft',
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
         AND NOT EXISTS (SELECT 1 FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payrollRunId WHERE pi.companyId=loads.companyId AND pi.loadId=loads.id AND pi.driverId=? AND LOWER(pr.status)!='voided')
         AND NOT EXISTS (SELECT 1 FROM settlement_loads sl JOIN settlements ss ON ss.id=sl.settlementId WHERE sl.loadId=loads.id AND ss.companyId=loads.companyId AND ss.driverId=? AND sl.moveId IS NULL)
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
      [companyId, driverId, driverId, driverId, periodStart, periodEnd, driverId, periodStart, periodEnd]
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
  if (!validPayrollDate(nextPeriodStart) || !validPayrollDate(nextPeriodEnd) || nextPeriodStart > nextPeriodEnd) fail('Choose a valid payroll period.', 400);
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

  const reason=String(input.description||'').trim();
  if(!reason)fail('A reason is required for a manual payment.',400);
  const containerNumber = String(input.containerNumber ?? '').trim().toUpperCase();
  if (containerNumber.length > 30) fail('Container number must be 30 characters or fewer.', 400);
  const origin = String(input.pickupLocation ?? '').trim();
  const destination = String(input.deliveryLocation ?? '').trim();
  if (origin.length > 500 || destination.length > 500) fail('Locations must be 500 characters or fewer.', 400);
  const lineId = uuidv4();
  const info=await lifecycleInfo(db,companyId,settlementId);
  await dbRun(db, 'BEGIN IMMEDIATE');
  try {
  if(input.moveId){
    const move=await dbGet(db,`SELECT lm.* FROM load_moves lm JOIN loads l ON l.id=lm.loadId AND l.companyId=lm.companyId WHERE lm.id=? AND lm.companyId=? AND COALESCE(l.deletedAt,'')=''`,[input.moveId,companyId]);
    if(!move||String(move.completedBy||move.driverId).trim().toLowerCase()!==String(settlement.driverId).trim().toLowerCase()||String(move.status).toLowerCase()!=='completed')fail('Completed movement for this driver was not found.',404);
    if(await dbGet(db,`SELECT pi.id FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payrollRunId WHERE pi.companyId=? AND pi.loadId=? AND pi.driverId=? AND LOWER(pr.status)!='voided'`,[companyId,move.loadId,settlement.driverId]))fail('This load already belongs to a legacy payroll run. Resolve that record before adding it.');
    if(await dbGet(db,'SELECT id FROM settlement_loads WHERE moveId=?',[move.id]))fail('This movement is already included in a settlement.');
    const pay=input.payAmount===undefined?Number(move.driverRate):Number(input.payAmount);
    if(!Number.isFinite(pay)||pay<0)fail('Enter a non-negative movement payment.',400);
    try { await dbRun(db,`INSERT INTO settlement_loads(id,settlementId,loadId,moveId,payAmount,movesCount,description,source,createdAt) VALUES(?,?,?,?,?,1,?,'manual_move',?)`,[lineId,settlementId,move.loadId,move.id,roundMoney(pay),reason,new Date().toISOString()]); }
    catch(e){if(e.code==='SQLITE_CONSTRAINT')fail('This movement is already included in a settlement.');throw e;}
  }else{
    if(input.loadId)fail('Select the specific completed movement rather than adding the entire load.',400);
    const pay=Number(input.payAmount);if(!Number.isFinite(pay)||pay===0)fail('Enter a non-zero manual payment.',400);
    await dbRun(db,`INSERT INTO settlement_loads(id,settlementId,payAmount,movesCount,description,source,createdAt) VALUES(?,?,?,1,?,?,?)`,[lineId,settlementId,roundMoney(pay),reason,info.correction?'correction':'manual',new Date().toISOString()]);
  }

  if (containerNumber) {
    await dbRun(db, 'INSERT INTO settlement_line_containers(settlementLoadId,companyId,containerNumber) VALUES(?,?,?)', [lineId,companyId,containerNumber]);
  }
  if (origin || destination) {
    await dbRun(db, 'INSERT INTO settlement_line_routes(settlementLoadId,companyId,origin,destination) VALUES(?,?,?,?)', [lineId,companyId,origin,destination]);
  }
  await writeSettlementAudit(db, settlementId, 'ADD_LOAD_OR_PAYMENT', null, input, changedBy);
  const result = await recalculateSettlement(db, companyId, settlementId, changedBy);
  await dbRun(db, 'COMMIT');
  return result;
  } catch (error) {
    await dbRun(db, 'ROLLBACK');
    throw error;
  }
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

  if(input.payAmount!==undefined && (!Number.isFinite(Number(input.payAmount)) || !String(input.description||'').trim()))fail('A valid payment and correction reason are required.',400);
  const payAmount = roundMoney(parseMoney(input.payAmount ?? existing.payAmount));
  if (existing.moveId && payAmount < 0) fail('Movement pay cannot be negative. Use a separate adjustment for a deduction.', 400);
  const movesCount = Math.max(1, Number.parseInt(input.movesCount || existing.movesCount || 1, 10) || 1);
  const description = input.description !== undefined ? String(input.description || '') : existing.description;

  const containerNumber = input.containerNumber === undefined ? undefined : String(input.containerNumber || '').trim().toUpperCase();
  if (containerNumber !== undefined && (existing.loadId || existing.moveId)) fail('Update the container on the linked load.', 400);
  if (containerNumber?.length > 30) fail('Container number must be 30 characters or fewer.', 400);
  await ensureLifecycle(db);
  await dbRun(db, 'BEGIN IMMEDIATE');
  try {
  if (containerNumber !== undefined) {
    await dbRun(db, `INSERT INTO settlement_line_containers(settlementLoadId,companyId,containerNumber) VALUES(?,?,?)
      ON CONFLICT(settlementLoadId) DO UPDATE SET containerNumber=excluded.containerNumber WHERE companyId=excluded.companyId`, [settlementLoadId,companyId,containerNumber]);
  }
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
    { ...existing, payAmount, movesCount, description, ...(containerNumber === undefined ? {} : {containerNumber}) },
    changedBy
  );
  const result = await recalculateSettlement(db, companyId, settlementId, changedBy);
  await dbRun(db, 'COMMIT');
  return result;
  } catch (error) {
    await dbRun(db, 'ROLLBACK');
    throw error;
  }
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

  if(existing.moveId){await ensureLifecycle(db);await dbRun(db,'INSERT OR IGNORE INTO settlement_move_exclusions VALUES(?,?)',[settlementId,existing.moveId]);}
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

  if (input.ruleId) {
    if (!input.basis) fail('A saved adjustment requires its calculation.', 400);
    await validateSavedSelection(db, settlement, input.ruleId);
  }
  if (input.basis) normalizeAdjustment(input);
  const deductionId = uuidv4();
  const stage = input.stage === 'net_deduction' ? 'net_deduction' : 'gross_adjustment';
  const amount = stage === 'net_deduction'
    ? -Math.abs(roundMoney(parseMoney(input.amount)))
    : roundMoney(parseMoney(input.amount));
  await dbRun(
    db,
    `INSERT INTO deductions (id, settlement_id, description, amount, stage, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [deductionId, settlementId, description, amount, stage, input.addedBy || changedBy || '', new Date().toISOString()]
  );

  if (input.basis) await saveSpec(db, settlement, deductionId, input, changedBy);
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

  if (input.basis) normalizeAdjustment(input);
  const stage = input.basis ? 'gross_adjustment' : input.stage === 'net_deduction' ? 'net_deduction' : existing.stage || 'gross_adjustment';
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
  if (input.basis) await saveSpec(db, settlement, deductionId, input, changedBy);
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

  await ensureAdjustmentSchema(db);
  await dbRun(db, `DELETE FROM payroll_adjustment_specs WHERE deductionId = ? AND settlementId = ?`, [deductionId, settlementId]);
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
  } else if (action === 'reopen') {
    if(currentStatus!=='Finalized'||existing.payment)fail('Only finalized, unpaid settlements can be revised.');
    const reason=String(input.reason||'').trim();if(!reason)fail('A revision reason is required.',400);
    await ensureLifecycle(db);
    await dbRun(db,'INSERT INTO settlement_versions VALUES(?,?,?,?,?,?,?)',[uuidv4(),companyId,settlementId,JSON.stringify(existing),reason,changedBy,now]);
    nextStatus='Draft';auditAction='REOPEN_REVISION';extraSql=', version=COALESCE(version,1)+1, reviewedAt=NULL, reviewedBy=NULL, finalizedAt=NULL, finalizedBy=NULL, emailedAt=NULL, emailedTo=NULL';
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
