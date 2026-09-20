import test from "node:test";
import assert from "node:assert/strict";
import sqlite3 from "sqlite3";
import {
  ensureAdjustmentSchema,
  normalizeAdjustment,
  adjustmentAmount,
  saveSpec,
  validateSavedSelection,
  resolveAdjustments,
  listRules,
  changeRule,
} from "../services/payrollAdjustments.js";
const run = (db, sql, args = []) =>
  new Promise((r, j) => db.run(sql, args, (e) => (e ? j(e) : r())));
const all = (db, sql, args = []) =>
  new Promise((r, j) => db.all(sql, args, (e, v) => (e ? j(e) : r(v))));
test("percentage adjustments round cents and reject invalid values", () => {
  assert.equal(
    adjustmentAmount({ kind: "subtract", basis: "percent", value: 10 }, 100.01),
    -10,
  );
  assert.equal(
    adjustmentAmount({ kind: "add", basis: "fixed", value: 25.45 }, 100),
    25.45,
  );
  for (const value of [0, -1, Infinity, 101])
    assert.throws(() =>
      normalizeAdjustment({
        description: "Fee",
        kind: "subtract",
        basis: "percent",
        value,
      }),
    );
});
test("saved options are scoped, can be paused, and keep selected snapshots", async () => {
  const db = new sqlite3.Database(":memory:");
  try {
    const first = {
      id: "s1",
      companyId: "a",
      driverId: "juan",
      periodEnd: "2026-09-20",
    };
    const spec = {
      description: "Insurance",
      kind: "subtract",
      basis: "percent",
      value: 10,
      repeat: true,
    };
    await saveSpec(db, first, "d1", spec, "Payroll");
    const [rule] = await listRules(db, "a", "juan");
    const second = { ...first, id: "s2" };
    await validateSavedSelection(db, second, rule.id);
    await saveSpec(
      db,
      second,
      "d2",
      { ...spec, repeat: false, ruleId: rule.id },
      "Payroll",
    );
    await assert.rejects(
      validateSavedSelection(db, second, rule.id),
      /already included/,
    );
    await assert.rejects(
      validateSavedSelection(
        db,
        { ...first, id: "s3", companyId: "other" },
        rule.id,
      ),
      /unavailable/,
    );
    await assert.rejects(
      validateSavedSelection(
        db,
        { ...first, id: "s3", driverId: "pedro" },
        rule.id,
      ),
      /unavailable/,
    );
    await changeRule(db, "a", rule.id, { value: 20 }, "Payroll");
    const resolved = await resolveAdjustments(
      db,
      second,
      [{ payAmount: 800 }],
      [{ id: "d2" }],
    );
    assert.equal(resolved[0].amount, -80);
    assert.equal(
      await changeRule(db, "other", rule.id, { value: 30 }, "x"),
      null,
    );
    await changeRule(db, "a", rule.id, { active: false }, "Payroll");
    await assert.rejects(
      validateSavedSelection(db, { ...first, id: "s3" }, rule.id),
      /unavailable/,
    );
  } finally {
    await new Promise((r) => db.close(r));
  }
});
