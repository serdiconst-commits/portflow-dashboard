import express from 'express';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSignedPodPdf, sendPodEmail, validatePod } from '../driverPod.js';

const get = (db, sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e,r) => e ? reject(e) : resolve(r)));
const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, e => e ? reject(e) : resolve()));
const fail = (status, message) => Object.assign(new Error(message), {status});
const hash = value => createHash('sha256').update(value).digest('hex');

export default function createDriverPodRoutes(db, { uploadsDir, audit = () => {}, email = sendPodEmail } = {}) {
  const router = express.Router();
  const pending = new Set();
  router.use((req,res,next) => {
    if (req.user?.role !== 'driver' || !req.user.driverId) return res.status(403).json({error:'Only assigned drivers can sign PODs.'});
    next();
  });
  const access = async req => {
    const load = await get(db, `SELECT l.* FROM loads l WHERE l.id = ? AND l.companyId = ? AND (
      l.driver = ? OR EXISTS (SELECT 1 FROM load_moves m WHERE m.loadId = l.id AND m.companyId = l.companyId AND m.driverId = ? AND m.status <> 'Cancelled')
    )`, [req.params.loadId, req.company.companyId, req.user.driverId, req.user.driverId]);
    if (!load) throw fail(404, 'Assigned load not found. Contact dispatch if the assignment changed.');
    return load;
  };
  const handle = fn => async (req,res) => { try { await fn(req,res); } catch(e) {
    if (!e.status) console.error('[driver-pod]', e.message);
    res.status(e.status || 500).json({error: e.status ? e.message : 'Unable to save POD. Your draft is kept; please retry.'});
  }};
  const documentFor = async (req, id) => {
    const pod = await get(db, 'SELECT * FROM signed_pods WHERE id = ? AND companyId = ? AND loadId = ? AND driverId = ?', [id,req.company.companyId,req.params.loadId,req.user.driverId]);
    if (!pod) throw fail(404, 'Signed POD not found.');
    const document = await get(db, 'SELECT * FROM documents WHERE id = ? AND loadId = ?', [pod.documentId,pod.loadId]);
    if (!document) throw fail(409, 'POD is still pending. Retry saving it before sending email.');
    return {pod,document};
  };
  const publicDocument = d => ({id:d.id,name:d.name,type:d.type,size:d.size,category:d.category,url:`/api/documents/${encodeURIComponent(d.id)}/file`});

  router.get('/:loadId/options', handle(async (req,res) => {
    const load = await access(req);
    const customer = await get(db, 'SELECT email FROM customers WHERE companyId = ? AND name = ? LIMIT 1', [req.company.companyId,load.customer]);
    res.json({customerEmail:customer?.email || '', emailAvailable:Boolean(process.env.RESEND_API_KEY && (process.env.POD_FROM_EMAIL || process.env.DRIVER_COMPLIANCE_FROM_EMAIL))});
  }));

  router.post('/:loadId', handle(async (req,res) => {
    const load = await access(req);
    const pod = validatePod(req.body);
    const id = hash(`${req.company.companyId}:${load.id}:${req.user.driverId}:${pod.requestId}`);
    if (pending.has(id)) throw fail(409, 'POD is being saved. Please retry in a moment.');
    pending.add(id);
    try {
      const payloadHash = hash(JSON.stringify(pod));
      const docId = `signed-pod-${id}`;
      await run(db, `INSERT OR IGNORE INTO signed_pods (id,companyId,loadId,driverId,payloadHash,signedAt,documentId,createdAt) VALUES (?,?,?,?,?,?,?,?)`, [id,req.company.companyId,load.id,req.user.driverId,payloadHash,pod.signedAt,docId,new Date().toISOString()]);
      const existing = await get(db, 'SELECT * FROM signed_pods WHERE id = ?', [id]);
      if (existing.payloadHash !== payloadHash) throw fail(409, 'This submission already contains a different signature. Start a new POD.');
      let document = await get(db, 'SELECT * FROM documents WHERE id = ? AND loadId = ?', [docId,load.id]);
      if (!document) {
        const company = await get(db, 'SELECT * FROM companies WHERE id = ?', [req.company.companyId]);
        const driver = await get(db, 'SELECT name FROM drivers WHERE id = ? AND companyId = ?', [req.user.driverId,req.company.companyId]);
        const buffer = await buildSignedPodPdf({load,company:company || {},driverName:driver?.name || req.user.name || req.user.driverId,pod});
        const filePath = path.join(uploadsDir, `${docId}.pdf`);
        await fs.writeFile(filePath,buffer);
        const name = `POD-${String(load.id).replace(/[^a-z0-9_-]/gi,'_')}-signed.pdf`;
        await run(db, 'INSERT OR IGNORE INTO documents (id,loadId,name,size,type,category,filePath,uploadedAt) VALUES (?,?,?,?,?,?,?,?)', [docId,load.id,name,`${(buffer.length/1024).toFixed(1)} KB`,'application/pdf','POD',filePath,new Date().toISOString()]);
        document = await get(db, 'SELECT * FROM documents WHERE id = ?', [docId]);
        audit(req,{action:'SIGNED_POD_CREATED',entityType:'DOCUMENT',entityId:load.id,entityLabel:load.containerNumber || load.id,newValue:{documentId:docId,receiverName:pod.receiverName,signedAt:pod.signedAt}});
      }
      res.json({podId:id,document:publicDocument(document)});
    } finally { pending.delete(id); }
  }));

  router.get('/:loadId/:podId/file', handle(async (req,res) => {
    await access(req);
    const {document} = await documentFor(req,req.params.podId);
    res.type('application/pdf').send(await fs.readFile(document.filePath));
  }));

  router.post('/:loadId/:podId/email', handle(async (req,res) => {
    await access(req);
    const {pod,document} = await documentFor(req,req.params.podId);
    const recipient = String(req.body.recipient || '').trim().toLowerCase();
    if (recipient.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) throw fail(400,'Enter one valid recipient email address.');
    // One send per POD/recipient; retries reuse the provider key and stored result.
    const id = hash(`${pod.id}:${recipient}`);
    if (pending.has(id)) throw fail(409,'Email is being sent. Please wait a moment.');
    pending.add(id);
    try {
      let sent = await get(db, 'SELECT * FROM pod_emails WHERE id = ?', [id]);
      if (sent?.providerId) return res.json({accepted:true,recipient,alreadySent:true});
      await run(db,'INSERT OR IGNORE INTO pod_emails (id,podId,recipient,createdAt) VALUES (?,?,?,?)',[id,pod.id,recipient,new Date().toISOString()]);
      sent = await get(db,'SELECT * FROM pod_emails WHERE id = ?',[id]);
      if (Date.now() - Date.parse(sent.createdAt) > 23*60*60*1000) throw fail(409,'The earlier email could not be confirmed. Contact dispatch before sending again.');
      let providerId;
      try { providerId = await email({recipient,filename:document.name,buffer:await fs.readFile(document.filePath),loadId:pod.loadId,idempotencyKey:`pod-${id}`}); }
      catch(e) {
        if (e.notAttempted) await run(db,'DELETE FROM pod_emails WHERE id = ? AND providerId IS NULL',[id]);
        throw e.status ? e : fail(502,'Email was not confirmed. Your POD is saved; retry with the same address.');
      }
      await run(db,'UPDATE pod_emails SET providerId = ? WHERE id = ?',[providerId,id]);
      audit(req,{action:'SIGNED_POD_EMAIL_ACCEPTED',entityType:'DOCUMENT',entityId:pod.loadId,entityLabel:document.name,newValue:{documentId:document.id,recipient,providerId}});
      res.json({accepted:true,recipient});
    } finally { pending.delete(id); }
  }));
  return router;
}
