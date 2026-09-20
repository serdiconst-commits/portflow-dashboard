import express from 'express';
import {
  canUsePayroll,
  ensurePayrollSettings,
  exportPayrollRunCsv,
  getPayrollRun,
  listPayrollRuns,
  updatePayrollSettings,
  writeFinancialAudit,
} from '../services/payrollService.js';

const requirePayrollAccess = (req, res, next) => {
  if (canUsePayroll(req.user?.role)) return next();
  return res.status(403).json({ error: 'You do not have permission to manage payroll.' });
};

const sendError = (res, error) => res.status(error.status || 500).json({ error: error.message || 'Payroll request failed.' });

export default function createPayrollRoutes(db) {
  const router = express.Router();
  router.use(requirePayrollAccess);
  // Preserve old reports; all new pay processing uses Driver Payroll settlements.
  const readOnlyHistory = (req, res, next) => ['GET', 'HEAD'].includes(req.method)
    ? next()
    : res.status(409).json({ error: 'Legacy payroll is read-only. Use Driver Payroll for new payments and corrections.' });
  router.use('/runs', readOnlyHistory);
  router.use('/adjustments', readOnlyHistory);

  router.get('/settings', async (req, res) => {
    try {
      res.json(await ensurePayrollSettings(db, req.user.companyId));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const settings = await updatePayrollSettings(db, req.user.companyId, req.body || {});
      await writeFinancialAudit(db, req.user.companyId, req.user, 'PAYROLL_SETTINGS_CHANGED', 'PAYROLL_SETTINGS', settings.id, {});
      res.json(settings);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      res.json(await listPayrollRuns(db, req.user.companyId));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/runs/:id', async (req, res) => {
    try {
      const run = await getPayrollRun(db, req.user.companyId, req.params.id);
      if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
      res.json(run);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/drivers/:driverId/history', async (req, res) => {
    try {
      const runs = await listPayrollRuns(db, req.user.companyId);
      res.json(runs.filter((run) => String(run.driverIds || '').includes(req.params.driverId)));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/runs/:id/export', async (req, res) => {
    try {
      const csv = await exportPayrollRunCsv(db, req.user.companyId, req.params.id);
      if (!csv) return res.status(404).json({ error: 'Payroll run not found.' });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-${req.params.id}.csv"`);
      res.send(csv);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
