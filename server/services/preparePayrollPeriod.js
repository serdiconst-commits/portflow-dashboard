import { dbAll, dbGet } from './dbUtils.js';
import { ensureLifecycle, validPayrollDate } from './payrollLifecycle.js';
import { createSettlement, listSettlements } from './driverSettlements.js';

// Called within the settlement router's shared mutation queue.
export async function preparePayrollPeriod(db, companyId, input, actor) {
  const { periodStart, periodEnd } = input;
  if (!validPayrollDate(periodStart) || !validPayrollDate(periodEnd) || periodStart > periodEnd) {
    throw Object.assign(new Error('Choose a valid payroll period.'), {status:400});
  }
  await ensureLifecycle(db);
  const drivers = await dbAll(db, 'SELECT id FROM drivers WHERE companyId=? ORDER BY id', [companyId]);
  for (const driver of drivers) {
    const existing = await dbGet(db, `SELECT s.id FROM settlements s WHERE s.companyId=? AND s.driverId=?
      AND s.periodStart=? AND s.periodEnd=?
      AND NOT EXISTS (SELECT 1 FROM settlement_corrections c WHERE c.settlementId=s.id) LIMIT 1`,
      [companyId, driver.id, periodStart, periodEnd]);
    // Opening a period must not overwrite manual edits or finalized statements.
    if (!existing) await createSettlement(db, companyId, {driverId:driver.id,periodStart,periodEnd}, actor);
  }
  return listSettlements(db, companyId, {periodStart,periodEnd});
}
