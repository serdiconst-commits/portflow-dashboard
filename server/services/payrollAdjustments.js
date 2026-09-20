import { randomUUID } from "node:crypto";
const run = (db, sql, args = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, args, function (e) {
      e ? reject(e) : resolve(this);
    }),
  );
const all = (db, sql, args = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, args, (e, r) => (e ? reject(e) : resolve(r))),
  );
const initialized = new WeakMap();
export function ensureAdjustmentSchema(db) {
  if (!initialized.has(db))
    initialized.set(
      db,
      (async () => {
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS payroll_adjustment_rules (id TEXT PRIMARY KEY, companyId TEXT NOT NULL, driverId TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL, basis TEXT NOT NULL, value REAL NOT NULL, effectiveAfter TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, updatedBy TEXT, updatedAt TEXT)`,
        );
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS payroll_adjustment_specs (deductionId TEXT PRIMARY KEY, settlementId TEXT NOT NULL, kind TEXT NOT NULL, basis TEXT NOT NULL, value REAL NOT NULL, ruleId TEXT, UNIQUE(settlementId,ruleId))`,
        );
        await run(
          db,
          `CREATE TABLE IF NOT EXISTS payroll_rule_history (id TEXT PRIMARY KEY, ruleId TEXT NOT NULL, companyId TEXT NOT NULL, snapshot TEXT NOT NULL, actor TEXT, createdAt TEXT NOT NULL)`,
        );
      })().catch((e) => {
        initialized.delete(db);
        throw e;
      }),
    );
  return initialized.get(db);
}
export function normalizeAdjustment(input) {
  const value = Number(input.value),
    description = String(input.description || "").trim();
  if (
    !description ||
    !["add", "subtract"].includes(input.kind) ||
    !["fixed", "percent"].includes(input.basis) ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1e8 ||
    (input.basis === "percent" && value > 100)
  )
    throw Object.assign(
      new Error(
        "Enter a description, Add/Subtract, and a positive amount (percentage up to 100).",
      ),
      { status: 400 },
    );
  return {
    description,
    kind: input.kind,
    basis: input.basis,
    value: Math.round(value * 100) / 100,
  };
}
export function adjustmentAmount(spec, gross) {
  return (
    ((spec.kind === "subtract" ? -1 : 1) *
      Math.round(
        (spec.basis === "percent" ? (gross * spec.value) / 100 : spec.value) *
          100,
      )) /
    100
  );
}
export async function listRules(db, companyId, driverId) {
  await ensureAdjustmentSchema(db);
  return all(
    db,
    "SELECT * FROM payroll_adjustment_rules WHERE companyId=? AND driverId=? ORDER BY updatedAt DESC",
    [companyId, driverId],
  );
}
export async function changeRule(db, companyId, id, input, actor) {
  await ensureAdjustmentSchema(db);
  const [rule] = await all(
    db,
    "SELECT * FROM payroll_adjustment_rules WHERE id=? AND companyId=?",
    [id, companyId],
  );
  if (!rule) return null;
  const spec = normalizeAdjustment({ ...rule, ...input });
  const active =
    input.active === undefined ? rule.active : input.active ? 1 : 0;
  await run(
    db,
    "UPDATE payroll_adjustment_rules SET description=?,kind=?,basis=?,value=?,active=?,updatedBy=?,updatedAt=? WHERE id=? AND companyId=?",
    [
      spec.description,
      spec.kind,
      spec.basis,
      spec.value,
      active,
      actor,
      new Date().toISOString(),
      id,
      companyId,
    ],
  );
  await run(db, "INSERT INTO payroll_rule_history VALUES (?,?,?,?,?,?)", [
    randomUUID(),
    id,
    companyId,
    JSON.stringify({ before: rule, after: { ...spec, active } }),
    actor,
    new Date().toISOString(),
  ]);
  return { ...rule, ...spec, active };
}
export async function saveSpec(db, settlement, id, input, actor) {
  await ensureAdjustmentSchema(db);
  const spec = normalizeAdjustment(input);
  const [old] = await all(
    db,
    "SELECT * FROM payroll_adjustment_specs WHERE deductionId=?",
    [id],
  );
  if (input.ruleId && !old) await validateSavedSelection(db, settlement, input.ruleId);
  let ruleId = old?.ruleId || input.ruleId || null;
  if (input.repeat) {
    if (ruleId) await changeRule(db, settlement.companyId, ruleId, spec, actor);
    else {
      ruleId = randomUUID();
      await run(
        db,
        "INSERT INTO payroll_adjustment_rules VALUES (?,?,?,?,?,?,?,?,1,?,?)",
        [
          ruleId,
          settlement.companyId,
          settlement.driverId,
          spec.description,
          spec.kind,
          spec.basis,
          spec.value,
          settlement.periodEnd,
          actor,
          new Date().toISOString(),
        ],
      );
      await run(db, "INSERT INTO payroll_rule_history VALUES (?,?,?,?,?,?)", [
        randomUUID(),
        ruleId,
        settlement.companyId,
        JSON.stringify({ created: spec, effectiveAfter: settlement.periodEnd }),
        actor,
        new Date().toISOString(),
      ]);
    }
  }
  await run(
    db,
    "INSERT INTO payroll_adjustment_specs VALUES (?,?,?,?,?,?) ON CONFLICT(deductionId) DO UPDATE SET kind=excluded.kind,basis=excluded.basis,value=excluded.value,ruleId=excluded.ruleId",
    [id, settlement.id, spec.kind, spec.basis, spec.value, ruleId],
  );
}
export async function validateSavedSelection(db, settlement, ruleId) {
  await ensureAdjustmentSchema(db);
  const [rule] = await all(
    db,
    "SELECT * FROM payroll_adjustment_rules WHERE id=? AND companyId=? AND driverId=? AND active=1",
    [ruleId, settlement.companyId, settlement.driverId],
  );
  if (!rule)
    throw Object.assign(
      new Error("Saved adjustment is unavailable for this driver."),
      { status: 404 },
    );
  const [used] = await all(
    db,
    "SELECT deductionId FROM payroll_adjustment_specs WHERE settlementId=? AND ruleId=?",
    [settlement.id, ruleId],
  );
  if (used)
    throw Object.assign(
      new Error("This saved adjustment is already included in this period."),
      { status: 409 },
    );
  return rule;
}
export async function resolveAdjustments(db, settlement, loads, deductions) {
  await ensureAdjustmentSchema(db);
  const specs = await all(
    db,
    "SELECT * FROM payroll_adjustment_specs WHERE settlementId=?",
    [settlement.id],
  );
  const map = new Map(specs.map((s) => [s.deductionId, s]));
  const gross = loads.reduce((sum, l) => sum + Number(l.payAmount || 0), 0);
  return deductions.map((d) => {
    const spec = map.get(d.id);
    return spec
      ? {
          ...d,
          amount: adjustmentAmount(spec, gross),
          calculation: {
            basis: spec.basis,
            value: spec.value,
            kind: spec.kind,
            ruleId: spec.ruleId,
          },
        }
      : d;
  });
}
