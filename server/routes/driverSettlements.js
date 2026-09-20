import { candidates, recordPayment, createCorrection, get as lifecycleGet, ensureLifecycle } from '../services/payrollLifecycle.js';
import { listRules, changeRule } from '../services/payrollAdjustments.js';
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
  transitionSettlement,
} from '../services/driverSettlements.js';
import { buildSettlementPdf, sendSettlementEmail } from '../settlementEmail.js';

const mutationQueues = new WeakMap();
const settlementRoles = new Set(['owner', 'carrier', 'admin', 'manager', 'dispatcher', 'payroll']);

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

const dbGet = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
});
const dbRun = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (error) => (error ? reject(error) : resolve()));
});

export default function createDriverSettlementRoutes(db) {
  const router = express.Router();

  router.get('/self', async (req, res) => {
    try {
      if (req.user?.role !== 'driver' || !req.user?.driverId) {
        return res.status(403).json({ error: 'Only driver accounts can view their payments.' });
      }
      const rows = await listSettlements(db, req.company.companyId, { driverId: req.user.driverId });
      res.json(rows);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/self/:id', async (req, res) => {
    try {
      if (req.user?.role !== 'driver' || !req.user?.driverId) {
        return res.status(403).json({ error: 'Only driver accounts can view their payments.' });
      }
      const settlement = await getSettlement(db, req.company.companyId, req.params.id);
      if (!settlement || settlement.driverId !== req.user.driverId) {
        return res.status(404).json({ error: 'Settlement not found.' });
      }
      res.json(settlement);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.use(requireSettlementAccess);
  // A shared SQLite connection must not interleave settlement write transactions.
  router.use(async (req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
    const previous=mutationQueues.get(db)||Promise.resolve();let release;
    const pending=new Promise(resolve=>{release=resolve;});mutationQueues.set(db,pending);
    await previous;
    if(res.destroyed){release();return;}
    res.once('finish',release);res.once('close',release);next();
  });

  router.get('/rules/:driverId', async (req,res) => {
    try { res.json(await listRules(db,req.company.companyId,req.params.driverId)); } catch(e) { sendError(res,e); }
  });
  router.put('/rules/:ruleId', async (req,res) => {
    try { const rule=await changeRule(db,req.company.companyId,req.params.ruleId,req.body,getActor(req)); if(!rule)return res.status(404).json({error:'Rule not found.'});res.json(rule); } catch(e) {sendError(res,e);}
  });

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

  router.get('/:id/candidates', async (req,res)=>{
    try { const settlement=await getSettlement(db,req.company.companyId,req.params.id);if(!settlement)return res.status(404).json({error:'Settlement not found.'});res.json(await candidates(db,req.company.companyId,settlement,String(req.query.q||''))); }catch(e){sendError(res,e);}
  });
  router.post('/:id/payment', async (req,res)=>{
    try {const settlement=await getSettlement(db,req.company.companyId,req.params.id);if(!settlement)return res.status(404).json({error:'Settlement not found.'});await recordPayment(db,req.company.companyId,settlement,req.body,getActor(req));res.json(await getSettlement(db,req.company.companyId,req.params.id));}catch(e){sendError(res,e);}
  });
  router.post('/:id/correction', async (req,res)=>{
    try {const settlement=await getSettlement(db,req.company.companyId,req.params.id);if(!settlement)return res.status(404).json({error:'Settlement not found.'});const id=await createCorrection(db,req.company.companyId,settlement,req.body,getActor(req));res.status(201).json(await recalculateSettlement(db,req.company.companyId,id,getActor(req)));}catch(e){sendError(res,e);}
  });
  router.get('/:id/versions/:versionId/pdf', async (req,res)=>{
    try {await ensureLifecycle(db);const row=await lifecycleGet(db,'SELECT * FROM settlement_versions WHERE id=? AND settlementId=? AND companyId=?',[req.params.versionId,req.params.id,req.company.companyId]);if(!row)return res.status(404).json({error:'Version not found.'});const snapshot=JSON.parse(row.snapshot);snapshot.status='Replaced';const company=await dbGet(db,'SELECT name,invoiceName,settlementCompanyName FROM companies WHERE id=?',[req.company.companyId]);res.type('pdf').send(await buildSettlementPdf(snapshot,company||{}));}catch(e){sendError(res,e);}
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

  router.post('/:id/transition', async (req, res) => {
    try {
      const settlement = await transitionSettlement(
        db,
        req.company.companyId,
        req.params.id,
        req.body || {},
        getActor(req)
      );
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

  router.get('/:id/pdf', async (req, res) => {
    try {
      const settlement = await getSettlement(db, req.company.companyId, req.params.id);
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      const company = await dbGet(db, `SELECT name, invoiceName, settlementCompanyName, invoiceAddress, invoiceSettingsJson FROM companies WHERE id = ?`, [req.company.companyId]);
      const pdfBuffer = await buildSettlementPdf(settlement, company || {});
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Settlement-${settlement.driverId}-${settlement.periodStart}-${settlement.periodEnd}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:id/send-email', async (req, res) => {
    try {
      const settlement = await getSettlement(db, req.company.companyId, req.params.id);
      if (!settlement) return res.status(404).json({ error: 'Settlement not found.' });
      if (!['reviewed', 'finalized', 'paid'].includes(String(settlement.status || '').trim().toLowerCase())) {
        return res.status(409).json({ error: 'Review the settlement before emailing it to the driver.' });
      }

      const driver = await dbGet(db, `SELECT id, name, email FROM drivers WHERE id = ? AND companyId = ?`, [settlement.driverId, req.company.companyId]);
      if (!driver?.email) return res.status(400).json({ error: 'This driver does not have an email address.' });
      const company = await dbGet(db, `SELECT name, invoiceName, settlementCompanyName FROM companies WHERE id = ?`, [req.company.companyId]);
      const pdfBuffer = await buildSettlementPdf(settlement, company || {});
      await sendSettlementEmail({ settlement, company: company || {}, driver, pdfBuffer });

      const emailedAt = new Date().toISOString();
      await dbRun(db, `UPDATE settlements SET emailedAt = ?, emailedTo = ?, updatedAt = ? WHERE id = ? AND companyId = ?`, [emailedAt, driver.email, emailedAt, settlement.id, req.company.companyId]);
      res.json({ success: true, emailedAt, emailedTo: driver.email });
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
