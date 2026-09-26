import express from 'express';
import { dbRun } from '../services/dbUtils.js';
import { ensureDriverNotifications } from '../services/driverNotifications.js';
import { pushConfigured } from '../services/driverPushProvider.js';
import { safeStoreUrl } from '../../shared/driverAlerts.js';
export default function createDriverAppRoutes(db, authenticate) {
  const router = express.Router();
  router.get('/release', (req, res) => {
    const platform = req.query.platform;
    const prefix = platform === 'ios' ? 'DRIVER_IOS' : platform === 'android' ? 'DRIVER_ANDROID' : '';
    res.set('Cache-Control', 'no-store').json({ version: prefix ? process.env[`${prefix}_LATEST_VERSION`] || '' : '', storeUrl: prefix ? safeStoreUrl(process.env[`${prefix}_STORE_URL`], platform) : '', pushAvailable: pushConfigured(platform) });
  });
  router.use(authenticate, (req, res, next) => {
    if (req.user?.role !== 'driver' || !req.user.driverId) return res.status(403).json({ error: 'Driver account required.' });
    next();
  });
  router.put('/devices', async (req, res) => {
    const { token, platform } = req.body;
    if (!['ios','android'].includes(platform) || typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[A-Za-z0-9_:\-]+$/.test(token) || (platform === 'ios' && !/^[a-fA-F0-9]+$/.test(token))) return res.status(400).json({ error: 'Invalid notification registration.' });
    if (!pushConfigured(platform)) return res.status(503).json({ error: 'Push notifications are not configured.' });
    try {
      await ensureDriverNotifications(db);
      await dbRun(db, `INSERT INTO driver_push_devices(token,platform,companyId,driverId,updatedAt) VALUES(?,?,?,?,?)
        ON CONFLICT(token) DO UPDATE SET platform=excluded.platform,companyId=excluded.companyId,driverId=excluded.driverId,updatedAt=excluded.updatedAt`, [token, platform, req.company.companyId, req.user.driverId, new Date().toISOString()]);
      res.json({ registered: true });
    } catch { res.status(500).json({ error: 'Unable to register notifications.' }); }
  });
  router.delete('/devices', async (req, res) => {
    try {
      await ensureDriverNotifications(db);
      await dbRun(db, 'DELETE FROM driver_push_devices WHERE token=? AND companyId=? AND driverId=?', [String(req.body.token || ''), req.company.companyId, req.user.driverId]);
      res.json({ removed: true });
    } catch { res.status(500).json({ error: 'Unable to unregister notifications.' }); }
  });
  return router;
}
