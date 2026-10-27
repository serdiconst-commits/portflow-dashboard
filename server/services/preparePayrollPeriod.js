import { dbAll } from './dbUtils.js';
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
    // Reuse the existing settlement path: append newly completed movements to
    // Drafts, preserving edited lines/exclusions and leaving locked records alone.
    await createSettlement(db, companyId, {driverId:driver.id,periodStart,periodEnd}, actor);
  }
  return listSettlements(db, companyId, {periodStart,periodEnd});
}
