import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
const customerPacketOrder = [
  'Rate Confirmation',
  'BOL',
  'POD',
  'Out EIR',
  'In EIR',
  'Lumper Receipt',
  'Scale Ticket',
];
const getMimeTypeFromName = (fileName = '') => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
};
const getCompanyLogoUrl = (company = {}) =>
  company.logoPath ? `/api/company-logo/${encodeURIComponent(path.basename(company.logoPath))}` : '';
const portHoustonCredentialKeys = [
  'bayportContainerTracking',
  'bayportAppointmentScheduling',
  'barboursCutContainerTracking',
  'barboursCutAppointmentScheduling',
  'bnsfHouston',
  'upHouston',
];
const parsePortHoustonCredentials = (company = {}) => {
  let parsed = {};
  try {
    parsed = company.portHoustonCredentialsJson ? JSON.parse(company.portHoustonCredentialsJson) : {};
  } catch {
    parsed = {};
  }

  const credentials = portHoustonCredentialKeys.reduce((result, key) => {
    result[key] = {
      username: String(parsed?.[key]?.username || '').trim(),
      password: String(parsed?.[key]?.password || ''),
    };
    return result;
  }, {});

  if (company.portHoustonUsername || company.portHoustonPassword) {
    const legacy = {
      username: company.portHoustonUsername || '',
      password: company.portHoustonPassword || '',
    };
    if (!credentials.bayportContainerTracking.username && !credentials.bayportContainerTracking.password) {
      credentials.bayportContainerTracking = legacy;
    }
    if (!credentials.barboursCutContainerTracking.username && !credentials.barboursCutContainerTracking.password) {
      credentials.barboursCutContainerTracking = legacy;
    }
  }

  return credentials;
};
const getSanitizedPortHoustonCredentials = (company = {}) => {
  const credentials = parsePortHoustonCredentials(company);
  return Object.fromEntries(
    portHoustonCredentialKeys.map((key) => [
      key,
      {
        username: credentials[key]?.username || '',
        configured: Boolean(credentials[key]?.username && credentials[key]?.password),
      },
    ])
  );
};
const getCompanyPayload = (company = {}) => ({
  id: company.id,
  name: company.name,
  email: company.email,
  logoUrl: getCompanyLogoUrl(company),
  portHoustonUsername: company.portHoustonUsername || '',
  portHoustonConfigured: Object.values(getSanitizedPortHoustonCredentials(company)).some((item) => item.configured),
  portHoustonCredentials: getSanitizedPortHoustonCredentials(company),
});
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, initDatabase } from './database.js';
import createInvoiceRoutes from './routes/invoices.js';
import {
  getBolAvailability,
  getContainerAvailability,
  getGateHistory,
} from './integrations/portHouston.js';

const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (!isProduction ? 'portflow-dev-secret-change-before-production' : '');

const app = express();

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
}

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


app.use(express.json());

const PORT = process.env.PORT || 4000;

app.disable('etag');

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || 'development',
  });
});

const normalizeDriverAssignment = (companyId, value, callback) => {
  const raw = String(value || '').trim();
  if (!raw || /^(-+\s*)?(no driver|assign later|select driver)$/i.test(raw)) {
    callback(null, '');
    return;
  }

  const idMatch = raw.match(/\bDRV-\d+\b/i);
  if (idMatch) {
    callback(null, idMatch[0].toUpperCase());
    return;
  }

  const cleaned = raw.replace(/^[^a-z0-9]+/i, '').trim();
  db.get(
    `SELECT id FROM drivers
     WHERE companyId = ?
       AND (
         TRIM(LOWER(id)) = TRIM(LOWER(?))
         OR TRIM(LOWER(name)) = TRIM(LOWER(?))
       )`,
    [companyId, cleaned, cleaned],
    (err, driver) => {
      if (err) {
        callback(err);
        return;
      }

      callback(null, driver?.id || '');
    }
  );
};

const getNextDriverId = (companyId, callback) => {
  db.all(
    `SELECT id
     FROM drivers
     WHERE companyId = ?
       AND id LIKE 'DRV-%'
     ORDER BY id ASC`,
    [companyId],
    (err, rows = []) => {
      if (err) {
        callback(err);
        return;
      }

      const usedNumbers = new Set(
        rows
          .map((row) => String(row.id || '').match(/^DRV-(\d+)$/i)?.[1])
          .filter(Boolean)
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value))
      );

      let nextNumber = 1;
      while (usedNumbers.has(nextNumber)) {
        nextNumber += 1;
      }

      callback(null, `DRV-${String(nextNumber).padStart(3, '0')}`);
    }
  );
};

const attachDocumentsToLoads = (loads, callback) => {
  if (!Array.isArray(loads) || loads.length === 0) {
    callback(null, []);
    return;
  }

  const loadIds = loads.map((load) => load.id);
  const placeholders = loadIds.map(() => '?').join(',');

  db.all(
    `SELECT * FROM documents WHERE loadId IN (${placeholders}) ORDER BY uploadedAt DESC`,
    loadIds,
    (err, documents = []) => {
      if (err) {
        callback(err);
        return;
      }

      const documentsByLoad = documents.reduce((groups, doc) => {
        const normalizedDoc = {
          ...doc,
          url: doc.filePath ? `/uploads/${path.basename(doc.filePath)}` : '',
        };
        groups[doc.loadId] = groups[doc.loadId] || [];
        groups[doc.loadId].push(normalizedDoc);
        return groups;
      }, {});

      callback(
        null,
        loads.map((load) => ({
          ...load,
          documents: documentsByLoad[load.id] || [],
        }))
      );
    }
  );
};

const hasRequiredCompletionDocuments = (documents = []) => {
  const uploaded = new Set(
    documents.map((doc) => String(doc.category || doc.type || '').trim().toUpperCase())
  );
  return ['POD', 'IN EIR', 'OUT EIR'].every((category) => uploaded.has(category));
};

const sensitiveAuditFields = new Set(['password', 'passwordHash', 'token', 'jwt', 'secret']);
const auditLogSafeValue = (value) => {
  if (!value || typeof value !== 'object') return value ?? null;

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !sensitiveAuditFields.has(String(key).trim()))
  );
};

const getChangedFields = (oldValue = {}, newValue = {}) => {
  const oldSafe = auditLogSafeValue(oldValue) || {};
  const newSafe = auditLogSafeValue(newValue) || {};
  const keys = new Set([...Object.keys(oldSafe), ...Object.keys(newSafe)]);
  const changed = {};

  keys.forEach((key) => {
    const before = oldSafe[key] ?? '';
    const after = newSafe[key] ?? '';
    if (String(before) !== String(after)) {
      changed[key] = { oldValue: before, newValue: after };
    }
  });

  return changed;
};

const writeAuditLog = (req, details = {}) => {
  const createdAt = new Date().toISOString();
  const oldValue = auditLogSafeValue(details.oldValue);
  const newValue = auditLogSafeValue(details.newValue);
  const changedFields =
    details.changedFields || getChangedFields(oldValue || {}, newValue || {});

  db.run(
    `INSERT INTO audit_logs (
      id, companyId, userId, userName, userRole, action, entityType, entityId,
      entityLabel, oldValue, newValue, changedFields, ipAddress, userAgent, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      req.company?.companyId || details.companyId || '',
      req.user?.id || '',
      req.user?.name || req.user?.email || '',
      req.user?.role || '',
      details.action,
      details.entityType,
      details.entityId || '',
      details.entityLabel || details.entityId || '',
      JSON.stringify(oldValue ?? null),
      JSON.stringify(newValue ?? null),
      JSON.stringify(changedFields ?? {}),
      req.ip || req.headers['x-forwarded-for'] || '',
      req.headers['user-agent'] || '',
      createdAt,
    ],
    (err) => {
      if (err) {
        console.error('Audit log write failed:', err.message);
      }
    }
  );
};

const insertPortCheckLog = ({
  companyId,
  loadId = '',
  containerNumber = '',
  terminal = '',
  requestType,
  status,
  response,
  checkedByUserId = '',
}) =>
  new Promise((resolve, reject) => {
    const id = uuidv4();
    const checkedAt = new Date().toISOString();
    db.run(
      `INSERT INTO port_check_logs (
        id, companyId, loadId, containerNumber, terminal, provider, requestType,
        status, responseJson, checkedByUserId, checkedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        companyId,
        loadId,
        containerNumber,
        terminal,
        'PORT_HOUSTON',
        requestType,
        status,
        JSON.stringify(response ?? null),
        checkedByUserId,
        checkedAt,
      ],
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({ id, checkedAt });
      }
    );
  });

const getPreferredPortHoustonCredentialKey = (terminal = '') => {
  const normalized = String(terminal || '').toLowerCase();
  if (normalized.includes('barbours') || normalized.includes('barbour')) {
    return 'barboursCutContainerTracking';
  }
  if (normalized.includes('bayport')) {
    return 'bayportContainerTracking';
  }
  return '';
};

const pickPortHoustonCredentials = (credentials = {}, preferredKey = '') => {
  const order = [
    preferredKey,
    'bayportContainerTracking',
    'barboursCutContainerTracking',
    'bayportAppointmentScheduling',
    'barboursCutAppointmentScheduling',
    'bnsfHouston',
    'upHouston',
  ].filter(Boolean);

  const key = order.find(
    (credentialKey) => credentials[credentialKey]?.username && credentials[credentialKey]?.password
  );

  return key ? credentials[key] : {};
};

const getCompanyPortHoustonCredentials = (companyId, terminal = '') =>
  new Promise((resolve, reject) => {
    db.get(
      `SELECT portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson FROM companies WHERE id = ?`,
      [companyId],
      (err, company) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(
          pickPortHoustonCredentials(
            parsePortHoustonCredentials(company || {}),
            getPreferredPortHoustonCredentialKey(terminal)
          )
        );
      }
    );
  });

const getAuditAccessFilter = (role) => {
  const normalizedRole = normalizeRole(role);
  if (adminRoles.has(normalizedRole)) return { clause: '', params: [] };
  if (normalizedRole === 'manager') {
    return {
      clause: ` AND entityType IN ('LOAD', 'DRIVER', 'CUSTOMER', 'INVOICE', 'DOCUMENT')`,
      params: [],
    };
  }
  if (normalizedRole === 'dispatcher') {
    return { clause: ` AND entityType IN ('LOAD', 'DOCUMENT')`, params: [] };
  }
  if (normalizedRole === 'payroll') {
    return { clause: ` AND entityType IN ('INVOICE')`, params: [] };
  }
  return null;
};

/*app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});*/

const seedCarrierUser = async () => {
  const email = 'carrier1@portflow.com';
  const plainPassword = '123456';
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err) {
      console.error('Error checking test carrier user:', err.message);
      return;
    }

    if (!user) {
      db.run(
        `INSERT INTO users (id, companyId, name, email, password, role, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          'COMP-001',
          'Carrier One',
          email,
          hashedPassword,
          'carrier',
          1,
        ],
        (insertErr) => {
          if (insertErr) {
            console.error('Error creating test carrier user:', insertErr.message);
          } else {
            console.log('Test carrier user created:', email);
          }
        }
      );
    } else {
      console.log('Test carrier user already exists:', email);
    }
  });
};

app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(rootDir, process.env.UPLOADS_DIR)
  : path.join(rootDir, 'uploads');
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

initDatabase();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, uniqueName);
  },
});

db.run(`ALTER TABLE loads ADD COLUMN pod TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding pod column:', err.message);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);

    if (allowed.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only PDF, JPG, PNG, and WebP files are allowed.'));
  },
});

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.company = decoded;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token.' });
  }
};

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const adminRoles = new Set(['admin', 'owner', 'carrier']);
const staffRoles = new Set(['dispatcher', 'payroll', 'admin', 'manager']);
const requireRoles = (allowedRoles) => (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (allowedRoles.has(role)) {
    next();
    return;
  }

  res.status(403).json({ error: 'You do not have permission to access this area.' });
};

app.use('/api/invoices', authenticate, createInvoiceRoutes(db));

app.get('/api/company-logo/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const logoPath = path.join(uploadsDir, filename);

  if (!fs.existsSync(logoPath)) {
    return res.status(404).json({ error: 'Logo not found' });
  }

  res.setHeader('Content-Type', getMimeTypeFromName(filename));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.sendFile(path.resolve(logoPath));
});

app.get('/uploads/:filename', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const filename = path.basename(req.params.filename);

  db.get(
    `SELECT d.*
     FROM documents d
     JOIN loads l ON l.id = d.loadId
     WHERE l.companyId = ?
       AND d.filePath LIKE ?`,
    [companyId, `%${filename}`],
    (err, doc) => {
      if (err) {
        console.error('Error checking upload access:', err.message);
        return res.status(500).json({ error: 'Failed to open file' });
      }

      if (!doc || !doc.filePath || !fs.existsSync(doc.filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      return res.sendFile(path.resolve(doc.filePath));
    }
  );
});

app.get('/api/company', authenticate, (req, res) => {
  const companyId = req.company.companyId;

  db.get(
    `SELECT id, name, email, logoPath, portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson FROM companies WHERE id = ?`,
    [companyId],
    (err, company) => {
      if (err) {
        console.error('Company profile lookup error:', err.message);
        return res.status(500).json({ error: 'Failed to load company profile' });
      }

      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      res.json(getCompanyPayload(company));
    }
  );
});

app.put('/api/company/port-houston', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;
  const submittedCredentials = req.body.credentials && typeof req.body.credentials === 'object'
    ? req.body.credentials
    : {
        bayportContainerTracking: {
          username: req.body.username,
          password: req.body.password,
        },
        barboursCutContainerTracking: {
          username: req.body.username,
          password: req.body.password,
        },
      };

  db.get(
    `SELECT portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson FROM companies WHERE id = ?`,
    [companyId],
    (lookupErr, existingCompany) => {
      if (lookupErr) {
        console.error('Port Houston settings lookup error:', lookupErr.message);
        return res.status(500).json({ error: 'Failed to load Port Houston settings.' });
      }

      const existingCredentials = parsePortHoustonCredentials(existingCompany || {});
      const nextCredentials = portHoustonCredentialKeys.reduce((result, key) => {
        const submitted = submittedCredentials[key] || {};
        result[key] = submitted.clear
          ? { username: '', password: '' }
          : {
              username: String(submitted.username ?? existingCredentials[key]?.username ?? '').trim(),
              password: String(submitted.password || existingCredentials[key]?.password || ''),
            };
        return result;
      }, {});

      const primaryCredentials =
        pickPortHoustonCredentials(nextCredentials, 'bayportContainerTracking') ||
        pickPortHoustonCredentials(nextCredentials, 'barboursCutContainerTracking') ||
        {};

      const configuredCount = Object.values(nextCredentials).filter(
        (credential) => credential.username && credential.password
      ).length;

      db.run(
        `UPDATE companies
         SET portHoustonUsername = ?, portHoustonPassword = ?, portHoustonCredentialsJson = ?
         WHERE id = ?`,
        [
          primaryCredentials.username || '',
          primaryCredentials.password || '',
          JSON.stringify(nextCredentials),
          companyId,
        ],
        function (updateErr) {
          if (updateErr) {
            console.error('Port Houston settings update error:', updateErr.message);
            return res.status(500).json({ error: 'Failed to save Port Houston settings.' });
          }

          db.get(
            `SELECT id, name, email, logoPath, portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson FROM companies WHERE id = ?`,
            [companyId],
            (companyErr, company) => {
              if (companyErr || !company) {
                console.error('Port Houston company refresh error:', companyErr?.message);
                return res.status(500).json({ error: 'Settings saved, but profile refresh failed.' });
              }

              writeAuditLog(req, {
                action: 'UPDATE_PORT_HOUSTON_SETTINGS',
                entityType: 'COMPANY',
                entityId: companyId,
                entityLabel: company.name,
                oldValue: null,
                newValue: {
                  configuredCount,
                },
                changedFields: {
                  portHoustonCredentials: {
                    oldValue: '',
                    newValue: `${configuredCount} credential set${configuredCount === 1 ? '' : 's'} saved`,
                  },
                },
              });

              res.json(getCompanyPayload(company));
            }
          );
        }
      );
    }
  );
});

app.post('/api/company/logo', authenticate, upload.single('logo'), (req, res) => {
  const companyId = req.company.companyId;

  if (!req.file) {
    return res.status(400).json({ error: 'Please choose a logo file.' });
  }

  db.run(
    `UPDATE companies SET logoPath = ? WHERE id = ?`,
    [req.file.path, companyId],
    function (err) {
      if (err) {
        console.error('Company logo update error:', err.message);
        return res.status(500).json({ error: 'Failed to save company logo' });
      }

      db.get(
        `SELECT id, name, email, logoPath, portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson FROM companies WHERE id = ?`,
        [companyId],
        (lookupErr, company) => {
          if (lookupErr || !company) {
            console.error('Company logo lookup error:', lookupErr?.message);
            return res.status(500).json({ error: 'Logo saved, but profile refresh failed' });
          }

          res.json(getCompanyPayload(company));
        }
      );
    }
  );
});

app.get('/api/audit-logs', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const access = getAuditAccessFilter(req.user?.role);

  if (!access) {
    return res.status(403).json({ error: 'You do not have permission to view audit logs.' });
  }

  db.all(
    `SELECT * FROM audit_logs
     WHERE companyId = ?${access.clause}
     ORDER BY createdAt DESC
     LIMIT 250`,
    [companyId, ...access.params],
    (err, rows = []) => {
      if (err) {
        console.error('Error fetching audit logs:', err.message);
        return res.status(500).json({ error: 'Failed to fetch audit logs' });
      }

      res.json(rows);
    }
  );
});

app.get('/api/loads/:id/audit-logs', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const loadId = req.params.id;
  const access = getAuditAccessFilter(req.user?.role);

  if (!access || req.user?.role === 'driver') {
    return res.status(403).json({ error: 'You do not have permission to view audit logs.' });
  }

  const loadAuditClause = ` AND entityType IN ('LOAD', 'DOCUMENT') AND entityId = ?`;
  db.all(
    `SELECT * FROM audit_logs
     WHERE companyId = ?${loadAuditClause}${access.clause}
     ORDER BY createdAt DESC
     LIMIT 100`,
    [companyId, loadId, ...access.params],
    (err, rows = []) => {
      if (err) {
        console.error('Error fetching load audit logs:', err.message);
        return res.status(500).json({ error: 'Failed to fetch load audit logs' });
      }

      res.json(rows);
    }
  );
});

app.get('/api/port-houston/container/:containerNumber/availability', authenticate, async (req, res) => {
  const companyId = req.company.companyId;
  const containerNumber = String(req.params.containerNumber || '').trim().toUpperCase();

  if (!containerNumber) {
    return res.status(400).json({ error: 'Container number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId);
    const result = await getContainerAvailability(containerNumber, credentials);
    const log = await insertPortCheckLog({
      companyId,
      containerNumber,
      terminal: result.terminal || '',
      requestType: 'CONTAINER_AVAILABILITY',
      status: 'SUCCESS',
      response: result,
      checkedByUserId: req.user?.id || '',
    });

    res.json({ ...result, checkedBy: req.user?.name || req.user?.email || '', checkedAt: log.checkedAt });
  } catch (error) {
    const status = error.status || 502;
    await insertPortCheckLog({
      companyId,
      containerNumber,
      requestType: 'CONTAINER_AVAILABILITY',
      status: 'ERROR',
      response: { error: error.message, code: error.code, details: error.response },
      checkedByUserId: req.user?.id || '',
    }).catch((logErr) => console.error('Port Houston log error:', logErr.message));
    res.status(status).json({ error: error.message, code: error.code || 'PORT_HOUSTON_ERROR', diagnostics: error.diagnostics });
  }
});

app.get('/api/port-houston/bol/:bolNumber/availability', authenticate, async (req, res) => {
  const companyId = req.company.companyId;
  const bolNumber = String(req.params.bolNumber || '').trim();

  if (!bolNumber) {
    return res.status(400).json({ error: 'Bill of lading number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId);
    const result = await getBolAvailability(bolNumber, credentials);
    const log = await insertPortCheckLog({
      companyId,
      requestType: 'BOL_AVAILABILITY',
      status: 'SUCCESS',
      response: result,
      checkedByUserId: req.user?.id || '',
    });

    res.json({ ...result, checkedBy: req.user?.name || req.user?.email || '', checkedAt: log.checkedAt });
  } catch (error) {
    const status = error.status || 502;
    await insertPortCheckLog({
      companyId,
      requestType: 'BOL_AVAILABILITY',
      status: 'ERROR',
      response: { error: error.message, code: error.code, details: error.response },
      checkedByUserId: req.user?.id || '',
    }).catch((logErr) => console.error('Port Houston log error:', logErr.message));
    res.status(status).json({ error: error.message, code: error.code || 'PORT_HOUSTON_ERROR', diagnostics: error.diagnostics });
  }
});

app.get('/api/port-houston/gate/:containerNumber', authenticate, async (req, res) => {
  const companyId = req.company.companyId;
  const containerNumber = String(req.params.containerNumber || '').trim().toUpperCase();

  if (!containerNumber) {
    return res.status(400).json({ error: 'Container number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId);
    const result = await getGateHistory(containerNumber, credentials);
    const log = await insertPortCheckLog({
      companyId,
      containerNumber,
      requestType: 'GATE_HISTORY',
      status: 'SUCCESS',
      response: result,
      checkedByUserId: req.user?.id || '',
    });

    res.json({ ...result, checkedBy: req.user?.name || req.user?.email || '', checkedAt: log.checkedAt });
  } catch (error) {
    const status = error.status || 502;
    await insertPortCheckLog({
      companyId,
      containerNumber,
      requestType: 'GATE_HISTORY',
      status: 'ERROR',
      response: { error: error.message, code: error.code, details: error.response },
      checkedByUserId: req.user?.id || '',
    }).catch((logErr) => console.error('Port Houston log error:', logErr.message));
    res.status(status).json({ error: error.message, code: error.code || 'PORT_HOUSTON_ERROR', diagnostics: error.diagnostics });
  }
});

app.get('/api/loads/:id/port-houston-check', authenticate, async (req, res) => {
  const companyId = req.company.companyId;
  const loadId = req.params.id;

  try {
    const load = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
        [loadId, companyId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!load) {
      return res.status(404).json({ error: 'Load not found.' });
    }

    const containerNumber = String(load.containerNumber || '').trim().toUpperCase();
    const bolNumber = String(load.referenceNumber || load.poNumber || '').trim();

    if (!containerNumber && !bolNumber) {
      return res.status(400).json({ error: 'Container number or BOL/reference number is required for Port Houston check.' });
    }

    const credentials = await getCompanyPortHoustonCredentials(
      companyId,
      `${load.pickup || ''} ${load.returnLocation || ''}`
    );
    const availability = containerNumber ? await getContainerAvailability(containerNumber, credentials) : null;
    const bolAvailability = bolNumber ? await getBolAvailability(bolNumber, credentials) : null;
    const gate = containerNumber ? await getGateHistory(containerNumber, credentials) : null;
    const response = {
      loadId,
      containerNumber,
      bolNumber,
      availability,
      bolAvailability,
      gate,
      eir: {
        out: null,
        in: null,
        note: 'EIR retrieval requires the exact Port Houston API contract/permission. No scraping is performed.',
      },
    };

    const log = await insertPortCheckLog({
      companyId,
      loadId,
      containerNumber,
      terminal: availability?.terminal || load.pickup || '',
      requestType: 'LOAD_PORT_CHECK',
      status: 'SUCCESS',
      response,
      checkedByUserId: req.user?.id || '',
    });

    writeAuditLog(req, {
      action: 'PORT_HOUSTON_CHECK',
      entityType: 'LOAD',
      entityId: loadId,
      entityLabel: containerNumber || loadId,
      oldValue: null,
      newValue: {
        containerNumber,
        terminal: availability?.terminal || '',
        available: availability?.available ?? null,
        checkedAt: log.checkedAt,
      },
      changedFields: {
        portHoustonCheck: {
          oldValue: '',
          newValue: `${containerNumber || bolNumber} checked at ${log.checkedAt}`,
        },
      },
    });

    res.json({
      ...response,
      checkedBy: req.user?.name || req.user?.email || '',
      checkedAt: log.checkedAt,
    });
  } catch (error) {
    const status = error.status || 502;
    await insertPortCheckLog({
      companyId,
      loadId,
      requestType: 'LOAD_PORT_CHECK',
      status: 'ERROR',
      response: { error: error.message, code: error.code, details: error.response },
      checkedByUserId: req.user?.id || '',
    }).catch((logErr) => console.error('Port Houston log error:', logErr.message));
    res.status(status).json({ error: error.message, code: error.code || 'PORT_HOUSTON_ERROR', diagnostics: error.diagnostics });
  }
});

app.get('/api/customers', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  console.log('CUSTOMER ROUTE companyId:', companyId);

  db.all(
    `SELECT id, name, companyId
     FROM customers
     ORDER BY name ASC`,
    [],
    (err, allRows) => {
      if (err) {
        console.error('Error fetching all customers for debug:', err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log('ALL CUSTOMERS IN DB:', allRows);

      db.all(
        `SELECT * FROM customers WHERE companyId = ? ORDER BY name ASC`,
        [companyId],
        (err, rows) => {
          if (err) {
            console.error('Error fetching customers:', err.message);
            return res.status(500).json({ error: err.message });
          }

          console.log('FILTERED CUSTOMERS:', rows);
          res.json(rows);
        }
      );
    }
  );
});
app.delete('/api/customers/:id', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const { id } = req.params;

  db.run(
    `DELETE FROM customers
     WHERE id = ? AND companyId = ?`,
    [id, companyId],
    function (err) {
      if (err) {
        console.error('Error deleting customer:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      res.json({ success: true, changes: this.changes });
    }
  );
});

app.put('/api/users/:id/status', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;
  const { id } = req.params;
  const { isActive } = req.body;

  db.run(
    `UPDATE users
     SET isActive = ?
     WHERE id = ? AND companyId = ?`,
    [isActive ? 1 : 0, id, companyId],
    function (err) {
      if (err) {
        console.error('Error updating user status:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true, changes: this.changes });
    }
  );
});
app.put('/api/users/:id/role', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;
  const { id } = req.params;
  const { role } = req.body;

  const normalizedRole = normalizeRole(role);

  if (!staffRoles.has(normalizedRole)) {
    return res.status(400).json({ error: 'Choose Dispatcher, Payroll, Admin, or Manager for staff users.' });
  }

  db.run(
    `UPDATE users
     SET role = ?
     WHERE id = ? AND companyId = ? AND role != 'driver'`,
    [normalizedRole, id, companyId],
    function (err) {
      if (err) {
        console.error('Error updating user role:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true });
    }
  );
});

app.post('/api/staff-users', authenticate, requireRoles(adminRoles), async (req, res) => {
  const companyId = req.company.companyId;
  const { name, email, password, role = 'dispatcher', isActive = true } = req.body;
  const normalizedRole = normalizeRole(role);

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and temporary password are required' });
  }

  if (!staffRoles.has(normalizedRole)) {
    return res.status(400).json({ error: 'Choose Dispatcher, Payroll, Admin, or Manager.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = `USR-${Date.now()}`;

    db.run(
      `INSERT INTO users (id, companyId, name, email, password, role, isActive, driverId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, companyId, name, email, hashedPassword, normalizedRole, isActive ? 1 : 0, null],
      function (err) {
        if (err) {
          console.error('Error creating staff user:', err.message);
          const duplicateEmail = err.message && err.message.includes('UNIQUE constraint failed');
          return res.status(duplicateEmail ? 400 : 500).json({
            error: duplicateEmail ? 'That email is already used by another user.' : err.message,
          });
        }

        res.json({
          success: true,
          user: {
            id,
            name,
            email,
            role: normalizedRole,
            companyId,
            isActive: isActive ? 1 : 0,
          },
        });
      }
    );
  } catch (error) {
    console.error('Create staff user error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', authenticate, async (req, res) => {
  const companyId = req.company.companyId;

  const { name, email, password, role, truck = '', phone = '', isActive = 1 } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const id = `USR-${Date.now()}`;
    const userRole = role || 'driver';
    const finishCreateUser = (driverId = null) => {

    db.run(
      `INSERT INTO users (id, companyId, name, email, password, role, isActive, driverId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, companyId, name, email, hashedPassword, userRole, isActive ? 1 : 0, driverId],
      function (err) {
        if (err) {
          console.error('Error creating user:', err.message);
          return res.status(500).json({ error: err.message });
        }

        const sendResponse = () => {
          res.json({
            success: true,
            user: {
              id,
              name,
              email,
              role: userRole,
              companyId,
              driverId,
            },
          });
        };

        if (userRole !== 'driver') {
          sendResponse();
          return;
        }

        db.run(
          `INSERT INTO drivers (id, name, email, password, truck, phone, companyId, isActive)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [driverId, name, email, hashedPassword, truck, phone, companyId, isActive ? 1 : 0],
          (driverErr) => {
            if (driverErr) {
              console.error('Error creating linked driver profile:', driverErr.message);
              return res.status(500).json({ error: driverErr.message });
            }

            sendResponse();
          }
        );
      }
    );
    };

    if (userRole === 'driver') {
      getNextDriverId(companyId, (idErr, nextDriverId) => {
        if (idErr) {
          console.error('Error generating driver ID:', idErr.message);
          return res.status(500).json({ error: idErr.message });
        }

        finishCreateUser(nextDriverId);
      });
      return;
    }

    finishCreateUser(null);
  } catch (error) {
    console.error('Create user error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

 app.get('/api/users', authenticate, (req, res) => {
  const companyId = req.company.companyId;

  db.all(
    `SELECT id, name, email, role, isActive
     FROM users
     WHERE companyId = ? AND role = 'driver' AND isActive = 1
     ORDER BY name ASC`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching drivers:', err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log('DRIVERS FOR COMPANY:', companyId, rows);
      res.json(rows);
    }
  );
});
app.get('/api/all-users', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;

  db.all(
    `SELECT id, name, email, role, isActive
     FROM users
     WHERE companyId = ?
     ORDER BY role ASC, name ASC`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching all users:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json(rows);
    }
  );
});
app.get('/api/locations', authenticate, (req, res) => {
  const companyId = req.company.companyId;

  db.all(
    `SELECT * FROM locations WHERE companyId = ? ORDER BY name ASC`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching locations:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json(rows);
    }
  );
});

app.post('/api/locations', authenticate, (req, res) => {
  const companyId = req.company.companyId;

  const {
    name,
    address,
    city,
    state,
    zip,
    type,
    customerId,
    notes
  } = req.body;

  const id = `LOC-${Date.now()}`;

  db.run(
    `INSERT INTO locations (
      id,
      name,
      address,
      city,
      state,
      zip,
      type,
      customerId,
      notes,
      companyId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      address || '',
      city || '',
      state || '',
      zip || '',
      type || '',
      customerId || '',
      notes || '',
      companyId
    ],
    function (err) {
      if (err) {
        console.error('Error creating location:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json({ success: true, id });
    }
  );
});


app.put('/api/locations/:id', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const { id } = req.params;

  const {
    name,
    address,
    city,
    state,
    zip,
    type,
    customerId,
    notes
  } = req.body;

  db.run(
    `UPDATE locations
     SET name = ?,
         address = ?,
         city = ?,
         state = ?,
         zip = ?,
         type = ?,
         customerId = ?,
         notes = ?
     WHERE id = ? AND companyId = ?`,
    [
      name,
      address || '',
      city || '',
      state || '',
      zip || '',
      type || '',
      customerId || '',
      notes || '',
      id,
      companyId
    ],
    function (err) {
      if (err) {
        console.error('Error updating location:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Location not found' });
      }

      res.json({ success: true, changes: this.changes });
    }
  );
});

app.delete('/api/locations/:id', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const { id } = req.params;

  db.run(
    `DELETE FROM locations
     WHERE id = ? AND companyId = ?`,
    [id, companyId],
    function (err) {
      if (err) {
        console.error('Error deleting location:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Location not found' });
      }

      res.json({ success: true, changes: this.changes });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get(
    `SELECT * FROM users WHERE email = ? AND isActive = 1`,
    [email],
    async (err, user) => {
      if (err) {
        console.error('Login error:', err.message);
        return res.status(500).json({ error: 'Server error during login' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
          {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            companyId: user.companyId || null,
            driverId: user.driverId || null,
          },
          JWT_SECRET,
          { expiresIn: user.role === 'driver' ? '30d' : '7d' }
        );

        db.get(
          `SELECT id, name, email, logoPath, portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson FROM companies WHERE id = ?`,
          [user.companyId],
          (companyErr, company) => {
            if (companyErr) {
              console.error('Login company lookup error:', companyErr.message);
            }

            res.json({
              token,
              user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                companyId: user.companyId || null,
                driverId: user.driverId || null,
              },
              company: company ? getCompanyPayload(company) : null,
            });
          }
        );
      } catch (error) {
        console.error('Password compare error:', error.message);
        res.status(500).json({ error: 'Server error during login' });
      }
    }
  );
});

app.get('/api/create-test-driver', async (req, res) => {
  if (isProduction) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const hashedPassword = await bcrypt.hash('1234', 10);

    db.run(
      `INSERT OR REPLACE INTO users (
        id, name, email, password, role, companyId, isActive, driverId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'USR-DRV-001',
        'Juan Driver',
        'juan@portflow.com',
        hashedPassword,
        'driver',
        'COMP-001',
        1,
        'DRV-001',
      ],
      function (err) {
        if (err) {
          console.error('Create test driver error:', err.message);
          return res.status(500).json({ error: err.message });
        }

        res.json({ message: 'Test driver created successfully' });
      }
    );
  } catch (error) {
    console.error('Hash error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


app.put('/api/customers/:id', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const { id } = req.params;

  const {
    name,
    contactName,
    email,
    phone,
    address,
    city,
    state,
    zip,
    notes
  } = req.body;

  db.run(
    `UPDATE customers
     SET name = ?,
         contactName = ?,
         email = ?,
         phone = ?,
         address = ?,
         city = ?,
         state = ?,
         zip = ?,
         notes = ?
     WHERE id = ? AND companyId = ?`,
    [
      name,
      contactName,
      email,
      phone,
      address,
      city,
      state,
      zip,
      notes,
      id,
      companyId
    ],
    function (err) {
      if (err) {
        console.error('Error updating customer:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      res.json({ success: true, changes: this.changes });
    }
  );
});
app.post('/api/customers', authenticate, (req, res) => {
  const companyId = req.company.companyId;
console.log('POST /api/customers companyId:', companyId);
console.log('POST /api/customers body:', req.body);
  const {
    name,
    contactName,
    email,
    phone,
    address,
    city,
    state,
    zip,
    notes
  } = req.body;

  const id = `CUST-${Date.now()}`;

  db.run(
    `INSERT INTO customers (
      id,
      name,
      contactName,
      email,
      phone,
      address,
      city,
      state,
      zip,
      notes,
      companyId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      contactName,
      email,
      phone,
      address,
      city,
      state,
      zip,
      notes,
      companyId
    ],
    function (err) {
      if (err) {
        console.error('Error creating customer:', err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log('Customer created successfully:', id);

      res.json({ success: true, id });
    }
  );
});
app.put('/api/loads/:id', authenticate, (req, res) => {
  const body = req.body || {};
  const l = body;
  const loadId = String(req.params.id || '').trim();
  const companyId = req.company.companyId;

  console.log('UPDATE REQUEST loadId =', loadId);
  console.log('UPDATE BODY id =', body.id);
  console.log('DATABASE FILE CHECK');

  db.get(
    `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
    [loadId, companyId],
    (findErr, existingLoad) => {
      if (findErr) {
        console.error('Error finding load before update:', findErr.message);
        return res.status(500).json({ error: findErr.message });
      }

      console.log('LOAD FOUND BEFORE UPDATE =', existingLoad);

      if (!existingLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }

      normalizeDriverAssignment(companyId, l.driver, (driverErr, normalizedDriver) => {
        if (driverErr) {
          console.error('Error normalizing driver:', driverErr.message);
          return res.status(500).json({ error: driverErr.message });
        }

        normalizeDriverAssignment(companyId, l.droppedBy, (droppedByErr, normalizedDroppedBy) => {
          if (droppedByErr) {
            console.error('Error normalizing droppedBy:', droppedByErr.message);
            return res.status(500).json({ error: droppedByErr.message });
          }

      db.run(
        `UPDATE loads SET
          loadDate = ?,
          customer = ?,
          referenceNumber = ?,
          poNumber = ?,
          reservationNumber = ?,
          returnNumber = ?,
          pod = ?,
          driver = ?,
          truck = ?,
          pickup = ?,
          delivery = ?,
          appointmentTime = ?,
          eta = ?,
          returnLocation = ?,
          dropType = ?,
          dropLocation = ?,
          droppedBy = ?,
          dropDateTime = ?,
          containerNumber = ?,
          bookingNumber = ?,
          shipLine = ?,
          chassisNumber = ?,
          sealNumber = ?,
          containerSize = ?,
          rate = ?,
          driverRate = ?,
          status = ?,
          availabilityStatus = ?,
          paperwork = ?,
          detention = ?,
          lumper = ?,
          fuelAdvance = ?,
          settlement = ?,
          notes = ?,
          lastFreeDay = ?
         WHERE id = ? AND companyId = ?`,
        [
          l.loadDate || '',
          l.customer || '',
          l.referenceNumber || '',
          l.poNumber || '',
          l.reservationNumber || '',
          l.returnNumber || '',
          l.pod || '',
          normalizedDriver,
          l.truck || '',
          l.pickup || '',
          l.delivery || '',
          l.appointmentTime || '',
          l.eta || '',
          l.returnLocation || '',
          l.dropType || '',
          l.dropLocation || '',
          normalizedDroppedBy,
          l.dropDateTime || '',
          l.containerNumber || '',
          l.bookingNumber || '',
          l.shipLine || '',
          l.chassisNumber || '',
          l.sealNumber || '',
          l.containerSize || '',
          l.rate || 0,
          l.driverRate || 0,
          l.status || 'Pending',
          l.availabilityStatus ?? '',
          l.paperwork || '',
          l.detention || 0,
          l.lumper || 0,
          l.fuelAdvance || 0,
          l.settlement || 0,
          l.notes || '',
          body.lastFreeDay || '',
          loadId,
          companyId,
        ],
        function (err) {
          if (err) {
            console.error('Error updating load:', err.message);
            return res.status(500).json({ error: err.message });
          }

          console.log('UPDATE changes =', this.changes);

          db.get(
            `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
            [loadId, companyId],
            (readErr, updatedLoad) => {
              if (readErr) {
                console.error('Error reading updated load:', readErr.message);
                return res.status(500).json({ error: readErr.message });
              }

console.log('UPDATE changes =', this.changes);
console.log('LOAD AFTER UPDATE =', updatedLoad);

              const changedFields = getChangedFields(existingLoad, updatedLoad);
              if (Object.keys(changedFields).length > 0) {
                writeAuditLog(req, {
                  action: 'UPDATE',
                  entityType: 'LOAD',
                  entityId: loadId,
                  entityLabel: loadId,
                  oldValue: Object.fromEntries(
                    Object.keys(changedFields).map((field) => [field, existingLoad[field]])
                  ),
                  newValue: Object.fromEntries(
                    Object.keys(changedFields).map((field) => [field, updatedLoad[field]])
                  ),
                  changedFields,
                });
              }

              res.json(updatedLoad);
            }
          );
        }
      );
        });
      });
    }
  );
});
app.get('/api/loads', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const role = String(req.user?.role || '').trim().toLowerCase();
  const driverId = String(req.user?.driverId || '').trim();

  if (role === 'driver') {
    db.all(
      `SELECT * FROM loads
       WHERE companyId = ?
       AND TRIM(LOWER(driver)) = TRIM(LOWER(?))`,
      [companyId, driverId],
      (err, rows) => {
      if (err) {
        console.error('Error loading driver loads:', err.message);
        return res.status(500).json({ error: err.message });
      }
        attachDocumentsToLoads(rows, (docsErr, loadsWithDocuments) => {
          if (docsErr) {
            console.error('Error loading driver documents:', docsErr.message);
            return res.status(500).json({ error: docsErr.message });
          }

          res.json(loadsWithDocuments);
        });
      }
    );
    return;
  }

  db.all(
    `SELECT * FROM loads WHERE companyId = ?`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error('Error loading loads:', err.message);
        return res.status(500).json({ error: err.message });
      }
      attachDocumentsToLoads(rows, (docsErr, loadsWithDocuments) => {
        if (docsErr) {
          console.error('Error loading documents:', docsErr.message);
          return res.status(500).json({ error: docsErr.message });
        }

        res.json(loadsWithDocuments);
      });
    }
  );
});

app.get('/api/drivers', authenticate, (req, res) => {
  const companyId = req.company.companyId;

  db.all(
    `SELECT *
     FROM drivers
     WHERE companyId = ?
     ORDER BY name ASC`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching drivers:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json(rows);
    }
  );
});

app.post('/api/drivers', authenticate, async (req, res) => {
  const companyId = req.company.companyId;

  const {
    id,
    name,
    email,
    password,
    truck = '',
    phone = '',
    isActive = 1,
  } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Driver name, email, and password are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const createDriver = (driverId, allowRetry = false, attempt = 0) => {
    // 1. Insert into drivers table
    db.run(
      `INSERT INTO drivers (id, name, email, password, truck, phone, companyId, isActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [driverId, name, email, hashedPassword, truck, phone, companyId, isActive ? 1 : 0],
      function (err) {
        if (err) {
          console.error('Error creating driver:', err.message);
          if (
            allowRetry &&
            attempt < 25 &&
            String(err.message || '').includes('UNIQUE constraint failed: drivers.id')
          ) {
            getNextDriverId(companyId, (nextErr, nextDriverId) => {
              if (nextErr) {
                console.error('Error retrying driver ID generation:', nextErr.message);
                return res.status(500).json({ error: nextErr.message });
              }

              if (nextDriverId === driverId) {
                const fallbackNumber = String(Date.now()).slice(-6);
                createDriver(`DRV-${fallbackNumber}`, true, attempt + 1);
                return;
              }

              createDriver(nextDriverId, true, attempt + 1);
            });
            return;
          }

          return res.status(500).json({ error: err.message });
        }

        // 2. ALSO insert into users table (this is VERY important)
        db.run(
          `INSERT OR REPLACE INTO users (
            id, name, email, password, role, companyId, isActive, driverId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `USR-${driverId}`,
            name,
            email,
            hashedPassword,
            'driver',
            companyId,
            isActive ? 1 : 0,
            driverId,
          ],
          (userErr) => {
            if (userErr) {
              console.error('Error creating driver user:', userErr.message);
              return res.status(500).json({ error: userErr.message });
            }

            res.json({
              success: true,
              message: 'Driver created',
              driver: {
                id: driverId,
                name,
                email,
                truck,
                phone,
                companyId,
                isActive: isActive ? 1 : 0,
              },
            });
          }
        );
      }
    );
  };

  if (id) {
    createDriver(String(id).trim().toUpperCase(), false);
    return;
  }

  getNextDriverId(companyId, (err, nextDriverId) => {
    if (err) {
      console.error('Error generating driver ID:', err.message);
      return res.status(500).json({ error: err.message });
    }

    createDriver(nextDriverId, true);
  });
});

app.post('/api/loads', authenticate, (req, res) => {
  const l = req.body || {};
  const companyId = req.company.companyId;

  db.get(
    `SELECT value FROM counters WHERE name = 'load'`,
    [],
    (counterErr, counterRow) => {
      if (counterErr) {
        console.error('Error reading load counter:', counterErr.message);
        return res.status(500).json({ error: counterErr.message });
      }

      const nextNumber = (counterRow?.value || 0) + 1;
      const generatedLoadId = `LD-${String(nextNumber).padStart(4, '0')}`;

      db.run(
        `UPDATE counters SET value = ? WHERE name = 'load'`,
        [nextNumber],
        (updateErr) => {
          if (updateErr) {
            console.error('Error updating load counter:', updateErr.message);
            return res.status(500).json({ error: updateErr.message });
          }

          normalizeDriverAssignment(companyId, l.driver, (driverErr, normalizedDriver) => {
            if (driverErr) {
              console.error('Error normalizing driver:', driverErr.message);
              return res.status(500).json({ error: driverErr.message });
            }

            normalizeDriverAssignment(companyId, l.droppedBy, (droppedByErr, normalizedDroppedBy) => {
              if (droppedByErr) {
                console.error('Error normalizing droppedBy:', droppedByErr.message);
                return res.status(500).json({ error: droppedByErr.message });
              }

          db.run(
            `INSERT INTO loads (
              id,
              loadDate,
              customer,
              referenceNumber,
              poNumber,
              returnNumber,
              reservationNumber,
              driver,
              truck,
              pickup,
              delivery,
              appointmentTime,
              eta,
              returnLocation,
              dropType,
dropLocation,
droppedBy,
dropDateTime,
              containerNumber,
              bookingNumber,
              shipLine,
              chassisNumber,
              sealNumber,
              containerSize,
              rate,
              driverRate,
              status,
              availabilityStatus,
              paperwork,
              detention,
              lumper,
              fuelAdvance,
              settlement,
              notes,
              companyId,
              lastFreeDay,
              carrierId
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              generatedLoadId,
              l.loadDate || new Date().toISOString().slice(0, 10),
              l.customer || '',
              l.referenceNumber || '',
              l.poNumber || '',
              l.returnNumber || '',
              l.reservationNumber || '',
              normalizedDriver,
              l.truck || '',
              l.pickup || '',
              l.delivery || '',
              l.appointmentTime || '',
              l.eta || '',
              l.returnLocation || '',
              l.dropType || '',
              l.dropLocation || '',
              normalizedDroppedBy,
              l.dropDateTime || '',
              l.containerNumber || '',
              l.bookingNumber || '',
              l.shipLine || '',
              l.chassisNumber || '',
              l.sealNumber || '',
              l.containerSize || '',
              l.rate || 0,
              l.driverRate || 0,
              l.status || 'Pending',
              l.availabilityStatus || '',
              l.paperwork || '',
              l.detention || 0,
              l.lumper || 0,
              l.fuelAdvance || 0,
              l.settlement || 0,
              l.notes || '',
              companyId,
              l.lastFreeDay || '',
              l.carrierId || ''
            ],
            function (err) {
              if (err) {
                console.error('Error creating load:', err.message);
                return res.status(500).json({ error: err.message });
              }

              db.get(
                `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
                [generatedLoadId, companyId],
                (getErr, row) => {
                  if (getErr) {
                    console.error('Error fetching new load:', getErr.message);
                    return res.status(500).json({ error: getErr.message });
                  }

                  writeAuditLog(req, {
                    action: 'CREATE',
                    entityType: 'LOAD',
                    entityId: generatedLoadId,
                    entityLabel: generatedLoadId,
                    oldValue: null,
                    newValue: row,
                    changedFields: Object.fromEntries(
                      Object.entries(auditLogSafeValue(row) || {}).map(([field, value]) => [
                        field,
                        { oldValue: '', newValue: value },
                      ])
                    ),
                  });

                  res.json(row);
                }
              );
            }
          );
            });
          });
        }
      );
    }
  );
});


app.get('/api/loads/:id/customer-packet', authenticate, (req, res) => {
  const loadId = req.params.id;
  const companyId = req.company.companyId;

  db.get(`SELECT * FROM loads WHERE id = ? AND companyId = ?`, [loadId, companyId], (loadErr, loadRow) => {
    if (loadErr) {
      console.error('Error fetching load for packet:', loadErr.message);
      return res.status(500).json({ error: 'Failed to fetch load', details: loadErr.message });
    }

    if (!loadRow) {
      return res.status(404).json({ error: 'Load not found' });
    }

    db.all(
      `SELECT * FROM documents WHERE loadId = ?`,
      [loadId],
      async (err, docs) => {
        if (err) {
          console.error('Error loading documents for packet:', err.message);
          return res.status(500).json({
            error: 'Failed to load documents',
            details: err.message,
          });
        }

        try {
          const orderedDocs = customerPacketOrder
            .map((category) => docs.find((doc) => doc.category === category))
            .filter(Boolean);

          if (!orderedDocs.length) {
            return res.status(404).json({
              error: 'No packet documents found for this load',
            });
          }

          const mergedPdf = await PDFDocument.create();

          const invoicePdf = await PDFDocument.create();
          const invoicePage = invoicePdf.addPage([612, 792]);
          // Top divider
          invoicePage.drawLine({
            start: { x: 50, y: 675 },
            end: { x: 560, y: 675 },
            thickness: 1,
          });

          invoicePage.drawText('PORTFLOW DISPATCH', {
            x: 50,
            y: 760,
            size: 18,
          });

          invoicePage.drawText('INVOICE', {
            x: 50,
            y: 730,
            size: 28,
          });

          invoicePage.drawText(`Invoice Date: ${loadRow.loadDate || '—'}`, {
            x: 400,
            y: 730,
            size: 12,
          });

          invoicePage.drawText(`Load ID: ${loadRow.id || '—'}`, {
            x: 400,
            y: 710,
            size: 12,
          });

          invoicePage.drawText(`Reference #: ${loadRow.referenceNumber || '—'}`, {
            x: 400,
            y: 690,
            size: 12,
          });

          invoicePage.drawText('Bill To:', {
            x: 50,
            y: 680,
            size: 14,
          });

          invoicePage.drawText(`${loadRow.customer || '—'}`, {
            x: 50,
            y: 660,
            size: 12,
          });

          invoicePage.drawText('Load Information:', {
            x: 50,
            y: 620,
            size: 14,
          });
          invoicePage.drawLine({
            start: { x: 50, y: 520 },
            end: { x: 560, y: 520 },
            thickness: 1,
          });

          invoicePage.drawText(`Pickup: ${loadRow.pickup || '—'}`, {
            x: 50,
            y: 600,
            size: 12,
          });

          invoicePage.drawText(`Delivery: ${loadRow.delivery || '—'}`, {
            x: 50,
            y: 580,
            size: 12,
          });

          invoicePage.drawText(`Return: ${loadRow.returnLocation || '—'}`, {
            x: 50,
            y: 560,
            size: 12,
          });

          invoicePage.drawText(`Container: ${loadRow.containerNumber || '—'}`, {
            x: 50,
            y: 540,
            size: 12,
          });
          invoicePage.drawText('Charges', {
            x: 50,
            y: 480,
            size: 14,
          });

          invoicePage.drawText('Description', {
            x: 50,
            y: 460,
            size: 12,
          });

          invoicePage.drawText('Amount', {
            x: 450,
            y: 460,
            size: 12,
          });

          const formatMoney = (value) => {
            const number = Number(value || 0);
            return `$${number.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          };

          invoicePage.drawText(formatMoney(loadRow.rate), {
            x: 450,
            y: 440,
            size: 12,
          });

          invoicePage.drawLine({
            start: { x: 50, y: 420 },
            end: { x: 560, y: 420 },
            thickness: 1,
          });

          invoicePage.drawText('Total:', {
            x: 350,
            y: 400,
            size: 14,
          });

          invoicePage.drawText(formatMoney(loadRow.rate), {
            x: 450,
            y: 400,
            size: 14,
          });

          invoicePage.drawText(`Notes: ${loadRow.notes || 'No additional notes.'}`, {
            x: 50,
            y: 360,
            size: 12,
          });
          const invoiceBytes = await invoicePdf.save();
          const loadedInvoicePdf = await PDFDocument.load(invoiceBytes);
          const invoicePages = await mergedPdf.copyPages(
            loadedInvoicePdf,
            loadedInvoicePdf.getPageIndices()
          );
          invoicePages.forEach((page) => mergedPdf.addPage(page));

          for (const doc of orderedDocs) {
            const absolutePath = path.isAbsolute(doc.filePath)
              ? doc.filePath
              : path.join(__dirname, doc.filePath);

            const fileBytes = fs.readFileSync(absolutePath);
            const mimeType = getMimeTypeFromName(doc.name || doc.filePath || '');

            if (mimeType === 'application/pdf') {
              const sourcePdf = await PDFDocument.load(fileBytes);
              const copiedPages = await mergedPdf.copyPages(
                sourcePdf,
                sourcePdf.getPageIndices()
              );
              copiedPages.forEach((page) => mergedPdf.addPage(page));
            } else if (mimeType === 'image/jpeg') {
              const image = await mergedPdf.embedJpg(fileBytes);
              const page = mergedPdf.addPage([image.width, image.height]);
              page.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
              });
            } else if (mimeType === 'image/png') {
              const image = await mergedPdf.embedPng(fileBytes);
              const page = mergedPdf.addPage([image.width, image.height]);
              page.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
              });
            }
          }

          const pdfBytes = await mergedPdf.save();

          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader(
            'Content-Disposition',
            `inline; filename="${loadId}-customer-packet.pdf"`
          );

          return res.send(Buffer.from(pdfBytes));
        } catch (packetErr) {
          console.error('Error generating customer packet PDF:', packetErr.message);
          return res.status(500).json({
            error: 'Failed to generate customer packet PDF',
            details: packetErr.message,
          });
        }
      }
    );
  });
});

app.post('/api/loads/:id/documents', authenticate, upload.array('files'), async (req, res) => {
  const files = req.files || [];
  const category = req.body.category || 'Other';
  const loadId = req.params.id;
  const companyId = req.company.companyId;

  if (!files.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const loadRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, containerNumber FROM loads WHERE id = ? AND companyId = ?`,
        [loadId, companyId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!loadRow) {
      return res.status(404).json({ error: 'Load not found' });
    }

    const docs = [];

    for (const f of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      let savedPath = f.path;
      let savedName = f.originalname;
      let savedMimeType = f.mimetype || 'Unknown';

      const isImage =
        savedMimeType.startsWith('image/') ||
        /\.(jpg|jpeg|png|webp)$/i.test(f.originalname);

      // 👉 CONVERT IMAGE TO PDF
      if (isImage) {
        const pdfDoc = await PDFDocument.create();

        let imageBuffer;
        try {
          imageBuffer = await sharp(f.path)
            .rotate()
            .trim({ threshold: 18 })
            .resize({ width: 1700, height: 2200, fit: 'inside', withoutEnlargement: true })
            .grayscale()
            .normalize()
            .sharpen()
            .jpeg({ quality: 90 })
            .toBuffer();
        } catch (scanErr) {
          console.error('Document scan cleanup failed, using original image:', scanErr.message);
          imageBuffer = await sharp(f.path)
            .rotate()
            .resize({ width: 1700, height: 2200, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();
        }
        const jpgImage = await pdfDoc.embedJpg(imageBuffer);

        const jpgDims = jpgImage.scale(1);

        const page = pdfDoc.addPage([jpgDims.width, jpgDims.height]);
        page.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: jpgDims.width,
          height: jpgDims.height,
        });

        const pdfBytes = await pdfDoc.save();

        const pdfPath = f.path.replace(/\.[^.]+$/, '.pdf');
        fs.writeFileSync(pdfPath, pdfBytes);

        // delete original image
        if (fs.existsSync(f.path)) {
          fs.unlinkSync(f.path);
        }

        savedPath = pdfPath;
        savedName = f.originalname.replace(/\.[^.]+$/, '.pdf');
        savedMimeType = 'application/pdf';
      }

      db.run(
        `INSERT INTO documents (id, loadId, name, size, type, category, filePath, uploadedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          loadId,
          savedName,
          `${(fs.statSync(savedPath).size / 1024).toFixed(1)} KB`,
          savedMimeType,
          category,
          savedPath,
          new Date().toISOString(),
        ],
        (err) => {
          if (err) {
            console.error('Error saving document record:', err.message);
          }
        }
      );
      docs.push({
        id,
        name: savedName,
        size: `${(fs.statSync(savedPath).size / 1024).toFixed(1)} KB`,
        type: savedMimeType,
        category,
        url: `/uploads/${path.basename(savedPath)}`,
      });
    }

    writeAuditLog(req, {
      action: 'DOCUMENT_UPLOAD',
      entityType: 'DOCUMENT',
      entityId: loadId,
      entityLabel: loadRow.containerNumber || loadId,
      oldValue: null,
      newValue: {
        loadId,
        category,
        documents: docs.map((doc) => ({
          id: doc.id,
          name: doc.name,
          size: doc.size,
          type: doc.type,
          category: doc.category,
        })),
      },
      changedFields: {
        documents: { oldValue: '', newValue: docs.map((doc) => doc.name).join(', ') },
      },
    });

    res.json(docs);
  } catch (error) {
    console.error('Error uploading documents:', error.message);
    res.status(500).json({ error: 'Failed to upload documents' });
  }
});

app.put('/api/documents/:id', authenticate, (req, res) => {
  const { category } = req.body;
  const companyId = req.company.companyId;

  db.run(
    `UPDATE documents
     SET category = ?
     WHERE id = ?
       AND loadId IN (SELECT id FROM loads WHERE companyId = ?)`,
    [category, req.params.id, companyId],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to update document' });
      if (this.changes === 0) return res.status(404).json({ error: 'Document not found' });
      res.json({ success: true });
    }
  );
});

app.get('/api/documents/:id/file', authenticate, (req, res) => {
  const docId = req.params.id;
  const companyId = req.company.companyId;

  db.get(
    `SELECT d.*
     FROM documents d
     JOIN loads l ON l.id = d.loadId
     WHERE d.id = ? AND l.companyId = ?`,
    [docId, companyId],
    (err, doc) => {
      if (err) {
        console.error('Error fetching document file:', err.message);
        return res.status(500).json({ error: 'Failed to fetch document' });
      }

      if (!doc || !doc.filePath) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const absolutePath = path.isAbsolute(doc.filePath)
        ? doc.filePath
        : path.resolve(rootDir, doc.filePath);

      if (!fs.existsSync(absolutePath)) {
        console.error('Document file missing on disk:', absolutePath);
        return res.status(404).json({ error: 'Document file missing' });
      }

      res.setHeader('Content-Type', doc.type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${String(doc.name || 'document').replace(/"/g, '')}"`
      );
      return res.sendFile(absolutePath);
    }
  );
});

app.delete('/api/documents/:id', authenticate, (req, res) => {
  const docId = req.params.id;
  const companyId = req.company.companyId;

  db.get(
    `SELECT d.*
     FROM documents d
     JOIN loads l ON l.id = d.loadId
     WHERE d.id = ? AND l.companyId = ?`,
    [docId, companyId],
    (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Document not found' });

    if (doc.filePath && fs.existsSync(doc.filePath)) {
      fs.unlinkSync(doc.filePath);
    }

    db.run(`DELETE FROM documents WHERE id = ?`, [docId], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ error: 'Failed to delete document' });
      res.json({ success: true });
    });
    }
  );
});
app.delete('/api/loads/:id', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const loadId = req.params.id;

  db.get(
    `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
    [loadId, companyId],
    (findErr, existingLoad) => {
      if (findErr) {
        console.error('Error finding load before delete:', findErr.message);
        return res.status(500).json({ error: 'Failed to delete load' });
      }

      if (!existingLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }

      db.run(
        `DELETE FROM loads
         WHERE id = ? AND companyId = ?`,
        [loadId, companyId],
        function (err) {
      if (err) {
        console.error('Error deleting load:', err.message);
        return res.status(500).json({ error: 'Failed to delete load' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Load not found' });
      }

      writeAuditLog(req, {
        action: 'DELETE',
        entityType: 'LOAD',
        entityId: loadId,
        entityLabel: existingLoad.containerNumber || loadId,
        oldValue: existingLoad,
        newValue: null,
        changedFields: {},
      });

      res.json({ success: true, changes: this.changes });
        }
      );
    }
  );
});

app.put('/api/loads/:id/container-number', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const loadId = req.params.id;
  const containerNumber = String(req.body?.containerNumber || '').trim().toUpperCase();
  const isDriver = req.user?.role === 'driver';
  const driverId = req.user?.driverId;

  if (!containerNumber) {
    return res.status(400).json({ error: 'Container number is required' });
  }

  const lookupQuery = isDriver
    ? `SELECT id, containerNumber, driver FROM loads WHERE id = ? AND companyId = ? AND driver = ?`
    : `SELECT id, containerNumber, driver FROM loads WHERE id = ? AND companyId = ?`;
  const lookupParams = isDriver
    ? [loadId, companyId, driverId]
    : [loadId, companyId];

  db.get(lookupQuery, lookupParams, (findErr, existingLoad) => {
    if (findErr) {
      console.error('Error finding load for container update:', findErr.message);
      return res.status(500).json({ error: 'Failed to update container number' });
    }

    if (!existingLoad) {
      return res.status(404).json({ error: 'Load not found or not allowed' });
    }

    db.run(
      `UPDATE loads SET containerNumber = ? WHERE id = ? AND companyId = ?`,
      [containerNumber, loadId, companyId],
      function (err) {
        if (err) {
          console.error('Error updating container number:', err.message);
          return res.status(500).json({ error: 'Failed to update container number' });
        }

        writeAuditLog(req, {
          action: 'UPDATE',
          entityType: 'LOAD',
          entityId: loadId,
          entityLabel: containerNumber || loadId,
          oldValue: { containerNumber: existingLoad.containerNumber || '' },
          newValue: { containerNumber },
          changedFields: {
            containerNumber: {
              oldValue: existingLoad.containerNumber || '',
              newValue: containerNumber,
            },
          },
        });

        res.json({ success: true, loadId, containerNumber });
      }
    );
  });
});

app.put('/api/loads/:id/status', authenticate, (req, res) => {
  const loadId = req.params.id;
  const { status, dropDateTime } = req.body;
  const companyId = req.company.companyId;
  const isDriver = req.user?.role === 'driver';
  const driverId = req.user?.driverId;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  const allowedStatuses = [
    'Arrived at Pickup',
    'Loaded',
    'In Transit',
    'Dropped',
    'Delivered',
  ];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  const updateStatus = () => {
    const query = isDriver
      ? `UPDATE loads
         SET status = ?, dropDateTime = ?
         WHERE id = ? AND companyId = ? AND driver = ?`
      : `UPDATE loads
         SET status = ?, dropDateTime = ?
         WHERE id = ? AND companyId = ?`;

    const params = isDriver
      ? [status, dropDateTime || '', loadId, companyId, driverId]
      : [status, dropDateTime || '', loadId, companyId];

    db.get(
      `SELECT id, status, dropDateTime, containerNumber FROM loads WHERE id = ? AND companyId = ?`,
      [loadId, companyId],
      (oldErr, oldLoad) => {
        if (oldErr) {
          console.error('Error reading load before status change:', oldErr.message);
          return res.status(500).json({ error: 'Failed to update load status' });
        }

        db.run(query, params, function (err) {
          if (err) {
            console.error('Error updating load status:', err.message);
            return res.status(500).json({ error: 'Failed to update load status' });
          }

          if (this.changes === 0) {
            return res.status(404).json({ error: 'Load not found or not allowed' });
          }

          const newStatusValue = {
            status,
            dropDateTime: dropDateTime || '',
          };
          const oldStatusValue = {
            status: oldLoad?.status || '',
            dropDateTime: oldLoad?.dropDateTime || '',
          };

          writeAuditLog(req, {
            action: 'STATUS_CHANGE',
            entityType: 'LOAD',
            entityId: loadId,
            entityLabel: oldLoad?.containerNumber || loadId,
            oldValue: oldStatusValue,
            newValue: newStatusValue,
            changedFields: getChangedFields(oldStatusValue, newStatusValue),
          });

          res.json({ success: true, loadId, status, dropDateTime: dropDateTime || '' });
        });
      }
    );
  };

  if (isDriver && status === 'Delivered') {
    db.all(
      `SELECT category, type
       FROM documents
       WHERE loadId = ?
         AND loadId IN (
           SELECT id FROM loads WHERE companyId = ? AND driver = ?
         )`,
      [loadId, companyId, driverId],
      (docErr, documents) => {
        if (docErr) {
          console.error('Error checking completion documents:', docErr.message);
          return res.status(500).json({ error: 'Failed to verify paperwork' });
        }

        if (!hasRequiredCompletionDocuments(documents)) {
          return res.status(400).json({
            error: 'POD, IN EIR, and OUT EIR are required before completing this load.',
          });
        }

        updateStatus();
      }
    );
    return;
  }

  updateStatus();
});

console.log('SERVER FILE LOADED');
console.log('Invoice routes mounted at /api/invoices');

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    db.get(
      `SELECT * FROM companies WHERE email = ?`,
      [email],
      async (err, existingCompany) => {
        if (err) {
          console.error('Register lookup error:', err.message);
          return res.status(500).json({ error: 'Database error.' });
        }

        if (existingCompany) {
          return res.status(400).json({ error: 'Email already registered.' });
        }

        const companyId = uuidv4();
        const userId = uuidv4();
        const passwordHash = await bcrypt.hash(password, 10);
        const createdAt = new Date().toISOString();

        db.run(
          `INSERT INTO companies (id, name, email, passwordHash, createdAt)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, name, email, passwordHash, createdAt],
          function (companyErr) {
            if (companyErr) {
              console.error('Register company insert error:', companyErr.message);
              return res.status(500).json({ error: 'Failed to create company account.' });
            }

            db.run(
              `INSERT INTO users (id, companyId, name, email, password, role, isActive)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [userId, companyId, name, email, passwordHash, 'admin', 1],
              function (userErr) {
                if (userErr) {
                  console.error('Register user insert error:', userErr.message);
                  return res.status(500).json({ error: 'Failed to create admin user.' });
                }

                const token = jwt.sign(
                  {
                    id: userId,
                    name,
                    email,
                    role: 'admin',
                    companyId,
                    driverId: null,
                  },
                  JWT_SECRET,
                  { expiresIn: '7d' }
                );

                res.json({
                  token,
                  user: {
                    id: userId,
                    name,
                    email,
                    role: 'admin',
                    companyId,
                    driverId: null,
                  },
                  company: {
                    id: companyId,
                    name,
                    email,
                    logoUrl: '',
                    portHoustonUsername: '',
                    portHoustonConfigured: false,
                  },
                });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error('Register route error:', error.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  db.get(
    `SELECT * FROM companies WHERE email = ?`,
    [email],
    async (err, company) => {
      if (err) {
        console.error('Login lookup error:', err.message);
        return res.status(500).json({ error: 'Database error.' });
      }

      if (!company) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const isValid = await bcrypt.compare(password, company.passwordHash);

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const token = jwt.sign(
        { companyId: company.id, email: company.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        token,
        company: getCompanyPayload(company),
      });
    }
  );
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  console.warn(`Frontend dist folder not found at ${distDir}. Run npm run build before production start.`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
