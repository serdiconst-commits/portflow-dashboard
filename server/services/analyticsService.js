import { assertDateRange, centsToMoney, dbAll, dbGet, parseMoneyToCents } from './dbUtils.js';

const completedStatuses = ['delivered', 'completed'];
const cancelledStatuses = ['cancelled', 'canceled', 'deleted'];

const dateExpr = "DATE(SUBSTR(COALESCE(NULLIF(appointmentTime, ''), NULLIF(loadDate, '')), 1, 10))";
const invoiceDateExpr = "DATE(SUBSTR(COALESCE(NULLIF(issueDate, ''), NULLIF(createdAt, '')), 1, 10))";

export async function getCompanyAnalyticsSettings(db, companyId) {
  const company = await dbGet(
    db,
    `SELECT companyTimezone, allowAiAnalytics FROM companies WHERE id = ?`,
    [companyId]
  );
  return {
    timezone: company?.companyTimezone || 'America/Chicago',
    allowAiAnalytics: Number(company?.allowAiAnalytics || 0) === 1,
  };
}

export async function getAnalyticsPeriod(db, companyId, query = {}) {
  const { startDate, endDate } = assertDateRange(query.startDate, query.endDate);
  const settings = await getCompanyAnalyticsSettings(db, companyId);
  return { startDate, endDate, timezone: settings.timezone };
}

const wrap = (period, data, warnings = []) => ({ period, data, warnings });

const sumCents = (rows, field) =>
  rows.reduce((sum, row) => sum + parseMoneyToCents(row[field]), 0);

export async function getSummary(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const loadRows = await dbAll(
    db,
    `SELECT id, customer, driver, truck, rate, driverRate, detention, lumper, fuelAdvance, status
     FROM loads
     WHERE companyId = ?
       AND COALESCE(deletedAt, '') = ''
       AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const invoices = await dbAll(
    db,
    `SELECT id, amount, status, dueDate
     FROM invoices
     WHERE companyId = ?
       AND ${invoiceDateExpr} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const activeCustomers = await dbGet(
    db,
    `SELECT COUNT(DISTINCT customer) AS count
     FROM loads
     WHERE companyId = ? AND COALESCE(deletedAt, '') = '' AND ${dateExpr} BETWEEN DATE(?) AND DATE(?) AND TRIM(COALESCE(customer, '')) != ''`,
    [companyId, period.startDate, period.endDate]
  );
  const normalizedCompleted = loadRows.filter((load) =>
    completedStatuses.includes(String(load.status || '').toLowerCase())
  );
  const validDelivered = normalizedCompleted.filter(
    (load) => !cancelledStatuses.includes(String(load.status || '').toLowerCase())
  );

  // Operational revenue uses load.rate for delivered/completed loads only.
  // Invoiced and collected revenue use invoices.amount/status separately so load.rate and invoice.amount are never double-counted.
  const totalRevenueCents = sumCents(validDelivered, 'rate');
  const driverPayrollCents = sumCents(validDelivered, 'driverRate');
  const directExpensesCents = validDelivered.reduce(
    (sum, load) => sum + parseMoneyToCents(load.lumper) + parseMoneyToCents(load.fuelAdvance),
    0
  );
  const invoicedRevenueCents = sumCents(invoices, 'amount');
  const collectedRevenueCents = sumCents(
    invoices.filter((invoice) => String(invoice.status || '').toLowerCase() === 'paid'),
    'amount'
  );
  const overdueInvoices = invoices.filter(
    (invoice) =>
      String(invoice.status || '').toLowerCase() !== 'paid' &&
      invoice.dueDate &&
      String(invoice.dueDate).slice(0, 10) < period.endDate
  );
  const unbilledDelivered = await dbAll(
    db,
    `SELECT l.id
     FROM loads l
     LEFT JOIN invoices i ON i.loadId = l.id AND i.companyId = l.companyId
     WHERE l.companyId = ?
       AND COALESCE(l.deletedAt, '') = ''
       AND LOWER(COALESCE(l.status, '')) IN ('delivered', 'completed')
       AND ${dateExpr.replaceAll('appointmentTime', 'l.appointmentTime').replaceAll('loadDate', 'l.loadDate')} BETWEEN DATE(?) AND DATE(?)
       AND i.id IS NULL`,
    [companyId, period.startDate, period.endDate]
  );

  const driverCount = new Set(validDelivered.map((load) => load.driver).filter(Boolean)).size || 1;
  const truckCount = new Set(validDelivered.map((load) => load.truck).filter(Boolean)).size || 1;
  const completedLoads = validDelivered.length;
  const grossProfitCents = totalRevenueCents - driverPayrollCents - directExpensesCents;

  const warnings = [];
  const missingRate = validDelivered.filter((load) => parseMoneyToCents(load.rate) <= 0).length;
  if (missingRate) warnings.push(`${missingRate} completed loads have zero or missing revenue rate.`);

  return wrap(period, {
    totalRevenue: centsToMoney(totalRevenueCents),
    invoicedRevenue: centsToMoney(invoicedRevenueCents),
    collectedRevenue: centsToMoney(collectedRevenueCents),
    outstandingRevenue: centsToMoney(Math.max(0, invoicedRevenueCents - collectedRevenueCents)),
    driverPayroll: centsToMoney(driverPayrollCents),
    directLoadExpenses: centsToMoney(directExpensesCents),
    grossProfit: centsToMoney(grossProfitCents),
    netProfit: centsToMoney(grossProfitCents),
    completedLoads,
    averageRevenuePerLoad: centsToMoney(completedLoads ? totalRevenueCents / completedLoads : 0),
    averageDriverPayPerLoad: centsToMoney(completedLoads ? driverPayrollCents / completedLoads : 0),
    revenuePerDriver: centsToMoney(totalRevenueCents / driverCount),
    revenuePerTruck: centsToMoney(totalRevenueCents / truckCount),
    activeCustomers: Number(activeCustomers?.count || 0),
    overdueInvoices: overdueInvoices.length,
    unbilledDeliveredLoads: unbilledDelivered.length,
  }, warnings);
}

export async function getMonthlyRevenue(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const rows = await dbAll(
    db,
    `SELECT SUBSTR(COALESCE(NULLIF(appointmentTime, ''), loadDate), 1, 7) AS month,
            rate, driverRate, status
     FROM loads
     WHERE companyId = ? AND COALESCE(deletedAt, '') = '' AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const invoiceRows = await dbAll(
    db,
    `SELECT SUBSTR(COALESCE(NULLIF(issueDate, ''), createdAt), 1, 7) AS month, amount, status
     FROM invoices
     WHERE companyId = ? AND ${invoiceDateExpr} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const byMonth = new Map();
  const ensure = (month) => {
    if (!byMonth.has(month)) byMonth.set(month, { month, operationalRevenue: 0, invoicedRevenue: 0, collectedRevenue: 0 });
    return byMonth.get(month);
  };
  rows.forEach((row) => {
    if (!completedStatuses.includes(String(row.status || '').toLowerCase())) return;
    ensure(row.month || 'unknown').operationalRevenue += parseMoneyToCents(row.rate);
  });
  invoiceRows.forEach((row) => {
    const item = ensure(row.month || 'unknown');
    item.invoicedRevenue += parseMoneyToCents(row.amount);
    if (String(row.status || '').toLowerCase() === 'paid') item.collectedRevenue += parseMoneyToCents(row.amount);
  });
  return wrap(period, [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => ({
    ...row,
    operationalRevenue: centsToMoney(row.operationalRevenue),
    invoicedRevenue: centsToMoney(row.invoicedRevenue),
    collectedRevenue: centsToMoney(row.collectedRevenue),
  })));
}

export async function getRevenueVsPayroll(db, companyId, query = {}) {
  const summary = await getSummary(db, companyId, query);
  return wrap(summary.period, {
    revenue: summary.data.totalRevenue,
    driverPayroll: summary.data.driverPayroll,
    directExpenses: summary.data.directLoadExpenses,
    grossProfit: summary.data.grossProfit,
  }, summary.warnings);
}

export async function getLoadsByMonth(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const rows = await dbAll(
    db,
    `SELECT SUBSTR(COALESCE(NULLIF(appointmentTime, ''), loadDate), 1, 7) AS month, status, COUNT(*) AS count
     FROM loads
     WHERE companyId = ? AND COALESCE(deletedAt, '') = '' AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)
     GROUP BY month, status`,
    [companyId, period.startDate, period.endDate]
  );
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.month)) grouped.set(row.month, { month: row.month, totalLoads: 0, completedLoads: 0, cancelledLoads: 0 });
    const item = grouped.get(row.month);
    item.totalLoads += Number(row.count || 0);
    const status = String(row.status || '').toLowerCase();
    if (completedStatuses.includes(status)) item.completedLoads += Number(row.count || 0);
    if (cancelledStatuses.includes(status)) item.cancelledLoads += Number(row.count || 0);
  });
  return wrap(period, [...grouped.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))));
}

export async function getTopCustomers(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const rows = await dbAll(
    db,
    `SELECT customer, COUNT(*) AS loads, GROUP_CONCAT(rate, '|') AS rates
     FROM loads
     WHERE companyId = ?
       AND COALESCE(deletedAt, '') = ''
       AND LOWER(COALESCE(status, '')) IN ('delivered', 'completed')
       AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)
     GROUP BY customer
     ORDER BY loads DESC
     LIMIT 10`,
    [companyId, period.startDate, period.endDate]
  );
  return wrap(period, rows.map((row) => {
    const rates = String(row.rates || '').split('|').map(parseMoneyToCents);
    const revenue = rates.reduce((sum, cents) => sum + cents, 0);
    return {
      customer: row.customer || 'Unknown',
      loads: Number(row.loads || 0),
      revenue: centsToMoney(revenue),
      averageRate: centsToMoney(row.loads ? revenue / Number(row.loads) : 0),
    };
  }));
}

export async function getDriverEfficiency(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const rows = await dbAll(
    db,
    `SELECT l.driver AS driverId, COALESCE(d.name, l.driver) AS driverName, l.rate, l.driverRate
     FROM loads l
     LEFT JOIN drivers d ON d.id = l.driver AND d.companyId = l.companyId
     WHERE l.companyId = ?
       AND COALESCE(l.deletedAt, '') = ''
       AND LOWER(COALESCE(l.status, '')) IN ('delivered', 'completed')
       AND ${dateExpr.replaceAll('appointmentTime', 'l.appointmentTime').replaceAll('loadDate', 'l.loadDate')} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.driverId || 'Unassigned';
    if (!grouped.has(key)) grouped.set(key, { driverId: key, driverName: row.driverName || key, completedLoads: 0, driverPay: 0, revenueGenerated: 0 });
    const item = grouped.get(key);
    item.completedLoads += 1;
    item.driverPay += parseMoneyToCents(row.driverRate);
    item.revenueGenerated += parseMoneyToCents(row.rate);
  });
  return wrap(period, [...grouped.values()].map((row) => ({
    ...row,
    grossMargin: centsToMoney(row.revenueGenerated - row.driverPay),
    revenuePerLoad: centsToMoney(row.completedLoads ? row.revenueGenerated / row.completedLoads : 0),
    driverPay: centsToMoney(row.driverPay),
    revenueGenerated: centsToMoney(row.revenueGenerated),
  })));
}

export async function getInvoiceStatus(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const rows = await dbAll(
    db,
    `SELECT status, COUNT(*) AS count, GROUP_CONCAT(amount, '|') AS amounts
     FROM invoices
     WHERE companyId = ? AND ${invoiceDateExpr} BETWEEN DATE(?) AND DATE(?)
     GROUP BY status`,
    [companyId, period.startDate, period.endDate]
  );
  return wrap(period, rows.map((row) => ({
    status: row.status || 'Pending',
    count: Number(row.count || 0),
    amount: centsToMoney(String(row.amounts || '').split('|').reduce((sum, value) => sum + parseMoneyToCents(value), 0)),
  })));
}

export async function getPayrollTrend(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const rows = await dbAll(
    db,
    `SELECT STRFTIME('%Y-W%W', COALESCE(NULLIF(appointmentTime, ''), loadDate)) AS week,
            driver, driverRate, id
     FROM loads
     WHERE companyId = ?
       AND COALESCE(deletedAt, '') = ''
       AND LOWER(COALESCE(status, '')) IN ('delivered', 'completed')
       AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.week)) grouped.set(row.week, { week: row.week, payrollTotal: 0, drivers: new Set(), paidLoads: 0 });
    const item = grouped.get(row.week);
    item.payrollTotal += parseMoneyToCents(row.driverRate);
    if (row.driver) item.drivers.add(row.driver);
    item.paidLoads += 1;
  });
  return wrap(period, [...grouped.values()].map((row) => ({
    week: row.week,
    payrollTotal: centsToMoney(row.payrollTotal),
    driverCount: row.drivers.size,
    paidLoads: row.paidLoads,
    averagePayPerLoad: centsToMoney(row.paidLoads ? row.payrollTotal / row.paidLoads : 0),
  })));
}

export async function getReviewItems(db, companyId, query = {}) {
  const period = await getAnalyticsPeriod(db, companyId, query);
  const deliveredWithoutInvoices = await dbAll(
    db,
    `SELECT l.id, l.referenceNumber, l.containerNumber, l.customer
     FROM loads l
     LEFT JOIN invoices i ON i.loadId = l.id AND i.companyId = l.companyId
     WHERE l.companyId = ? AND LOWER(COALESCE(l.status, '')) IN ('delivered', 'completed')
       AND COALESCE(l.deletedAt, '') = ''
       AND ${dateExpr.replaceAll('appointmentTime', 'l.appointmentTime').replaceAll('loadDate', 'l.loadDate')} BETWEEN DATE(?) AND DATE(?)
       AND i.id IS NULL`,
    [companyId, period.startDate, period.endDate]
  );
  const deliveredMissingDriverRate = await dbAll(
    db,
    `SELECT id, referenceNumber, containerNumber, driver
     FROM loads
     WHERE companyId = ? AND LOWER(COALESCE(status, '')) IN ('delivered', 'completed')
       AND COALESCE(deletedAt, '') = ''
       AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)
       AND COALESCE(driverRate, '') IN ('', '$0.00', '0', 0)`,
    [companyId, period.startDate, period.endDate]
  );
  const badRevenue = await dbAll(
    db,
    `SELECT id, referenceNumber, containerNumber, rate, driverRate
     FROM loads
     WHERE companyId = ? AND LOWER(COALESCE(status, '')) IN ('delivered', 'completed')
       AND COALESCE(deletedAt, '') = ''
       AND ${dateExpr} BETWEEN DATE(?) AND DATE(?)`,
    [companyId, period.startDate, period.endDate]
  );
  const duplicateInvoiceNumbers = await dbAll(
    db,
    `SELECT invoiceNumber, COUNT(*) AS count
     FROM invoices
     WHERE companyId = ? AND TRIM(COALESCE(invoiceNumber, '')) != ''
     GROUP BY invoiceNumber
     HAVING COUNT(*) > 1`,
    [companyId]
  );
  const overdueInvoices = await dbAll(
    db,
    `SELECT id, invoiceNumber, customerName, amount, dueDate, status
     FROM invoices
     WHERE companyId = ? AND dueDate < ? AND LOWER(COALESCE(status, '')) != 'paid'`,
    [companyId, period.endDate]
  );
  const driversWithoutTruck = await dbAll(
    db,
    `SELECT id, name FROM drivers WHERE companyId = ? AND COALESCE(TRIM(truck), '') = '' AND COALESCE(isActive, 1) = 1`,
    [companyId]
  );

  const zeroOrNegativeRate = badRevenue.filter((load) => parseMoneyToCents(load.rate) <= 0);
  const driverPayGreaterThanRevenue = badRevenue.filter((load) => parseMoneyToCents(load.driverRate) > parseMoneyToCents(load.rate));

  return wrap(period, {
    deliveredLoadsWithoutInvoices: deliveredWithoutInvoices,
    deliveredLoadsMissingDriverRate: deliveredMissingDriverRate,
    loadsWithZeroOrNegativeRate: zeroOrNegativeRate,
    loadsWhereDriverPayGreaterThanRevenue: driverPayGreaterThanRevenue,
    duplicateInvoiceNumbers,
    loadsIncludedInMultiplePayrollPeriods: [],
    driversWithoutTruck,
    unapprovedDeductions: [],
    overdueInvoices,
  });
}

export const analyticsHandlers = {
  summary: getSummary,
  monthlyRevenue: getMonthlyRevenue,
  revenueVsPayroll: getRevenueVsPayroll,
  loadsByMonth: getLoadsByMonth,
  topCustomers: getTopCustomers,
  driverEfficiency: getDriverEfficiency,
  invoiceStatus: getInvoiceStatus,
  payrollTrend: getPayrollTrend,
  reviewItems: getReviewItems,
};
