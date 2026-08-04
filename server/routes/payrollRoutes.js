import express from 'express';
import {
  canUsePayroll,
  ensurePayrollSettings,
  exportPayrollRunCsv,
  generatePayrollRun,
  getPayrollRun,
  listPayrollRuns,
  recalculatePayrollRun,
  transitionPayrollRun,
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

  router.post('/runs/generate', async (req, res) => {
    try {
      const run = await generatePayrollRun(db, req.user.companyId, req.body || {}, req.user);
      await writeFinancialAudit(db, req.user.companyId, req.user, 'PAYROLL_GENERATED', 'PAYROLL_RUN', run.id, {
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
      });
      res.status(201).json(run);
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

  router.post('/runs/:id/recalculate', async (req, res) => {
    try {
      const run = await recalculatePayrollRun(db, req.user.companyId, req.params.id, req.user);
      if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
      res.json(run);
    } catch (error) {
      sendError(res, error);
    }
  });

  const transition = (status) => async (req, res) => {
    try {
      const run = await transitionPayrollRun(db, req.user.companyId, req.params.id, status, req.user);
      if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
      res.json(run);
    } catch (error) {
      sendError(res, error);
    }
  };

  router.post('/runs/:id/submit-review', transition('Review'));
  router.post('/runs/:id/approve', transition('Approved'));
  router.post('/runs/:id/finalize', transition('Finalized'));
  router.post('/runs/:id/mark-paid', transition('Paid'));
  router.post('/runs/:id/void', transition('Voided'));

  router.post('/runs/:id/adjustments', (_req, res) => res.status(501).json({ error: 'Payroll adjustments API is scaffolded but not implemented in this pass.' }));
  router.put('/adjustments/:id', (_req, res) => res.status(501).json({ error: 'Payroll adjustments API is scaffolded but not implemented in this pass.' }));
  router.post('/adjustments/:id/approve', (_req, res) => res.status(501).json({ error: 'Payroll adjustment approval is scaffolded but not implemented in this pass.' }));
  router.delete('/adjustments/:id', (_req, res) => res.status(501).json({ error: 'Payroll adjustment deletion is scaffolded but not implemented in this pass.' }));

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
