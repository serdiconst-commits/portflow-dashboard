import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { reconcileLoadMoves } from '../loadMovePlan.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { dbRun } from '../services/dbUtils.js';
import { getSummary } from '../services/analyticsService.js';
import { canUsePayroll, generatePayrollRun, getPayrollRun } from '../services/payrollService.js';
import { addDeduction, createSettlement, transitionSettlement, updateSettlementLoad } from '../services/driverSettlements.js';

const createDb = async () => {
  const db = new sqlite3.Database(':memory:');
  await dbRun(db, `CREATE TABLE companies (id TEXT PRIMARY KEY, companyTimezone TEXT DEFAULT 'America/Chicago', allowAiAnalytics INTEGER DEFAULT 0)`);
  await dbRun(db, `CREATE TABLE loads (
    id TEXT PRIMARY KEY, companyId TEXT, loadDate TEXT, appointmentTime TEXT, customer TEXT,
    driver TEXT, truck TEXT, rate TEXT, driverRate TEXT, detention TEXT, lumper TEXT,
    fuelAdvance TEXT, status TEXT, referenceNumber TEXT, containerNumber TEXT, bookingNumber TEXT,
    miles REAL, movementMode TEXT, dropLocation TEXT, droppedBy TEXT, dropDateTime TEXT,
    dropMoveStatus TEXT, dropPay REAL DEFAULT 0, pickupPay REAL DEFAULT 0, hookDriver TEXT, deletedAt TEXT
  )`);
  await dbRun(db, `CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, companyId TEXT, invoiceNumber TEXT, loadId TEXT,
    customerName TEXT, amount REAL, status TEXT, issueDate TEXT, dueDate TEXT, createdAt TEXT
  )`);
  await dbRun(db, `CREATE TABLE drivers (id TEXT PRIMARY KEY, companyId TEXT, name TEXT, truck TEXT)`);
  await dbRun(db, `CREATE TABLE documents (id TEXT PRIMARY KEY, loadId TEXT, category TEXT, type TEXT)`);
  await dbRun(db, `CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, companyId TEXT, userId TEXT, userName TEXT, userRole TEXT, action TEXT,
    entityType TEXT, entityId TEXT, entityLabel TEXT, oldValue TEXT, newValue TEXT,
    changedFields TEXT, ipAddress TEXT, userAgent TEXT, createdAt TEXT NOT NULL
  )`);
  await dbRun(db, `CREATE TABLE settlements (
    id TEXT PRIMARY KEY, companyId TEXT, driverId TEXT, periodStart TEXT, periodEnd TEXT,
    status TEXT, grossPay REAL DEFAULT 0, deductionsTotal REAL DEFAULT 0, netPay REAL DEFAULT 0,
    statementJson TEXT, notes TEXT, version INTEGER DEFAULT 1, createdAt TEXT, updatedAt TEXT, createdBy TEXT,
    reviewedAt TEXT, reviewedBy TEXT, finalizedAt TEXT, finalizedBy TEXT, unreviewReason TEXT
  )`);
  await dbRun(db, `CREATE TABLE settlement_loads (
    id TEXT PRIMARY KEY, settlementId TEXT, loadId TEXT, moveId TEXT, payAmount REAL DEFAULT 0,
    movesCount INTEGER DEFAULT 1, description TEXT, source TEXT, createdAt TEXT
  )`);
  await dbRun(db, `CREATE UNIQUE INDEX idx_settlement_loads_move ON settlement_loads(moveId) WHERE moveId IS NOT NULL AND moveId != ''`);
  await dbRun(db, `CREATE TABLE load_moves (
    id TEXT PRIMARY KEY, companyId TEXT, loadId TEXT, sequence INTEGER, moveType TEXT,
    status TEXT, origin TEXT, destination TEXT, driverId TEXT, driverRate TEXT,
    assignedAt TEXT, startedAt TEXT, completedAt TEXT, completedBy TEXT, readyAt TEXT,
    notes TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  await dbRun(db, `CREATE TABLE deductions (
    id TEXT PRIMARY KEY, settlement_id TEXT, description TEXT, amount REAL,
    stage TEXT DEFAULT 'gross_adjustment', added_by TEXT, created_at TEXT
  )`);
  await dbRun(db, `CREATE TABLE settlement_audit_logs (
    id TEXT PRIMARY KEY, settlementId TEXT, action TEXT, oldValue TEXT, newValue TEXT,
    changedBy TEXT, createdAt TEXT
  )`);
  await dbRun(db, `CREATE TABLE payroll_runs (
    id TEXT PRIMARY KEY, companyId TEXT, payrollNumber TEXT, periodStart TEXT, periodEnd TEXT,
    status TEXT, totalGrossPay REAL DEFAULT 0, totalDeductions REAL DEFAULT 0,
    totalReimbursements REAL DEFAULT 0, totalNetPay REAL DEFAULT 0, driverCount INTEGER DEFAULT 0,
    loadCount INTEGER DEFAULT 0, notes TEXT, createdBy TEXT, reviewedBy TEXT, approvedBy TEXT,
    finalizedBy TEXT, paidBy TEXT, createdAt TEXT, reviewedAt TEXT, approvedAt TEXT,
    finalizedAt TEXT, paidAt TEXT, updatedAt TEXT
  )`);
  await dbRun(db, `CREATE TABLE payroll_items (
    id TEXT PRIMARY KEY, companyId TEXT, payrollRunId TEXT, driverId TEXT, loadId TEXT,
    referenceNumber TEXT, containerNumber TEXT, completedDate TEXT, baseDriverPay REAL DEFAULT 0,
    detentionPay REAL DEFAULT 0, extraStopPay REAL DEFAULT 0, layoverPay REAL DEFAULT 0,
    lumperReimbursement REAL DEFAULT 0, otherPay REAL DEFAULT 0, deductions REAL DEFAULT 0,
    grossPay REAL DEFAULT 0, netPay REAL DEFAULT 0, calculationDetails TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  await dbRun(db, `CREATE UNIQUE INDEX idx_payroll_items_run_load ON payroll_items(payrollRunId, loadId)`);
  await dbRun(db, `CREATE TABLE payroll_settings (
    id TEXT PRIMARY KEY, companyId TEXT UNIQUE, frequency TEXT, weekStartsOn TEXT, payDay TEXT,
    includeStatuses TEXT, requirePOD INTEGER, requireBOL INTEGER, requireInterchange INTEGER,
    defaultDetentionRule TEXT, defaultExtraStopRate REAL, defaultLayoverRate REAL,
    approvalRequired INTEGER, companyTimezone TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  await dbRun(db, `INSERT INTO companies (id, companyTimezone, allowAiAnalytics) VALUES ('COMP-A', 'America/Chicago', 0), ('COMP-B', 'America/Chicago', 0)`);
  await dbRun(db, `INSERT INTO drivers (id, companyId, name, truck) VALUES ('DRV-A', 'COMP-A', 'Driver A', 'A1'), ('DRV-B', 'COMP-B', 'Driver B', 'B1')`);
  return db;
};

test('analytics summary is isolated by companyId', async () => {
  const db = await createDb();
  await dbRun(db, `INSERT INTO loads (id, companyId, loadDate, status, rate, driverRate, customer, driver, truck) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['A1', 'COMP-A', '2026-07-10', 'Delivered', '$1000.00', '$400.00', 'A Customer', 'DRV-A', 'A1']);
  await dbRun(db, `INSERT INTO loads (id, companyId, loadDate, status, rate, driverRate, customer, driver, truck, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['A-DELETED', 'COMP-A', '2026-07-10', 'Delivered', '$5000.00', '$2000.00', 'Deleted Customer', 'DRV-A', 'A1', '2026-07-11T10:00:00Z']);
  await dbRun(db, `INSERT INTO loads (id, companyId, loadDate, status, rate, driverRate, customer, driver, truck) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['B1', 'COMP-B', '2026-07-10', 'Delivered', '$9000.00', '$4000.00', 'B Customer', 'DRV-B', 'B1']);
  const summary = await getSummary(db, 'COMP-A', { startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.equal(summary.data.totalRevenue, 1000);
  assert.equal(summary.data.driverPayroll, 400);
});

test('driver role cannot use administrative payroll helper', () => {
  assert.equal(canUsePayroll('driver'), false);
  assert.equal(canUsePayroll('payroll'), true);
});

test('payroll generation calculates net pay with reimbursement and is idempotent', async () => {
  const db = await createDb();
  await dbRun(db, `INSERT INTO loads (id, companyId, loadDate, status, rate, driverRate, lumper, customer, driver, truck, referenceNumber, containerNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['A1', 'COMP-A', '2026-07-10', 'Delivered', '$1000.00', '$500.00', '$40.00', 'A Customer', 'DRV-A', 'A1', 'REF-A1', 'CONT-A1']);
  await dbRun(db, `INSERT INTO loads (id, companyId, loadDate, status, rate, driverRate, customer, driver, truck, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['A-DELETED-PAY', 'COMP-A', '2026-07-10', 'Delivered', '$2000.00', '$999.00', 'Deleted Customer', 'DRV-A', 'A1', '2026-07-11T10:00:00Z']);
  await dbRun(db, `INSERT INTO documents (id, loadId, category) VALUES (?, ?, ?)`, [uuidv4(), 'A1', 'POD']);
  const first = await generatePayrollRun(db, 'COMP-A', { periodStart: '2026-07-01', periodEnd: '2026-07-31' }, { id: 'USR-A', role: 'payroll' });
  const second = await generatePayrollRun(db, 'COMP-A', { periodStart: '2026-07-01', periodEnd: '2026-07-31' }, { id: 'USR-A', role: 'payroll' });
  const run = await getPayrollRun(db, 'COMP-A', first.id);
  assert.equal(first.id, second.id);
  assert.equal(run.totalGrossPay, 500);
  assert.equal(run.totalReimbursements, 40);
  assert.equal(run.totalNetPay, 540);
  assert.equal(run.items.length, 1);
});

test('drop and hook pay is attributed to each movement driver', async () => {
  const db = await createDb();
  await dbRun(db, `INSERT INTO drivers (id, companyId, name, truck) VALUES ('DRV-HOOK', 'COMP-A', 'Hook Driver', 'A2')`);
  await dbRun(
    db,
    `INSERT INTO loads (
      id, companyId, loadDate, appointmentTime, status, customer, driver, containerNumber,
      movementMode, dropLocation, droppedBy, dropDateTime, dropMoveStatus, dropPay, pickupPay
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['DH-1', 'COMP-A', '2026-07-10', '2026-07-11T10:00:00Z', 'Delivered', 'Drop Customer',
      'DRV-HOOK', 'CONT-DH-1', 'DropHook', 'Customer Yard', 'DRV-A', '2026-07-10T15:00:00Z',
      'Complete', 300, 200]
  );

  const dropSettlement = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );
  const hookSettlement = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-HOOK', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );

  assert.equal(dropSettlement.statement.totals.grossPay, 300);
  assert.equal(dropSettlement.statement.loads[0].source, 'drop_move');
  assert.equal(hookSettlement.statement.totals.grossPay, 200);
  assert.equal(hookSettlement.statement.loads[0].source, 'hook_move');
});

test('completed Drop and Pick movements pay each completing driver from the move ledger', async () => {
  const db = await createDb();
  await dbRun(db, `INSERT INTO drivers (id, companyId, name, truck) VALUES ('DRV-RETURN', 'COMP-A', 'Return Driver', 'A2')`);
  await dbRun(
    db,
    `INSERT INTO loads (id, companyId, loadDate, appointmentTime, status, customer, driver, containerNumber, movementMode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['MOVE-1', 'COMP-A', '2026-07-10', '2026-07-10T08:00:00Z', 'Delivered', 'Move Customer', 'DRV-RETURN', 'CONT-MOVE-1', 'Direct']
  );
  await dbRun(
    db,
    `INSERT INTO load_moves (
       id, companyId, loadId, sequence, moveType, status, origin, destination,
       driverId, driverRate, completedAt, completedBy, createdAt, updatedAt
     ) VALUES
       ('MOVE-DROP', 'COMP-A', 'MOVE-1', 1, 'DROP', 'Completed', 'Bayport Terminal', 'Customer Yard',
        'DRV-A', '$325.00', '2026-07-10T15:00:00Z', 'DRV-A', '2026-07-10T08:00:00Z', '2026-07-10T15:00:00Z'),
       ('MOVE-RETURN', 'COMP-A', 'MOVE-1', 2, 'PICKUP_RETURN', 'Completed', 'Customer Yard', 'Empty Depot',
        'DRV-RETURN', '$225.00', '2026-07-11T12:00:00Z', 'DRV-RETURN', '2026-07-10T08:00:00Z', '2026-07-11T12:00:00Z')`
  );

  const dropSettlement = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );
  const returnSettlement = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-RETURN', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );

  assert.equal(dropSettlement.statement.totals.grossPay, 325);
  assert.equal(dropSettlement.statement.loads[0].moveId, 'MOVE-DROP');
  assert.equal(dropSettlement.statement.loads[0].source, 'completed_move');
  assert.equal(returnSettlement.statement.totals.grossPay, 225);
  assert.equal(returnSettlement.statement.loads[0].moveId, 'MOVE-RETURN');
  assert.equal(returnSettlement.statement.loads[0].moveOrigin, 'Customer Yard');
  assert.equal(returnSettlement.statement.loads[0].moveDestination, 'Empty Depot');
});

test('the same driver receives both completed Drop and Pick movement rates', async () => {
  const db = await createDb();
  await dbRun(
    db,
    `INSERT INTO loads (id, companyId, loadDate, appointmentTime, status, customer, driver, containerNumber, movementMode)
     VALUES ('MOVE-2', 'COMP-A', '2026-07-10', '2026-07-10T08:00:00Z', 'Delivered', 'Move Customer', 'DRV-A', 'CONT-MOVE-2', 'Direct')`
  );
  await dbRun(
    db,
    `INSERT INTO load_moves (
       id, companyId, loadId, sequence, moveType, status, origin, destination,
       driverId, driverRate, completedAt, completedBy, createdAt, updatedAt
     ) VALUES
       ('SAME-DROP', 'COMP-A', 'MOVE-2', 1, 'DROP', 'Completed', 'Terminal', 'Customer',
        'DRV-A', '300', '2026-07-10T12:00:00Z', 'DRV-A', '2026-07-10T08:00:00Z', '2026-07-10T12:00:00Z'),
       ('SAME-RETURN', 'COMP-A', 'MOVE-2', 2, 'PICKUP_RETURN', 'Completed', 'Customer', 'Depot',
        'DRV-A', '200', '2026-07-11T12:00:00Z', 'DRV-A', '2026-07-10T08:00:00Z', '2026-07-11T12:00:00Z')`
  );

  const settlement = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );

  assert.equal(settlement.statement.totals.grossPay, 500);
  assert.equal(settlement.statement.loads.length, 2);
  assert.deepEqual(settlement.statement.loads.map((line) => line.moveId), ['SAME-DROP', 'SAME-RETURN']);
});

test('a completed movement cannot be paid again in an overlapping settlement', async () => {
  const db = await createDb();
  await dbRun(
    db,
    `INSERT INTO loads (id, companyId, loadDate, status, customer, driver, containerNumber)
     VALUES ('MOVE-3', 'COMP-A', '2026-07-10', 'Delivered', 'Move Customer', 'DRV-A', 'CONT-MOVE-3')`
  );
  await dbRun(
    db,
    `INSERT INTO load_moves (
       id, companyId, loadId, sequence, moveType, status, origin, destination,
       driverId, driverRate, completedAt, completedBy, createdAt, updatedAt
     ) VALUES ('PAID-ONCE', 'COMP-A', 'MOVE-3', 1, 'DROP', 'Completed', 'Terminal', 'Customer',
       'DRV-A', '275', '2026-07-10T12:00:00Z', 'DRV-A', '2026-07-10T08:00:00Z', '2026-07-10T12:00:00Z')`
  );

  const first = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );
  const overlapping = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-10', periodEnd: '2026-07-20' }, 'USR-A'
  );

  assert.equal(first.statement.totals.grossPay, 275);
  assert.equal(overlapping.statement.totals.grossPay, 0);
  assert.equal(overlapping.statement.loads.length, 0);
});

test('reopening an existing draft settlement adds newly completed movements', async () => {
  const db = await createDb();
  await dbRun(
    db,
    `INSERT INTO loads (id, companyId, loadDate, status, customer, driver, containerNumber)
     VALUES ('MOVE-4', 'COMP-A', '2026-07-10', 'Dropped', 'Move Customer', 'DRV-A', 'CONT-MOVE-4')`
  );
  await dbRun(
    db,
    `INSERT INTO load_moves (
       id, companyId, loadId, sequence, moveType, status, origin, destination,
       driverId, driverRate, completedAt, completedBy, createdAt, updatedAt
     ) VALUES ('REFRESH-DROP', 'COMP-A', 'MOVE-4', 1, 'DROP', 'Completed', 'Terminal', 'Customer',
       'DRV-A', '300', '2026-07-10T12:00:00Z', 'DRV-A', '2026-07-10T08:00:00Z', '2026-07-10T12:00:00Z')`
  );

  const first = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );
  await dbRun(
    db,
    `INSERT INTO load_moves (
       id, companyId, loadId, sequence, moveType, status, origin, destination,
       driverId, driverRate, completedAt, completedBy, createdAt, updatedAt
     ) VALUES ('REFRESH-RETURN', 'COMP-A', 'MOVE-4', 2, 'PICKUP_RETURN', 'Completed', 'Customer', 'Depot',
       'DRV-A', '200', '2026-07-11T12:00:00Z', 'DRV-A', '2026-07-11T08:00:00Z', '2026-07-11T12:00:00Z')`
  );
  const refreshed = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'USR-A'
  );

  assert.equal(first.statement.totals.grossPay, 300);
  assert.equal(refreshed.statement.totals.grossPay, 500);
  assert.equal(refreshed.statement.loads.length, 2);
});

test('settlement review workflow locks edits, records unreview reason, and finalizes safely', async () => {
  const db = await createDb();
  await dbRun(db, `INSERT INTO loads (id, companyId, loadDate, appointmentTime, status, customer, driver, driverRate) VALUES ('WF-1', 'COMP-A', '2026-07-10', '2026-07-10T10:00:00Z', 'Completed', 'Workflow Customer', 'DRV-A', '400')`);
  const draft = await createSettlement(
    db, 'COMP-A', { driverId: 'DRV-A', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, 'Payroll User'
  );

  const reviewed = await transitionSettlement(db, 'COMP-A', draft.id, { action: 'review' }, 'Payroll User');
  assert.equal(reviewed.status, 'Reviewed');
  await assert.rejects(
    addDeduction(db, 'COMP-A', draft.id, { description: 'Should fail', amount: -10 }, 'Payroll User'),
    /Reviewed settlements are locked/
  );

  const reopened = await transitionSettlement(db, 'COMP-A', draft.id, { action: 'unreview', reason: 'Correct driver rate' }, 'Manager User');
  assert.equal(reopened.status, 'Draft');
  assert.equal(reopened.unreviewReason, 'Correct driver rate');
  await updateSettlementLoad(db, 'COMP-A', draft.id, reopened.statement.loads[0].settlementLoadId, { payAmount: 425 }, 'Manager User');

  await transitionSettlement(db, 'COMP-A', draft.id, { action: 'review' }, 'Manager User');
  const finalized = await transitionSettlement(db, 'COMP-A', draft.id, { action: 'finalize' }, 'Manager User');
  assert.equal(finalized.status, 'Finalized');
  assert.equal(finalized.statement.totals.grossPay, 425);
  await assert.rejects(
    transitionSettlement(db, 'COMP-A', draft.id, { action: 'unreview', reason: 'Too late' }, 'Manager User'),
    /Only Reviewed settlements/
  );
});

// Exercise the actual movement writer and status/assignment handlers against an
// isolated database, then run the existing settlement service on their output.
async function movementFixture() {
  const db = await createDb();
  for (const field of ['workflowType', 'pickup', 'delivery', 'returnLocation', 'notes']) {
    await dbRun(db, `ALTER TABLE loads ADD COLUMN ${field} TEXT`);
  }
  await dbRun(db, "INSERT INTO drivers (id, companyId, name) VALUES ('DRV-P', 'COMP-A', 'Pedro')");
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('const getLoadMoveTemplates'), source.indexOf('const attachMovesToLoads'));
  const statusHelper = source.slice(source.indexOf('const updateCurrentMoveForLoadStatus'), source.indexOf("app.put('/api/loads/:id/status'"));
  const handlers = {};
  const context = { db, uuidv4, reconcileLoadMoves, normalizeLoadWorkflow: (value) => value || 'LIVE_DELIVERY',
    writeAuditLog() {}, authenticate() {}, requireRoles: () => () => {}, dispatchLocationRoles: [], movePayRoles: [],
    normalizeDriverAssignment: (_company, driver, cb) => cb(null, driver),
    app: { put: (path, ...args) => { handlers[path] = args.at(-1); } } };
  const routes = source.slice(source.indexOf("app.put('/api/load-moves/:id/assign'"), source.indexOf("app.get('/api/drivers'"));
  const functions = vm.runInNewContext(helpers + statusHelper + routes + '\n({syncLoadMoves, updateCurrentMoveForLoadStatus})', context);
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)));
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (err, rows) => err ? reject(err) : resolve(rows)));
  const load = () => get("SELECT * FROM loads WHERE id = 'LIFECYCLE'");
  const moves = () => all("SELECT * FROM load_moves WHERE loadId = 'LIFECYCLE' ORDER BY sequence");
  const sync = async (previous) => {
    const current = await load();
    return new Promise((resolve, reject) => functions.syncLoadMoves(current, (err) => err ? reject(err) : resolve(), previous));
  };
  const status = (driverId, status) => new Promise((resolve, reject) => functions.updateCurrentMoveForLoadStatus(
    { company: { companyId: 'COMP-A' }, user: { driverId } }, 'LIFECYCLE', status, (err) => err ? reject(err) : resolve()));
  const route = (path, id, body) => new Promise((resolve, reject) => {
    let statusCode = 200;
    handlers[path]({ company: { companyId: 'COMP-A' }, params: { id }, body }, {
      status(code) { statusCode = code; return this; },
      json(value) { statusCode >= 400 ? reject(new Error(value.error)) : resolve(value); },
    });
  });
  await dbRun(db, `INSERT INTO loads (id, companyId, driver, driverRate, status, workflowType, pickup, delivery, returnLocation, loadDate)
    VALUES ('LIFECYCLE', 'COMP-A', 'DRV-A', '0', 'Dispatched', 'DROP_AND_PICK', 'Bayport', 'Plastics', 'Barbours Cut', '2026-09-12')`);
  return { db, get, load, moves, sync, status, route };
}

test('drop pay survives an in-transit edit and pickup assignment, and both drivers settle once', async (t) => {
  const f = await movementFixture();
  t.after(() => f.db.close());
  await f.sync();
  const [initialDrop, initialPickup] = await f.moves();
  await f.status('DRV-A', 'In Transit');
  const beforePayEdit = await f.load();
  await dbRun(f.db, "UPDATE loads SET driverRate = '100' WHERE id = 'LIFECYCLE'");
  await f.sync(beforePayEdit);
  assert.equal((await f.moves())[0].driverRate, '100');
  await f.status('DRV-A', 'Dropped');
  const dropped = (await f.moves())[0];
  assert.equal(dropped.id, initialDrop.id);
  assert.equal(dropped.completedBy, 'DRV-A');
  assert.equal(dropped.driverRate, '100');
  await dbRun(f.db, "UPDATE load_moves SET status = 'Ready for Pickup', origin = 'Stale port origin' WHERE id = ?", [initialPickup.id]);
  await f.route('/api/load-moves/:id/assign', initialPickup.id, { driverId: 'DRV-P', driverRate: '100', returnLocation: 'Barbours Cut' });
  const beforeNotes = await f.load();
  await dbRun(f.db, "UPDATE loads SET notes = 'Dispatch correction' WHERE id = 'LIFECYCLE'");
  await f.sync(beforeNotes);
  await f.sync(); // Billing refresh must also preserve assignment, route and IDs.
  const [drop, pickup] = await f.moves();
  assert.deepEqual(drop, dropped);
  assert.equal(pickup.id, initialPickup.id);
  assert.equal(pickup.status, 'Assigned');
  assert.equal(pickup.driverId, 'DRV-P');
  assert.equal(pickup.origin, 'Plastics');
  assert.equal(pickup.destination, 'Barbours Cut');
  assert.equal(pickup.driverRate, '100');
  await f.status('DRV-P', 'Delivered');
  const day = new Date().toISOString().slice(0, 10);
  for (const [driverId, moveId] of [['DRV-A', drop.id], ['DRV-P', pickup.id]]) {
    const pay = await createSettlement(f.db, 'COMP-A', { driverId, periodStart: day, periodEnd: day }, 'Payroll');
    assert.equal(pay.statement.totals.grossPay, 100);
    assert.equal(pay.statement.loads.length, 1);
    assert.equal(pay.statement.loads[0].moveId, moveId);
    const again = await createSettlement(f.db, 'COMP-A', { driverId, periodStart: day, periodEnd: day }, 'Payroll');
    assert.equal(again.statement.loads.length, 1);
  }
});

test('an older active load with no movements captures its initial driver pay when dropped', async (t) => {
  const f = await movementFixture();
  t.after(() => f.db.close());
  await dbRun(f.db, "UPDATE loads SET driverRate = '100' WHERE id = 'LIFECYCLE'");
  await f.status('DRV-A', 'Dropped');
  const [drop, pickup] = await f.moves();
  assert.equal(drop.status, 'Completed');
  assert.equal(drop.completedBy, 'DRV-A');
  assert.equal(drop.driverRate, '100');
  assert.equal(pickup.origin, 'Plastics');
});

test('payroll can deliberately set zero drop pay without completion restoring an older load rate', async (t) => {
  const f = await movementFixture();
  t.after(() => f.db.close());
  await dbRun(f.db, "UPDATE loads SET driverRate = '100' WHERE id = 'LIFECYCLE'");
  await f.sync();
  const [drop] = await f.moves();
  await f.route('/api/load-moves/:id/rate', drop.id, { driverRate: '0' });
  assert.equal((await f.load()).driverRate, '0');
  await f.status('DRV-A', 'Dropped');
  assert.equal((await f.moves())[0].driverRate, '0');
});
