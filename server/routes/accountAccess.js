import express from 'express';
import rateLimit from 'express-rate-limit';
import { createAccountAccessService, genericResetMessage } from '../accountAccess.js';

export default function createAccountAccessRoutes(db, { authenticate, requireTenantOwner, service = createAccountAccessService({ db }) }) {
  const router = express.Router();
  const limiter = (limit, windowMs) => rateLimit({ limit, windowMs, standardHeaders:true, legacyHeaders:false, message:{ error:'Too many requests. Please try again later.' } });
  const handle = (fn) => async (req,res) => {
    res.set('Cache-Control','no-store');
    try { await fn(req,res); }
    catch (error) {
      if (!error.status) console.error('[account-access] Request failed.');
      res.status(error.status || 500).json({ error:error.status ? error.message : 'Unable to complete this request. Please try again.' });
    }
  };
  router.post('/tenant-management/companies', authenticate, requireTenantOwner, limiter(20,3600000), handle(async(req,res) => {
    res.status(201).json(await service.createCompany(req.body || {}));
  }));
  router.post('/tenant-management/companies/:id/invitation', authenticate, requireTenantOwner, limiter(20,3600000), handle(async(req,res) => {
    res.json(await service.resend(req.params.id));
  }));
  router.post('/auth/forgot-password', limiter(10,900000), (req,res) => {
    res.set('Cache-Control','no-store').json({ok:true,message:genericResetMessage});
    // Respond identically before lookup or delivery, preventing timing-based enumeration.
    service.requestReset(req.body?.email).catch(() => console.error('[account-access] Password recovery could not be delivered.'));
  });
  router.post('/auth/complete-password', limiter(20,900000), handle(async(req,res) => {
    res.json(await service.complete(req.body || {}));
  }));
  router.post('/auth/register', (_req,res) => res.status(403).json({error:'Company accounts are created by the PortFlow owner. Please use Request information.'}));
  return router;
}
