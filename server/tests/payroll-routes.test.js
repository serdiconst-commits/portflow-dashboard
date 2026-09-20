import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDb } from "./fixtures/payrollDb.js";
import routes from "../routes/driverSettlements.js";
import { run } from "../services/payrollLifecycle.js";
import {
  createSettlement,
  transitionSettlement,
} from "../services/driverSettlements.js";

test("payment route rejects duplicate requests; self view, PDF and cross-company authorization agree", async (t) => {
  const db = await createDb();
  await run(
    db,
    "INSERT INTO loads(id,companyId,driver,status,appointmentTime,driverRate) VALUES('L1','COMP-A','DRV-A','Completed','2026-09-15','100')",
  );
  let s = await createSettlement(db, "COMP-A", {
    driverId: "DRV-A",
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
  });
  s = await transitionSettlement(db, "COMP-A", s.id, { action: "review" });
  s = await transitionSettlement(db, "COMP-A", s.id, { action: "finalize" });
  await run(db, "ALTER TABLE companies ADD COLUMN name TEXT");
  await run(db, "ALTER TABLE companies ADD COLUMN invoiceName TEXT");
  await run(db, "ALTER TABLE companies ADD COLUMN settlementCompanyName TEXT");
  await run(db, "ALTER TABLE companies ADD COLUMN invoiceAddress TEXT");
  await run(db, "ALTER TABLE companies ADD COLUMN invoiceSettingsJson TEXT");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const companyId = req.headers["x-company"] || "COMP-A";
    req.user = {
      companyId,
      role: req.headers["x-role"] || "payroll",
      driverId: "DRV-A",
      name: "QA",
    };
    req.company = { companyId };
    next();
  });
  app.use("/api/driver-settlements", routes(db));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await new Promise((r) => db.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/driver-settlements`;
  assert.equal(
    (await fetch(`${base}/${s.id}`, { headers: { "x-company": "COMP-B" } }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/${s.id}`, { headers: { "x-role": "driver" } }))
      .status,
    403,
  );
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paidOn: "2026-09-20",
      method: "ACH",
      reference: "TEST",
    }),
  };
  const replies = await Promise.all([
    fetch(`${base}/${s.id}/payment`, options),
    fetch(`${base}/${s.id}/payment`, options),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const self = await (
    await fetch(`${base}/self/${s.id}`, { headers: { "x-role": "driver" } })
  ).json();
  assert.equal(self.status, "Paid");
  assert.equal(self.statement.totals.netPay, 100);
  assert.equal(self.payment.amount, 100);
  const pdf = await fetch(`${base}/${s.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 4)
      .toString(),
    "%PDF",
  );
  assert.equal(
    (
      await fetch(`${base}/${s.id}/deductions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Wrong", amount: -10 }),
      })
    ).status,
    409,
  );
});

test('legacy payroll endpoints preserve history but cannot run a second payment workflow', async t => {
  const {default: legacyRoutes} = await import('../routes/payrollRoutes.js');
  const db = await createDb();
  const app = express();
  app.use(express.json());
  app.use((req,res,next)=>{req.user={companyId:'COMP-A',role:'payroll'};next();});
  app.use('/api/payroll',legacyRoutes(db));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>db.close(r));});
  const base=`http://127.0.0.1:${server.address().port}/api/payroll`;
  for (const [method,path] of [['POST','/runs/generate'],['POST','/runs/old/recalculate'],['POST','/runs/old/finalize'],['POST','/runs/old/mark-paid'],['POST','/runs/old/adjustments'],['PUT','/adjustments/old'],['DELETE','/adjustments/old']]) {
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,409,`${method} ${path}`);
  }
  const history=await fetch(base+'/runs');
  assert.equal(history.status,200);
  assert.deepEqual(await history.json(),[]);
});
