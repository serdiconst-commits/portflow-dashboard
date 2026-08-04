import express from 'express';
import { analyticsHandlers } from '../services/analyticsService.js';

const financialRoles = new Set(['carrier', 'admin', 'administrator', 'owner', 'payroll']);

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const requireAnalyticsAccess = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (financialRoles.has(role)) return next();
  return res.status(403).json({ error: 'You do not have permission to view business analytics.' });
};

const send = (handler) => async (req, res) => {
  try {
    const result = await handler(req.app.locals.db, req.user.companyId, req.query || {});
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
  }
};

export default function createAnalyticsRoutes(db) {
  const router = express.Router();
  router.use((req, _res, next) => {
    req.app.locals.db = db;
    next();
  });
  router.use(requireAnalyticsAccess);
  router.get('/summary', send(analyticsHandlers.summary));
  router.get('/monthly-revenue', send(analyticsHandlers.monthlyRevenue));
  router.get('/revenue-vs-payroll', send(analyticsHandlers.revenueVsPayroll));
  router.get('/loads-by-month', send(analyticsHandlers.loadsByMonth));
  router.get('/top-customers', send(analyticsHandlers.topCustomers));
  router.get('/driver-efficiency', send(analyticsHandlers.driverEfficiency));
  router.get('/invoice-status', send(analyticsHandlers.invoiceStatus));
  router.get('/payroll-trend', send(analyticsHandlers.payrollTrend));
  router.get('/review-items', send(analyticsHandlers.reviewItems));
  return router;
}
