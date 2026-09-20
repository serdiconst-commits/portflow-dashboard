import { listRules } from "../services/payrollAdjustments.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./fixtures/payrollDb.js";
import {
  run,
  all,
  recordPayment,
  createCorrection,
  candidates,
} from "../services/payrollLifecycle.js";
import {
  createSettlement,
  getSettlement,
  listSettlements,
  addSettlementLoad,
  addDeduction,
  updateDeduction,
  removeDeduction,
  updateSettlementLoad,
  transitionSettlement,
  recalculateSettlement,
  removeSettlementLoad,
} from "../services/driverSettlements.js";
async function fixture(t) {
  const db = await createDb();
  t.after(() => new Promise((r) => db.close(r)));
  await run(
    db,
    "INSERT INTO loads(id,companyId,driver,status,appointmentTime,containerNumber) VALUES('L1','COMP-A','DRV-A','Completed','2026-09-15','DEMO1234567')",
  );
  for (const [id, day, pay] of [
    ["M1", "2026-09-15", 100],
    ["M2", "2026-09-01", 50],
  ])
    await run(
      db,
      "INSERT INTO load_moves(id,companyId,loadId,driverId,completedBy,status,completedAt,driverRate,moveType,origin,destination) VALUES(?,'COMP-A','L1','DRV-A','DRV-A','Completed',?,?,'DROP','Bayport','Plastics')",
      [id, day, pay],
    );
  return db;
}
const prepare = (db) =>
  createSettlement(
    db,
    "COMP-A",
    { driverId: "DRV-A", periodStart: "2026-09-14", periodEnd: "2026-09-20" },
    "Payroll",
  );
test("real settlement calculations, manual older movement, duplicate guard and exclusion", async (t) => {
  const db = await fixture(t);
  let s = await prepare(db);
  assert.equal(s.netPay, 100);
  const available = await candidates(db, "COMP-A", s, "L1");
  assert.equal(available.length, 2);
  s = await addSettlementLoad(
    db,
    "COMP-A",
    s.id,
    { moveId: "M2", description: "Missed previous period" },
    "Payroll",
  );
  assert.equal(s.netPay, 150);
  await assert.rejects(
    addSettlementLoad(db, "COMP-A", s.id, {
      moveId: "M2",
      description: "Duplicate",
    }),
    /already included/,
  );
  s = await addDeduction(
    db,
    "COMP-A",
    s.id,
    {
      description: "Dispatch",
      kind: "subtract",
      basis: "percent",
      value: 10,
      repeat: true,
    },
    "Payroll",
  );
  assert.equal(s.netPay, 135);
  const d = s.statement.deductions[0];
  s = await updateDeduction(
    db,
    "COMP-A",
    s.id,
    d.id,
    {
      description: "Dispatch corrected",
      kind: "subtract",
      basis: "percent",
      value: 5,
    },
    "Payroll",
  );
  assert.equal(s.netPay, 142.5);
  s = await updateSettlementLoad(
    db,
    "COMP-A",
    s.id,
    s.statement.loads.find((l) => l.moveId === "M1").settlementLoadId,
    { payAmount: 200, description: "Corrected Drop rate" },
    "Payroll",
  );
  assert.equal(s.netPay, 237.5);
  s = await removeSettlementLoad(
    db,
    "COMP-A",
    s.id,
    s.statement.loads.find((l) => l.moveId === "M1").settlementLoadId,
    "Payroll",
  );
  s = await recalculateSettlement(db, "COMP-A", s.id);
  assert.equal(s.statement.loads.length, 1);
  assert.equal(s.netPay, 47.5);
  assert.equal(await getSettlement(db, "COMP-B", s.id), null);
});
test("finalization preserves snapshots, unpaid revision archives original, paid correction contains only difference", async (t) => {
  const db = await fixture(t);
  let s = await prepare(db);
  s = await transitionSettlement(
    db,
    "COMP-A",
    s.id,
    { action: "review" },
    "Payroll",
  );
  s = await transitionSettlement(
    db,
    "COMP-A",
    s.id,
    { action: "finalize" },
    "Payroll",
  );
  await assert.rejects(
    addDeduction(db, "COMP-A", s.id, { description: "No", amount: 10 }),
    /locked/,
  );
  s = await transitionSettlement(
    db,
    "COMP-A",
    s.id,
    { action: "reopen", reason: "Rate correction" },
    "Manager",
  );
  assert.equal(s.versions.length, 1);
  const old = JSON.parse(
    (await all(db, "SELECT snapshot FROM settlement_versions"))[0].snapshot,
  );
  assert.equal(old.netPay, 100);
  s = await updateSettlementLoad(
    db,
    "COMP-A",
    s.id,
    s.statement.loads[0].settlementLoadId,
    { payAmount: 125, description: "Correct rate" },
    "Payroll",
  );
  s = await transitionSettlement(db, "COMP-A", s.id, { action: "review" });
  s = await transitionSettlement(db, "COMP-A", s.id, { action: "finalize" });
  await recordPayment(
    db,
    "COMP-A",
    s,
    { paidOn: "2026-09-20", method: "ACH", reference: "TEST-001" },
    "Payroll",
  );
  s = await getSettlement(db, "COMP-A", s.id);
  assert.equal(s.status, "Paid");
  assert.equal(s.payment.amount, 125);
  await assert.rejects(
    transitionSettlement(db, "COMP-A", s.id, {
      action: "reopen",
      reason: "No",
    }),
    /unpaid/,
  );
  await assert.rejects(
    recordPayment(db, "COMP-A", s, {
      paidOn: "2026-09-20",
      method: "ACH",
      reference: "TEST-002",
    }),
    /Finalize/,
  );
  const correctionId = await createCorrection(
    db,
    "COMP-A",
    s,
    { reason: "Missed payment" },
    "Payroll",
  );
  let c = await recalculateSettlement(db, "COMP-A", correctionId);
  assert.equal(c.netPay, 0);
  assert.equal(c.statement.loads.length, 0);
  assert.equal(c.statement.deductions.length, 0);
  c = await addSettlementLoad(
    db,
    "COMP-A",
    correctionId,
    { payAmount: 25, description: "Difference for L1" },
    "Payroll",
  );
  assert.equal(c.netPay, 25);
  assert.equal((await getSettlement(db, "COMP-A", s.id)).netPay, 125);
  await assert.rejects(
    createCorrection(db, "COMP-A", s, { reason: "Again" }, "Payroll"),
    /already an unpaid/,
  );
  const rows = await listSettlements(db, "COMP-A");
  assert.equal(rows.find((r) => r.id === s.id).status, "Paid");
  assert.equal(rows.find((r) => r.id === c.id).correctionOf, s.id);
});

test("saved adjustments require selection each period; edits preserve saved and prior values", async (t) => {
  const db = await fixture(t);
  let s = await prepare(db);
  s = await addDeduction(
    db,
    "COMP-A",
    s.id,
    { description: "Legacy deduction", stage: "net_deduction", amount: 20 },
    "Payroll",
  );
  s = await updateDeduction(
    db,
    "COMP-A",
    s.id,
    s.statement.netDeductions[0].id,
    {
      description: "Reimbursement",
      kind: "add",
      basis: "fixed",
      value: 20,
      repeat: true,
    },
    "Payroll",
  );
  assert.equal(s.netPay, 120);
  assert.equal(s.statement.netDeductions.length, 0);
  const next = await createSettlement(
    db,
    "COMP-A",
    { driverId: "DRV-A", periodStart: "2026-09-21", periodEnd: "2026-09-27" },
    "Payroll",
  );
  assert.equal(next.netPay, 0);
  assert.equal(next.statement.deductions.length, 0);
  const [rule] = await listRules(db, "COMP-A", "DRV-A");
  const selected = {
    ruleId: rule.id,
    description: rule.description,
    kind: rule.kind,
    basis: rule.basis,
    value: 25,
  };
  let current = await addDeduction(db, "COMP-A", next.id, selected, "Payroll");
  assert.equal(current.netPay, 25);
  assert.equal((await listRules(db, "COMP-A", "DRV-A"))[0].value, 20);
  assert.equal((await getSettlement(db, "COMP-A", s.id)).netPay, 120);
  await assert.rejects(
    addDeduction(db, "COMP-A", next.id, selected, "Payroll"),
    /already included/,
  );
  current = await removeDeduction(
    db,
    "COMP-A",
    next.id,
    current.statement.deductions[0].id,
    "Payroll",
  );
  assert.equal(current.netPay, 0);
  current = await addDeduction(db, "COMP-A", next.id, selected, "Payroll");
  assert.equal(current.netPay, 25);
  const again = await createSettlement(
    db,
    "COMP-A",
    { driverId: "DRV-A", periodStart: "2026-09-21", periodEnd: "2026-09-27" },
    "Payroll",
  );
  assert.equal(again.id, next.id);
  assert.equal(again.netPay, 25);
});

test("legacy payroll claims prevent duplicate automatic and manual movement payment", async (t) => {
  const db = await fixture(t);
  await run(
    db,
    "INSERT INTO payroll_runs(id,companyId,status) VALUES('LEGACY','COMP-A','Paid')",
  );
  await run(
    db,
    "INSERT INTO payroll_items(id,companyId,payrollRunId,driverId,loadId) VALUES('PI','COMP-A','LEGACY','DRV-A','L1')",
  );
  const s = await prepare(db);
  assert.equal(s.statement.loads.length, 0);
  assert.equal(
    (await candidates(db, "COMP-A", s, "L1"))[0].includedIn,
    "LEGACY",
  );
  await assert.rejects(
    addSettlementLoad(db, "COMP-A", s.id, {
      moveId: "M1",
      description: "Attempt duplicate",
    }),
    /legacy payroll/,
  );
  await assert.rejects(
    createSettlement(db, "COMP-A", {
      driverId: "DRV-A",
      periodStart: "2026-02-30",
      periodEnd: "2026-03-02",
    }),
    /required/,
  );
});
