import { randomUUID } from "node:crypto";
export const run = (db, sql, args = []) =>
  new Promise((r, j) =>
    db.run(sql, args, function (e) {
      e ? j(e) : r(this);
    }),
  );
export const all = (db, sql, args = []) =>
  new Promise((r, j) => db.all(sql, args, (e, v) => (e ? j(e) : r(v))));
export const get = async (db, sql, args = []) => (await all(db, sql, args))[0];
export const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), { status });
};
export const validPayrollDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
const schemas = new WeakMap();
export function ensureLifecycle(db) {
  if (!schemas.has(db))
    schemas.set(
      db,
      (async () => {
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS settlement_line_routes(settlementLoadId TEXT PRIMARY KEY,companyId TEXT NOT NULL,origin TEXT NOT NULL DEFAULT '',destination TEXT NOT NULL DEFAULT '')`,
        );
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS settlement_versions(id TEXT PRIMARY KEY,companyId TEXT NOT NULL,settlementId TEXT NOT NULL,snapshot TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT,createdAt TEXT NOT NULL)`,
        );
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS settlement_payments(settlementId TEXT PRIMARY KEY,companyId TEXT NOT NULL,amount REAL NOT NULL,paidOn TEXT NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL,actor TEXT,createdAt TEXT NOT NULL)`,
        );
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS settlement_corrections(settlementId TEXT PRIMARY KEY,companyId TEXT NOT NULL,parentId TEXT NOT NULL,reason TEXT NOT NULL)`,
        );
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS settlement_move_exclusions(settlementId TEXT NOT NULL,moveId TEXT NOT NULL,PRIMARY KEY(settlementId,moveId))`,
        );
      })().catch((e) => {
        schemas.delete(db);
        throw e;
      }),
    );
  return schemas.get(db);
}
export async function lifecycleInfo(db, companyId, id) {
  await ensureLifecycle(db);
  return {
    payment:
      (await get(
        db,
        "SELECT * FROM settlement_payments WHERE settlementId=? AND companyId=?",
        [id, companyId],
      )) || null,
    correction:
      (await get(
        db,
        "SELECT * FROM settlement_corrections WHERE settlementId=? AND companyId=?",
        [id, companyId],
      )) || null,
    versions: await all(
      db,
      "SELECT id,reason,actor,createdAt FROM settlement_versions WHERE settlementId=? AND companyId=? ORDER BY createdAt DESC",
      [id, companyId],
    ),
  };
}
export async function candidates(db, companyId, settlement, q = "") {
  return all(
    db,
    `SELECT lm.id AS moveId,lm.loadId,lm.moveType,lm.origin,lm.destination,lm.completedAt,lm.driverRate,l.containerNumber,l.customer,COALESCE(sl.settlementId,(SELECT pi.payrollRunId FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payrollRunId WHERE pi.companyId=lm.companyId AND pi.loadId=lm.loadId AND pi.driverId=COALESCE(NULLIF(lm.completedBy,''),lm.driverId) AND LOWER(pr.status)!='voided' LIMIT 1)) AS includedIn
 FROM load_moves lm JOIN loads l ON l.id=lm.loadId AND l.companyId=lm.companyId LEFT JOIN settlement_loads sl ON sl.moveId=lm.id
 WHERE lm.companyId=? AND LOWER(TRIM(COALESCE(NULLIF(lm.completedBy,''),lm.driverId)))=LOWER(TRIM(?)) AND LOWER(lm.status)='completed' AND COALESCE(l.deletedAt,'')='' AND (lm.loadId LIKE ? OR l.containerNumber LIKE ?)
 ORDER BY lm.completedAt DESC LIMIT 100`,
    [companyId, settlement.driverId, `%${q}%`, `%${q}%`],
  );
}
export async function recordPayment(db, companyId, settlement, input, actor) {
  await ensureLifecycle(db);
  if (settlement.status !== "Finalized")
    fail("Finalize this settlement before recording payment.");
  if (
    !validPayrollDate(input.paidOn) ||
    !["ACH", "Check", "Cash", "Other"].includes(input.method) ||
    !String(input.reference || "").trim()
  )
    fail("Payment date, method and reference are required.", 400);
  const amount = Number(settlement.statement.totals.netPay);
  if (amount <= 0) fail("Only a positive net payment can be recorded.");
  try {
    const inserted = await run(
      db,
      `INSERT INTO settlement_payments SELECT ?,?,?,?,?,?,?,? FROM settlements WHERE id=? AND companyId=? AND LOWER(status) IN ('finalized','complete','completed') AND COALESCE(version,1)=?`,
      [
        settlement.id,
        companyId,
        amount,
        input.paidOn,
        input.method,
        input.reference.trim(),
        actor,
        new Date().toISOString(),
        settlement.id,
        companyId,
        Number(settlement.version || 1),
      ],
    );
    if (!inserted.changes)
      fail("Settlement changed. Reload before recording payment.");
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT") fail("Payment is already recorded.");
    throw e;
  }
}
export async function createCorrection(db, companyId, existing, input, actor) {
  await ensureLifecycle(db);
  const reason = String(input.reason || "").trim();
  if (!reason) fail("A correction reason is required.", 400);
  const payment = await get(
    db,
    "SELECT * FROM settlement_payments WHERE settlementId=? AND companyId=?",
    [existing.id, companyId],
  );
  if (!payment) fail("Only paid settlements use a supplemental correction.");
  const periodStart = input.periodStart || existing.periodStart,
    periodEnd = input.periodEnd || existing.periodEnd;
  if (
    !validPayrollDate(periodStart) ||
    !validPayrollDate(periodEnd) ||
    periodStart > periodEnd
  )
    fail("Choose a valid correction period.", 400);
  const id = randomUUID(),
    now = new Date().toISOString();
  await run(db, "BEGIN IMMEDIATE");
  try {
    const pending = await get(
      db,
      `SELECT s.id FROM settlements s JOIN settlement_corrections c ON c.settlementId=s.id LEFT JOIN settlement_payments p ON p.settlementId=s.id WHERE c.parentId=? AND c.companyId=? AND p.settlementId IS NULL`,
      [existing.id, companyId],
    );
    if (pending)
      fail(
        "There is already an unpaid correction for this settlement. Open it before creating another.",
      );
    await run(
      db,
      `INSERT INTO settlements(id,companyId,driverId,periodStart,periodEnd,status,notes,createdAt,updatedAt,createdBy) VALUES(?,?,?,?,?,'Draft',?,?,?,?)`,
      [
        id,
        companyId,
        existing.driverId,
        periodStart,
        periodEnd,
        `Correction of ${existing.id}: ${reason}`,
        now,
        now,
        actor,
      ],
    );
    await run(db, "INSERT INTO settlement_corrections VALUES(?,?,?,?)", [
      id,
      companyId,
      existing.id,
      reason,
    ]);
    await run(db, "COMMIT");
  } catch (e) {
    await run(db, "ROLLBACK");
    throw e;
  }
  return id;
}
