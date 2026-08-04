import {
  getDriverEfficiency,
  getMonthlyRevenue,
  getReviewItems,
  getSummary,
  getTopCustomers as getTopCustomersMetric,
} from '../services/analyticsService.js';

export const analyticsTools = {
  async getRevenueSummary(db, context, period) {
    const result = await getSummary(db, context.companyId, period);
    return { type: 'revenue_summary', source: 'loads.rate and invoices.amount separated', ...result };
  },
  async getRevenueComparison(db, context, period) {
    const result = await getMonthlyRevenue(db, context.companyId, period);
    return { type: 'revenue_comparison', source: 'monthly operational/invoiced/collected revenue', ...result };
  },
  async getPayrollSummary(db, context, period) {
    const result = await getSummary(db, context.companyId, period);
    return { type: 'payroll_summary', source: 'loads.driverRate for completed loads', period: result.period, data: { driverPayroll: result.data.driverPayroll, completedLoads: result.data.completedLoads }, warnings: result.warnings };
  },
  async getPayrollComparison(db, context, period) {
    const result = await getSummary(db, context.companyId, period);
    return { type: 'payroll_comparison', source: 'current period summary', period: result.period, data: { driverPayroll: result.data.driverPayroll, averageDriverPayPerLoad: result.data.averageDriverPayPerLoad }, warnings: result.warnings };
  },
  async getTopCustomers(db, context, period) {
    const result = await getTopCustomersMetric(db, context.companyId, period);
    return { type: 'top_customers', source: 'completed loads grouped by customer', ...result };
  },
  async getDriverEfficiency(db, context, period) {
    const result = await getDriverEfficiency(db, context.companyId, period);
    return { type: 'driver_efficiency', source: 'completed loads grouped by driver', ...result };
  },
  async getOutstandingInvoices(db, context, period) {
    const result = await getSummary(db, context.companyId, period);
    return { type: 'outstanding_invoices', source: 'invoice amount less paid invoices', period: result.period, data: { outstandingRevenue: result.data.outstandingRevenue, overdueInvoices: result.data.overdueInvoices }, warnings: result.warnings };
  },
  async getUnbilledLoads(db, context, period) {
    const result = await getSummary(db, context.companyId, period);
    return { type: 'unbilled_loads', source: 'completed loads with no invoice row', period: result.period, data: { unbilledDeliveredLoads: result.data.unbilledDeliveredLoads }, warnings: result.warnings };
  },
  async getPayrollExceptions(db, context, period) {
    const result = await getReviewItems(db, context.companyId, period);
    return { type: 'payroll_exceptions', source: 'review item queries', ...result };
  },
  async getRevenueTrend(db, context, period) {
    const result = await getMonthlyRevenue(db, context.companyId, period);
    return { type: 'revenue_trend', source: 'monthly completed load revenue and invoices', ...result };
  },
  async getCompanyPerformanceSummary(db, context, period) {
    const result = await getSummary(db, context.companyId, period);
    return { type: 'company_performance_summary', source: 'business dashboard summary metrics', ...result };
  },
};

export const pickAnalyticsTools = (question = '') => {
  const text = String(question || '').toLowerCase();
  if (text.includes('customer') || text.includes('cliente')) return ['getTopCustomers', 'getRevenueSummary'];
  if (text.includes('driver') || text.includes('conductor') || text.includes('efficient') || text.includes('eficiente')) return ['getDriverEfficiency', 'getPayrollSummary'];
  if (text.includes('payroll') || text.includes('nómina') || text.includes('nomina')) return ['getPayrollSummary', 'getPayrollExceptions'];
  if (text.includes('invoice') || text.includes('factura') || text.includes('outstanding') || text.includes('pendiente')) return ['getOutstandingInvoices', 'getUnbilledLoads'];
  if (text.includes('compare') || text.includes('compara') || text.includes('trend') || text.includes('tendencia')) return ['getRevenueComparison', 'getRevenueTrend'];
  return ['getCompanyPerformanceSummary'];
};
