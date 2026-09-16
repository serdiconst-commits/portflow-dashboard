import jwt from 'jsonwebtoken';
import { dbGet } from './services/dbUtils.js';

export function createAccountAuthenticator(db, secret) {
  return async (req,res,next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({error:'Unauthorized.'});
    let decoded;
    try { decoded = jwt.verify(header.slice(7),secret); }
    catch { return res.status(401).json({error:'Invalid token.'}); }
    try {
      const user = await dbGet(db, `SELECT u.isActive, COALESCE(a.pending,0) AS pending, COALESCE(a.version,0) AS version
        FROM users u LEFT JOIN account_access a ON a.userId=u.id WHERE u.id=?`, [decoded.id]);
      // Legacy tokens have version zero and continue working until this user resets a password.
      if (!user || !user.isActive || user.pending || Number(decoded.accountVersion || 0) !== user.version) {
        return res.status(401).json({error:'Invalid token. Please sign in again.'});
      }
      req.company = decoded;
      req.user = decoded;
      next();
    } catch { res.status(503).json({error:'Unable to validate session. Please try again.'}); }
  };
}
