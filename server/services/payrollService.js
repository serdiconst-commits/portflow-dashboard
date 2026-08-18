import { v4 as uuidv4 } from 'uuid';
import { assertDateRange, centsToMoney, dbAll, dbGet, dbRun, jsonSafeParse, parseMoneyToCents } from './dbUtils.js';

const payrollAdminRoles = new Set(['carrier', 'admin', 'administrator', 'owner', 'payroll']);
const finalizedStatuses = ['Finalized', 'Paid'];
const completedStatuses = ['delivered', 'completed'];

export const canUsePayroll = (role) => payrollAdminRoles.has(String(role || '').trim().toLowerCase());

export async function ensurePayrollSettings(db, companyId) {
  const existing = await dbGet(db, `SELECT * FROM payroll_settings WHERE companyId = ?`, [companyId]);
  if (existing) return normalizeSettings(existing);
  const now = new Date().toISOString();
  const id = uuidv4();
  await dbRun(
    db,
    `INSERT INTO payroll_settings (
      id, companyId, frequency, weekStartsOn, payDay, includeStatuses,
      requirePOD, requireBOL, requireInterchange, defaultDetentionRule,
      defaultExtraStopRate, defaultLayoverRate, approvalRequired, companyTimezone, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      companyId,
      'Weekly',
      'Monday',
      'Friday',
      JSON.stringify(['Delivered', 'Completed']),
      1,
      0,
      0,
      '',
      0,
      0,
      1,
      'America/Chicago',
      now,
      now,
    ]
  );
  return ensurePayrollSettings(db, companyId);
}

const normalizeSettings = (row = {}) => ({
  ...row,
  includeStatuses: jsonSafeParse(row.includeStatuses, ['Delivered', 'Completed']),
  requirePOD: Number(row.requirePOD || 0) === 1,
  requireBOL: Number(row.requireBOL || 0) === 1,
  requireInterchange: Number(row.requireInterchange || 0) === 1,
  approvalRequired: Number(row.approvalRequired || 0) === 1,
  companyTimezone: row.companyTimezone || 'America/Chicago',
});

export async function updatePayrollSettings(db, companyId, input = {}) {
  await ensurePayrollSettings(db, companyId);
  const now = new Date().toISOString();
  await dbRun(
    db,
    `UPDATE payroll_settings
     SET frequency = ?, weekStartsOn = ?, payDay = ?, includeStatuses = ?,
         requirePOD = ?, requireBOL = ?, requireInterchange = ?, defaultDetentionRule = ?,
         defaultExtraStopRate = ?, defaultLayoverRate = ?, approvalRequired = ?,
         companyTimezone = ?, updatedAt = ?
     WHERE companyId = ?`,
    [
      input.frequency || 'Weekly',
      input.weekStartsOn || 'Monday',
      input.payDay || 'Friday',
      JSON.stringify(Array.isArray(input.includeStatuses) ? input.includeStatuses : ['Delivered', 'Completed']),
      input.requirePOD ? 1 : 0,
      input.requireBOL ? 1 : 0,
      input.requireInterchange ? 1 : 0,
      String(input.defaultDetentionRule || ''),
      Number(input.defaultExtraStopRate || 0),
      Number(input.defaultLayoverRate || 0),
      input.approvalRequired === false ? 0 : 1,
      input.companyTimezone || 'America/Chicago',
      now,
      companyId,
    ]
  );
  await dbRun(
    db,
    `UPDATE companies SET companyTimezone = ?, allowAiAnalytics = COALESCE(allowAiAnalytics, 0) WHERE id = ?`,
    [input.companyTimezone || 'America/Chicago', companyId]
  );
  return ensurePayrollSettings(db, companyId);
}

const hasDocument = (documents, category) =>
  documents.some((doc) => String(doc.category || doc.type || '').trim().toUpperCase() === category);

async function getDocumentsByLoad(db, loadIds) {
  if (!loadIds.length) return new Map();
  const placeholders = loadIds.map(() => '?').join(',');
  const docs = await dbAll(db, `SELECT * FROM documents WHERE loadId IN (${placeholders})`, loadIds);
  return docs.reduce((map, doc) => {
    if (!map.has(doc.loadId)) map.set(doc.loadId, []);
    map.get(doc.loadId).push(doc);
    return map;
  }, new Map());
}

async function getAlreadyFinalizedLoadIds(db, companyId) {
  const rows = await dbAll(
    db,
    `SELECT DISTINCT pi.loadId
     FROM payroll_items pi
     JOIN payroll_runs pr ON pr.id = pi.payrollRunId AND pr.companyId = pi.companyId
     WHERE pi.companyId = ? AND pr.status IN ('Finalized', 'Paid') AND pi.loadId IS NOT NULL`,
    [companyId]
  );
  return new Set(rows.map((row) => row.loadId));
}

export async function generatePayrollRun(db, companyId, input = {}, actor = {}) {
  const { startDate, endDate } = assertDateRange(input.periodStart || input.startDate, input.periodEnd || input.endDate);
  const settings = await ensurePayrollSettings(db, companyId);
  const existing = await dbGet(
    db,
    `SELECT id FROM payroll_runs WHERE companyId = ? AND periodStart = ? AND periodEnd = ? AND status != 'Voided'`,
    [companyId, startDate, endDate]
  );
  if (existing) return getPayrollRun(db, companyId, existing.id);

  const includeStatuses = new Set(settings.includeStatuses.map((status) => String(status).toLowerCase()));
  const loads = await dbAll(
    db,
    `SELECT * FROM loads
     WHERE companyId = ?
       AND COALESCE(deletedAt, '') = ''
       AND DATE(SUBSTR(COALESCE(NULLIF(appointmentTime, ''), loadDate), 1, 10)) BETWEEN DATE(?) AND DATE(?)
     ORDER BY driver, appointmentTime, loadDate, id`,
    [companyId, startDate, endDate]
  );
  const docsByLoad = await getDocumentsByLoad(db, loads.map((load) => load.id));
  const finalizedLoadIds = await getAlreadyFinalizedLoadIds(db, companyId);
  const eligible = [];
  const excludedLoads = [];
  const errors = [];
  const warnings = [];

  loads.forEach((load) => {
    const status = String(load.status || '').trim().toLowerCase();
    const docs = docsByLoad.get(load.id) || [];
    const driverId = String(load.driver || '').trim();
    const driverPay = parseMoneyToCents(load.driverRate);
    const revenue = parseMoneyToCents(load.rate);
    const critical = [];
    const nonCritical = [];
    if (!includeStatuses.has(status) || !completedStatuses.includes(status)) critical.push('Status is not eligible for payroll.');
    if (['cancelled', 'canceled', 'deleted'].includes(status)) critical.push('Cancelled/deleted load is excluded.');
    if (!driverId) critical.push('Driver is missing.');
    if (driverPay <= 0) critical.push('Driver rate is missing.');
    if (finalizedLoadIds.has(load.id)) critical.push('Load is already included in finalized or paid payroll.');
    if (settings.requirePOD && !hasDocument(docs, 'POD')) nonCritical.push('POD is missing.');
    if (settings.requireBOL && !hasDocument(docs, 'BOL')) nonCritical.push('BOL is missing.');
    if (settings.requireInterchange && !hasDocument(docs, 'IN EIR') && !hasDocument(docs, 'OUT EIR')) nonCritical.push('Interchange is missing.');
    if (driverPay > revenue && revenue > 0) nonCritical.push('Driver pay is greater than revenue.');
    if (revenue <= 0) nonCritical.push('Revenue rate is zero or missing.');

    if (critical.length) {
      excludedLoads.push({ loadId: load.id, referenceNumber: load.referenceNumber || '', reasons: critical });
      errors.push(...critical.map((message) => ({ loadId: load.id, message })));
      return;
    }
    warnings.push(...nonCritical.map((message) => ({ loadId: load.id, message })));
    eligible.push(load);
  });

  const now = new Date().toISOString();
  const runId = uuidv4();
  const payrollNumber = `PAY-${Date.now()}`;
  await dbRun(db, 'BEGIN IMMEDIATE TRANSACTION');
  try {
    await dbRun(
      db,
      `INSERT INTO payroll_runs (
        id, companyId, payrollNumber, periodStart, periodEnd, status, notes,
        createdBy, createdAt, updatedAt, totalGrossPay, totalDeductions,
        totalReimbursements, totalNetPay, driverCount, loadCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0)`,
      [runId, companyId, payrollNumber, startDate, endDate, 'Draft', String(input.notes || ''), actor.id || actor.email || '', now, now]
    );

    for (const load of eligible) {
      const baseDriverPay = parseMoneyToCents(load.driverRate);
      const detentionPay = 0;
      const extraStopPay = 0;
      const layoverPay = 0;
      const lumperReimbursement = parseMoneyToCents(load.lumper);
      const otherPay = 0;
      const deductions = 0;
      const grossPay = baseDriverPay + detentionPay + extraStopPay + layoverPay + otherPay;
      const netPay = grossPay + lumperReimbursement - deductions;
      if (netPay < 0) throw new Error(`Net pay is negative for load ${load.id}.`);
      const calculationDetails = {
        baseDriverPay: centsToMoney(baseDriverPay),
        detentionPay: centsToMoney(detentionPay),
        extraStopPay: centsToMoney(extraStopPay),
        layoverPay: centsToMoney(layoverPay),
        otherPay: centsToMoney(otherPay),
        deductions: centsToMoney(deductions),
        reimbursements: centsToMoney(lumperReimbursement),
        grossPay: centsToMoney(grossPay),
        netPay: centsToMoney(netPay),
        rulesVersion: '1.0',
      };
      await dbRun(
        db,
        `INSERT INTO payroll_items (
          id, companyId, payrollRunId, driverId, loadId, referenceNumber, containerNumber,
          completedDate, baseDriverPay, detentionPay, extraStopPay, layoverPay,
          lumperReimbursement, otherPay, deductions, grossPay, netPay, calculationDetails,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), companyId, runId, load.driver, load.id, load.referenceNumber || '',
          load.containerNumber || '', String(load.appointmentTime || load.loadDate || '').slice(0, 10),
          centsToMoney(baseDriverPay), 0, 0, 0, centsToMoney(lumperReimbursement), 0, 0,
          centsToMoney(grossPay), centsToMoney(netPay), JSON.stringify(calculationDetails), now, now,
        ]
      );
    }
    await recalculatePayrollRun(db, companyId, runId, actor);
    await dbRun(db, 'COMMIT');
  } catch (error) {
    await dbRun(db, 'ROLLBACK');
    throw error;
  }
  const run = await getPayrollRun(db, companyId, runId);
  return { ...run, warnings, errors, excludedLoads };
}

export async function recalculatePayrollRun(db, companyId, runId, actor = {}) {
  const run = await dbGet(db, `SELECT * FROM payroll_runs WHERE id = ? AND companyId = ?`, [runId, companyId]);
  if (!run) return null;
  if (['Finalized', 'Paid'].includes(run.status)) {
    const error = new Error('Finalized or paid payroll cannot be recalculated.');
    error.status = 409;
    throw error;
  }
  const items = await dbAll(db, `SELECT * FROM payroll_items WHERE companyId = ? AND payrollRunId = ?`, [companyId, runId]);
  const totals = items.reduce((acc, item) => {
    acc.gross += parseMoneyToCents(item.grossPay);
    acc.deductions += parseMoneyToCents(item.deductions);
    acc.reimbursements += parseMoneyToCents(item.lumperReimbursement);
    acc.net += parseMoneyToCents(item.netPay);
    acc.drivers.add(item.driverId);
    return acc;
  }, { gross: 0, deductions: 0, reimbursements: 0, net: 0, drivers: new Set() });
  await dbRun(
    db,
    `UPDATE payroll_runs
     SET totalGrossPay = ?, totalDeductions = ?, totalReimbursements = ?, totalNetPay = ?,
         driverCount = ?, loadCount = ?, updatedAt = ?
     WHERE id = ? AND companyId = ?`,
    [
      centsToMoney(totals.gross), centsToMoney(totals.deductions), centsToMoney(totals.reimbursements),
      centsToMoney(totals.net), totals.drivers.size, items.length, new Date().toISOString(), runId, companyId,
    ]
  );
  await writeFinancialAudit(db, companyId, actor, 'PAYROLL_RECALCULATED', 'PAYROLL_RUN', runId, { loadCount: items.length });
  return getPayrollRun(db, companyId, runId);
}

export async function listPayrollRuns(db, companyId) {
  return dbAll(db, `SELECT * FROM payroll_runs WHERE companyId = ? ORDER BY periodStart DESC, createdAt DESC`, [companyId]);
}

export async function getPayrollRun(db, companyId, runId) {
  const run = await dbGet(db, `SELECT * FROM payroll_runs WHERE id = ? AND companyId = ?`, [runId, companyId]);
  if (!run) return null;
  const items = await dbAll(
    db,
    `SELECT pi.*, d.name AS driverName
     FROM payroll_items pi
     LEFT JOIN drivers d ON d.id = pi.driverId AND d.companyId = pi.companyId
     WHERE pi.companyId = ? AND pi.payrollRunId = ?
     ORDER BY d.name, pi.completedDate, pi.loadId`,
    [companyId, runId]
  );
  const summaries = await buildDriverSummaries(db, companyId, runId, items);
  return { ...run, items, driverSummaries: summaries, efficiency: getPayrollEfficiency(run, items) };
}

async function buildDriverSummaries(db, companyId, runId, items) {
  const grouped = new Map();
  items.forEach((item) => {
    if (!grouped.has(item.driverId)) grouped.set(item.driverId, {
      driverId: item.driverId, driverName: item.driverName || item.driverId, loadCount: 0,
      basePay: 0, additions: 0, deductions: 0, reimbursements: 0, grossPay: 0, netPay: 0,
    });
    const row = grouped.get(item.driverId);
    row.loadCount += 1;
    row.basePay += parseMoneyToCents(item.baseDriverPay);
    row.additions += parseMoneyToCents(item.detentionPay) + parseMoneyToCents(item.extraStopPay) + parseMoneyToCents(item.layoverPay) + parseMoneyToCents(item.otherPay);
    row.deductions += parseMoneyToCents(item.deductions);
    row.reimbursements += parseMoneyToCents(item.lumperReimbursement);
    row.grossPay += parseMoneyToCents(item.grossPay);
    row.netPay += parseMoneyToCents(item.netPay);
  });
  return [...grouped.values()].map((row) => ({
    ...row,
    basePay: centsToMoney(row.basePay),
    additions: centsToMoney(row.additions),
    deductions: centsToMoney(row.deductions),
    reimbursements: centsToMoney(row.reimbursements),
    grossPay: centsToMoney(row.grossPay),
    netPay: centsToMoney(row.netPay),
  }));
}

export function getPayrollEfficiency(run = {}, items = []) {
  const loadCount = items.length || 0;
  const withDriverRate = items.filter((item) => parseMoneyToCents(item.baseDriverPay) > 0).length;
  const duplicateLoadCount = loadCount - new Set(items.map((item) => item.loadId).filter(Boolean)).size;
  const missingPayCount = loadCount - withDriverRate;
  const adjustmentCount = items.filter((item) => parseMoneyToCents(item.deductions) !== 0 || parseMoneyToCents(item.otherPay) !== 0).length;
  const driverRateScore = loadCount ? (withDriverRate / loadCount) * 25 : 25;
  const paperworkScore = 20;
  const duplicateScore = duplicateLoadCount ? 0 : 20;
  const criticalScore = missingPayCount ? 0 : 15;
  const timelyScore = 10;
  const adjustmentScore = loadCount ? Math.max(0, 10 - (adjustmentCount / loadCount) * 10) : 10;
  const score = Math.round(driverRateScore + paperworkScore + duplicateScore + criticalScore + timelyScore + adjustmentScore);
  const recommendations = [];
  if (missingPayCount) recommendations.push(`${missingPayCount} delivered loads are missing driver pay.`);
  if (duplicateLoadCount) recommendations.push(`${duplicateLoadCount} duplicate loads were found in this payroll.`);
  if (adjustmentCount) recommendations.push(`${adjustmentCount} manual adjustments are included in this payroll.`);
  return {
    score,
    formula: '25 driver-rate completeness + 20 paperwork completeness + 20 no duplicates + 15 no critical errors + 10 timely processing + 10 low manual adjustments.',
    percentageWithDriverRate: loadCount ? Math.round((withDriverRate / loadCount) * 100) : 100,
    percentageWithRequiredPaperwork: 100,
    percentageProcessedWithoutManualAdjustment: loadCount ? Math.round(((loadCount - adjustmentCount) / loadCount) * 100) : 100,
    duplicateLoadCount,
    missingPayCount,
    averageTimeFromDeliveryToPayroll: null,
    payrollVarianceFromPreviousPeriod: null,
    adjustmentsPerDriver: null,
    exceptionCount: duplicateLoadCount + missingPayCount,
    recommendations,
  };
}

export async function transitionPayrollRun(db, companyId, runId, nextStatus, actor = {}) {
  const run = await dbGet(db, `SELECT * FROM payroll_runs WHERE id = ? AND companyId = ?`, [runId, companyId]);
  if (!run) return null;
  if (run.status === 'Paid' && nextStatus !== 'Voided') {
    const error = new Error('Paid payroll cannot be modified.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const fieldByStatus = {
    Review: ['reviewedBy', 'reviewedAt'],
    Approved: ['approvedBy', 'approvedAt'],
    Finalized: ['finalizedBy', 'finalizedAt'],
    Paid: ['paidBy', 'paidAt'],
  };
  const [byField, atField] = fieldByStatus[nextStatus] || [];
  const assignments = [`status = ?`, `updatedAt = ?`];
  const params = [nextStatus, now];
  if (byField && atField) {
    assignments.push(`${byField} = ?`, `${atField} = ?`);
    params.push(actor.id || actor.email || '', now);
  }
  params.push(runId, companyId);
  await dbRun(db, 'BEGIN IMMEDIATE TRANSACTION');
  try {
    await dbRun(db, `UPDATE payroll_runs SET ${assignments.join(', ')} WHERE id = ? AND companyId = ?`, params);
    await writeFinancialAudit(db, companyId, actor, `PAYROLL_${String(nextStatus).toUpperCase()}`, 'PAYROLL_RUN', runId, {});
    await dbRun(db, 'COMMIT');
  } catch (error) {
    await dbRun(db, 'ROLLBACK');
    throw error;
  }
  return getPayrollRun(db, companyId, runId);
}

export async function writeFinancialAudit(db, companyId, actor = {}, action, entityType, entityId, metadata = {}) {
  await dbRun(
    db,
    `INSERT INTO audit_logs (
      id, companyId, userId, userName, userRole, action, entityType, entityId,
      entityLabel, oldValue, newValue, changedFields, ipAddress, userAgent, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(), companyId, actor.id || '', actor.name || actor.email || '', actor.role || '',
      action, entityType, entityId || '', entityId || '', null, JSON.stringify(metadata || {}),
      JSON.stringify({}), '', '', new Date().toISOString(),
    ]
  );
}

export async function exportPayrollRunCsv(db, companyId, runId) {
  const run = await getPayrollRun(db, companyId, runId);
  if (!run) return null;
  const header = ['Payroll Number', 'Driver', 'Load ID', 'Reference', 'Container', 'Base Pay', 'Reimbursements', 'Deductions', 'Gross Pay', 'Net Pay'];
  const rows = run.items.map((item) => [
    run.payrollNumber, item.driverName || item.driverId, item.loadId, item.referenceNumber,
    item.containerNumber, item.baseDriverPay, item.lumperReimbursement, item.deductions, item.grossPay, item.netPay,
  ]);
  return [header, ...rows].map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
