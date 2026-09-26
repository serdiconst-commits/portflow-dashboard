import { dbAll, dbGet, dbRun } from './dbUtils.js';
import { DRIVER_ALERT_FIELDS } from '../../shared/driverAlerts.js';
import { pushConfigured, sendDriverPush } from './driverPushProvider.js';
const schemas = new WeakMap();
export function ensureDriverNotifications(db) {
  if (!schemas.has(db)) schemas.set(db, (async () => {
    await dbRun(db, `CREATE TABLE IF NOT EXISTS driver_push_devices(token TEXT PRIMARY KEY, platform TEXT NOT NULL, companyId TEXT NOT NULL, driverId TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS driver_push_queue(id TEXT PRIMARY KEY, auditId TEXT NOT NULL, token TEXT NOT NULL, companyId TEXT NOT NULL, driverId TEXT NOT NULL, attempts INTEGER DEFAULT 0, nextAttempt TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS driver_push_cursor(id INTEGER PRIMARY KEY CHECK(id=1), lastRow INTEGER NOT NULL)`);
    // Activation starts with future events, never with all historical dispatch work.
    await dbRun(db, `INSERT OR IGNORE INTO driver_push_cursor VALUES(1, (SELECT COALESCE(MAX(rowid),0) FROM audit_logs))`);
  })().catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}
const parse = value => { try { return JSON.parse(value || '{}') || {}; } catch { return {}; } };
export function relevantDriverAudit(audit) {
  if (audit.userRole === 'driver' || !['LOAD', 'LOAD_MOVE'].includes(audit.entityType)) return false;
  const fields = Object.keys(parse(audit.changedFields));
  const relevant = [...DRIVER_ALERT_FIELDS, 'driver', 'driverId', 'hookDriver', 'status', 'origin', 'destination', 'moveType', 'isDriverReleased'];
  return fields.some(field => relevant.includes(field)) || /ASSIGN|DISPATCH|CREATE|DELETE/.test(audit.action || '');
}
export async function collectDriverNotifications(db) {
  await ensureDriverNotifications(db);
  const cursor = await dbGet(db, 'SELECT lastRow FROM driver_push_cursor WHERE id=1');
  const audits = await dbAll(db, 'SELECT rowid AS auditRow, * FROM audit_logs WHERE rowid > ? ORDER BY rowid LIMIT 100', [cursor.lastRow]);
  for (const audit of audits) {
    if (Date.parse(audit.createdAt) > Date.now() - 3600000 && relevantDriverAudit(audit)) {
      const old = parse(audit.oldValue), next = parse(audit.newValue);
      const move = audit.entityType === 'LOAD_MOVE' ? await dbGet(db, 'SELECT * FROM load_moves WHERE id=? AND companyId=?', [audit.entityId, audit.companyId]) : null;
      const loadId = move?.loadId || (audit.entityType === 'LOAD' ? audit.entityId : '');
      const load = loadId ? await dbGet(db, 'SELECT * FROM loads WHERE id=? AND companyId=?', [loadId, audit.companyId]) : null;
      const moves = loadId ? await dbAll(db, "SELECT driverId FROM load_moves WHERE loadId=? AND companyId=? AND status NOT IN ('Completed','Cancelled')", [loadId, audit.companyId]) : [];
      const driverIds = new Set([old.driver, next.driver, old.driverId, next.driverId, old.hookDriver, next.hookDriver, load?.driver, load?.hookDriver, move?.driverId, ...moves.map(row => row.driverId)].filter(Boolean).map(value => String(value).trim().toLowerCase()));
      const devices = await dbAll(db, `SELECT p.* FROM driver_push_devices p JOIN drivers d ON d.id=p.driverId AND d.companyId=p.companyId
        WHERE p.companyId=? AND COALESCE(d.isActive,1)=1 AND julianday(p.updatedAt) > julianday('now','-30 days')`, [audit.companyId]);
      for (const device of devices) {
        if (!driverIds.has(device.driverId.toLowerCase())) continue;
        const now = new Date().toISOString();
        await dbRun(db, 'INSERT OR IGNORE INTO driver_push_queue(id,auditId,token,companyId,driverId,nextAttempt,createdAt) VALUES(?,?,?,?,?,?,?)', [`${audit.id}:${device.token}`, audit.id, device.token, device.companyId, device.driverId, now, now]);
      }
    }
    await dbRun(db, 'UPDATE driver_push_cursor SET lastRow=? WHERE id=1', [audit.auditRow]);
  }
}
export async function deliverDriverNotifications(db, send = sendDriverPush, configured = pushConfigured) {
  const rows = await dbAll(db, `SELECT q.*, d.platform FROM driver_push_queue q
    JOIN driver_push_devices d ON d.token=q.token AND d.companyId=q.companyId AND d.driverId=q.driverId
    JOIN drivers r ON r.id=d.driverId AND r.companyId=d.companyId AND COALESCE(r.isActive,1)=1
    WHERE q.nextAttempt<=? AND q.attempts<5 ORDER BY q.createdAt LIMIT 50`, [new Date().toISOString()]);
  for (const row of rows) {
    if (!configured(row.platform)) continue;
    try {
      await send(row, { id: row.auditId });
      await dbRun(db, 'DELETE FROM driver_push_queue WHERE id=?', [row.id]);
    } catch (error) {
      if (error.permanent) {
        await dbRun(db, 'DELETE FROM driver_push_devices WHERE token=? AND companyId=? AND driverId=?', [row.token, row.companyId, row.driverId]);
        await dbRun(db, 'DELETE FROM driver_push_queue WHERE id=?', [row.id]);
      } else {
        const next = new Date(Date.now() + 30000 * 2 ** row.attempts).toISOString();
        await dbRun(db, 'UPDATE driver_push_queue SET attempts=attempts+1,nextAttempt=? WHERE id=?', [next, row.id]);
        console.error('Driver push delivery failed; retry queued.');
      }
    }
  }
  await dbRun(db, "DELETE FROM driver_push_queue WHERE julianday(createdAt) < julianday('now','-1 day') OR attempts>=5 OR NOT EXISTS (SELECT 1 FROM driver_push_devices d WHERE d.token=driver_push_queue.token AND d.companyId=driver_push_queue.companyId AND d.driverId=driver_push_queue.driverId)");
}
export function startDriverNotifications(db) {
  if (process.env.DRIVER_PUSH_ENABLED !== 'true') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await collectDriverNotifications(db); await deliverDriverNotifications(db); }
    catch { console.error('Driver push processing failed; will retry.'); }
    finally { running = false; }
  };
  tick();
  const timer = setInterval(tick, 15000); timer.unref();
  return () => clearInterval(timer);
}
