import sqlite3 from 'sqlite3';
import { dbRun } from '../../services/dbUtils.js';
export const createDb = async () => {
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
  await dbRun(db, `CREATE TABLE drivers (id TEXT PRIMARY KEY, companyId TEXT, name TEXT, truck TEXT, email TEXT)`);
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
    reviewedAt TEXT, reviewedBy TEXT, finalizedAt TEXT, finalizedBy TEXT, unreviewReason TEXT, emailedAt TEXT, emailedTo TEXT
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
