import express from 'express';
import {
  addDeduction,
  addSettlementLoad,
  createSettlement,
  deleteSettlement,
  getSettlement,
  listSettlements,
  recalculateSettlement,
  removeDeduction,
  removeSettlementLoad,
  updateDeduction,
  updateSettlementLoad,
  updateSettlement,
} from '../services/driverSettlements.js';

const settlementRoles = new Set(['admin', 'manager', 'dispatcher', 'payroll']);

const getActor = (req) => req.user?.name || req.user?.email || req.user?.id || 'system';

const requireSettlementAccess = (req, res, next) => {
  if (!settlementRoles.has(req.user?.role)) {
    return res.status(403).json({ error: 'You do not have permission to manage driver settlements.' });
  }
  next();
};

const sendError = (res, error) => {
  const status = error.status || (error.message?.includes('required') ? 400 : 500);
  res.status(status).json({ error: error.message || 'Settlement request failed.' });
};

export default function createDriverSettlementRoutes(db) {
  const router = express.Router();
  router.use(requireSettlementAccess);

  router.get('/', async (req, res) => {
    try {
      const rows = await listSettlements(db, req.company.companyId, req.query || {});
      res.json(rows);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const settlement = await createSettlement(db, req.company.companyId, req.body || {}, getActor(req));
      res.status(201).json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const settlement = await getSettlement(db, req.company.companyId, req.params.id);
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const settlement = await updateSettlement(db, req.company.companyId, req.params.id, req.body || {}, getActor(req));
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const deleted = await deleteSettlement(db, req.company.companyId, req.params.id, getActor(req));
      if (!deleted) return res.status(404).json({ error: 'Settlement not found.' });
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:id/recalculate', async (req, res) => {
    try {
      const settlement = await recalculateSettlement(db, req.company.companyId, req.params.id, getActor(req));
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:id/statement', async (req, res) => {
    try {
      const settlement = await getSettlement(db, req.company.companyId, req.params.id);
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      res.json(settlement.statement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:id/loads', async (req, res) => {
    try {
      const settlement = await addSettlementLoad(db, req.company.companyId, req.params.id, req.body || {}, getActor(req));
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      res.status(201).json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/:id/loads/:settlementLoadId', async (req, res) => {
    try {
      const settlement = await removeSettlementLoad(
        db,
        req.company.companyId,
        req.params.id,
        req.params.settlementLoadId,
        getActor(req)
      );
      if (!settlement) return res.status(404).json({ error: 'Settlement load not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/:id/loads/:settlementLoadId', async (req, res) => {
    try {
      const settlement = await updateSettlementLoad(
        db,
        req.company.companyId,
        req.params.id,
        req.params.settlementLoadId,
        req.body || {},
        getActor(req)
      );
      if (!settlement) return res.status(404).json({ error: 'Settlement load not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:id/deductions', async (req, res) => {
    try {
      const settlement = await addDeduction(db, req.company.companyId, req.params.id, req.body || {}, getActor(req));
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      res.status(201).json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/:id/deductions/:deductionId', async (req, res) => {
    try {
      const settlement = await updateDeduction(
        db,
        req.company.companyId,
        req.params.id,
        req.params.deductionId,
        req.body || {},
        getActor(req)
      );
      if (!settlement) return res.status(404).json({ error: 'Deduction not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/:id/deductions/:deductionId', async (req, res) => {
    try {
      const settlement = await removeDeduction(
        db,
        req.company.companyId,
        req.params.id,
        req.params.deductionId,
        getActor(req)
      );
      if (!settlement) return res.status(404).json({ error: 'Deduction not found.' });
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
