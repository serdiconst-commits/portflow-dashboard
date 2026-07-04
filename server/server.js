import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
const customerPacketOrder = [
  'Rate Confirmation',
  'BOL',
  'POD',
  'OUT EIR',
  'IN EIR',
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
const normalizePacketCategory = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
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
const defaultPodSettings = {
  showCompanyInfo: false,
  showCustomerInfo: true,
  showPickup: true,
  showDelivery: true,
  showReturn: true,
  showDriverTruck: true,
  showSignatures: true,
};
const parsePodSettings = (company = {}) => {
  try {
    const parsed = company.podSettingsJson ? JSON.parse(company.podSettingsJson) : {};
    return { ...defaultPodSettings, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaultPodSettings;
  }
};
const getCompanyPayload = (company = {}) => ({
  id: company.id,
  name: company.name,
  email: company.email,
  invoiceName: company.invoiceName || company.name || '',
  invoiceAddress: company.invoiceAddress || '',
  settlementCompanyName: company.settlementCompanyName || company.invoiceName || company.name || '',
  podSettings: parsePodSettings(company),
  logoUrl: getCompanyLogoUrl(company),
  portHoustonUsername: company.portHoustonUsername || '',
  portHoustonConfigured: Object.values(getSanitizedPortHoustonCredentials(company)).some((item) => item.configured),
  portHoustonCredentials: getSanitizedPortHoustonCredentials(company),
});

const companyProfileSelect =
  'id, name, email, logoPath, invoiceName, invoiceAddress, settlementCompanyName, podSettingsJson, portHoustonUsername, portHoustonPassword, portHoustonCredentialsJson';

const parseNumericField = (value, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, initDatabase } from './database.js';
import createDriverSettlementRoutes from './routes/driverSettlements.js';
import createInvoiceRoutes from './routes/invoices.js';
import {
  downloadGateTransactionDocument,
  extractGateTransactionNumbersFromHistory,
  getBolAvailability,
  getContainerAvailability,
  getGateHistory,
  getGateTransactionsByContainer,
  getGateTransactionsByNumbers,
  getPortHoustonFacilityCode,
} from './integrations/portHouston.js';

const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (!isProduction ? 'portflow-dev-secret-change-before-production' : '');
const PORTFLOW_OWNER_EMAIL = String(process.env.PORTFLOW_OWNER_EMAIL || 'oliver@portflow-net.com').trim().toLowerCase();
const PORTFLOW_OWNER_RESET_CODE = String(process.env.PORTFLOW_OWNER_RESET_CODE || '').trim();

const app = express();

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
}

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});


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

const shouldAutoDispatchLoad = (driver, status) => {
  const hasDriver = Boolean(String(driver || '').trim());
  const currentStatus = String(status || '').trim().toLowerCase();
  return hasDriver && (!currentStatus || ['pending', 'available', 'not available'].includes(currentStatus));
};

const getStatusAfterDriverAssignment = (driver, status, fallback = 'Pending') =>
  shouldAutoDispatchLoad(driver, status) ? 'Dispatched' : status || fallback;

const isTruthy = (value) =>
  value === true ||
  value === 1 ||
  String(value || '').trim().toLowerCase() === 'true' ||
  String(value || '').trim() === '1' ||
  String(value || '').trim().toLowerCase() === 'yes';

const findDuplicateContainerLoad = (companyId, containerNumber, excludeLoadId, callback) => {
  const normalizedContainer = String(containerNumber || '').trim().toUpperCase();
  if (!normalizedContainer) {
    callback(null, null);
    return;
  }

  db.get(
    `SELECT id, containerNumber
     FROM loads
     WHERE companyId = ?
       AND UPPER(TRIM(containerNumber)) = ?
       AND (? = '' OR id != ?)
     LIMIT 1`,
    [companyId, normalizedContainer, excludeLoadId || '', excludeLoadId || ''],
    callback
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

const normalizeDriverIdInput = (value = '') => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';

  const numberMatch = raw.match(/^(?:DRV[-\s]*)?(\d+)$/);
  if (numberMatch) {
    return `DRV-${String(Number.parseInt(numberMatch[1], 10)).padStart(3, '0')}`;
  }

  return raw;
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
        const isExternalUrl = /^https?:\/\//i.test(String(doc.filePath || ''));
        const normalizedDoc = {
          ...doc,
          url: doc.filePath
            ? isExternalUrl
              ? doc.filePath
              : `/uploads/${path.basename(doc.filePath)}`
            : '',
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

const flattenPortHoustonValues = (value, pathKey = '') => {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [{ key: pathKey, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenPortHoustonValues(item, `${pathKey}.${index}`));
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenPortHoustonValues(child, pathKey ? `${pathKey}.${key}` : key)
  );
};

const findPortHoustonEirUrl = (source, direction) => {
  const directionWords = direction === 'OUT EIR'
    ? ['out', 'outgate', 'gateout', 'depart', 'pickup', 'ro', 'rm', 'dm']
    : ['in', 'ingate', 'gatein', 'return', 'ri'];
  const documentWords = ['eir', 'document', 'documents', 'receipt', 'ticket', 'pdf', 'image'];
  const urlEntries = flattenPortHoustonValues(source)
    .filter(({ value }) => typeof value === 'string' && /^https?:\/\//i.test(value));

  const exactMatch = urlEntries.find(({ key, value }) => {
    const haystack = `${key} ${value}`.toLowerCase();
    return haystack.includes('eir') && directionWords.some((word) => haystack.includes(word));
  })?.value;

  if (exactMatch) return exactMatch;

  const documentMatch = urlEntries.find(({ key, value }) => {
    const haystack = `${key} ${value}`.toLowerCase();
    return documentWords.some((word) => haystack.includes(word)) &&
      directionWords.some((word) => haystack.includes(word));
  })?.value;

  if (documentMatch) return documentMatch;

  const documentUrls = urlEntries.filter(({ key, value }) => {
      const haystack = `${key} ${value}`.toLowerCase();
      return documentWords.some((word) => haystack.includes(word));
    });

  return documentUrls.length === 1 ? documentUrls[0].value : '';
};

const getPortHoustonDocumentSignals = (source) => {
  const flattened = flattenPortHoustonValues(source);
  const hasDocuments = flattened.some(({ key, value }) =>
    String(key || '').toLowerCase().includes('hasdocuments') &&
    (value === true || String(value || '').toLowerCase() === 'true')
  );
  const transactionNumbers = [...new Set(flattened
    .filter(({ key, value }) =>
      /(nbr|gkey|transaction|transnbr|trangkey)$/i.test(String(key || '')) &&
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    )
    .map(({ value }) => String(value).trim()))];
  const documentUrls = [...new Set(flattened
    .filter(({ key, value }) => {
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
      const haystack = `${key} ${value}`.toLowerCase();
      return ['eir', 'document', 'receipt', 'ticket', 'pdf', 'image'].some((word) => haystack.includes(word));
    })
    .map(({ value }) => value))];

  return {
    hasDocuments,
    transactionNumbers,
    documentUrls,
  };
};

const getExternalDocumentName = (category, loadId, url = '') => {
  const cleanName = String(url).split('/').pop()?.split('?')[0] || '';
  return cleanName || `${loadId}-${category.replace(/\s+/g, '-').toLowerCase()}.pdf`;
};

const sanitizePdfFilename = (value, fallback = 'document') => {
  const safe = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return safe || fallback;
};

const ensureExternalDocumentRecord = ({
  loadId,
  companyId,
  category,
  url,
}) =>
  new Promise((resolve, reject) => {
    if (!url) {
      resolve(null);
      return;
    }

    db.get(
      `SELECT d.*
       FROM documents d
       JOIN loads l ON l.id = d.loadId
       WHERE d.loadId = ?
         AND l.companyId = ?
         AND UPPER(TRIM(d.category)) = ?
         AND d.filePath = ?`,
      [loadId, companyId, category, url],
      (findErr, existingDoc) => {
        if (findErr) {
          reject(findErr);
          return;
        }

        if (existingDoc) {
          resolve(existingDoc);
          return;
        }

        const id = uuidv4();
        const uploadedAt = new Date().toISOString();
        const name = getExternalDocumentName(category, loadId, url);

        db.run(
          `INSERT INTO documents (id, loadId, name, size, type, category, filePath, uploadedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, loadId, name, 'External', 'application/pdf', category, url, uploadedAt],
          (insertErr) => {
            if (insertErr) {
              reject(insertErr);
              return;
            }

            resolve({
              id,
              loadId,
              name,
              size: 'External',
              type: 'application/pdf',
              category,
              filePath: url,
              uploadedAt,
              url,
            });
          }
        );
      }
    );
  });

const getPortHoustonTransactionId = (transaction = {}) => {
  const safeTransaction = transaction || {};
  return String(safeTransaction.nbr || safeTransaction.gkey || '').trim();
};

const portHoustonOutGateSubtypes = ['RO', 'RM', 'DM', 'DI', 'DE'];
const portHoustonInGateSubtypes = ['RI', 'RE', 'RC', 'RB'];

const getPortHoustonEirCategory = (transaction = {}) => {
  const safeTransaction = transaction || {};
  const subType = String(safeTransaction.subType || '').trim().toUpperCase();
  if (portHoustonInGateSubtypes.includes(subType)) return 'IN EIR';
  if (portHoustonOutGateSubtypes.includes(subType)) return 'OUT EIR';
  return '';
};

const ensureDownloadedPortHoustonDocument = ({
  loadId,
  companyId,
  category,
  transaction,
  document,
}) =>
  new Promise((resolve, reject) => {
    const transactionId = getPortHoustonTransactionId(transaction);
    if (!transactionId || !document?.buffer?.length) {
      resolve(null);
      return;
    }

    db.get(
      `SELECT d.*
       FROM documents d
       JOIN loads l ON l.id = d.loadId
       WHERE d.loadId = ?
         AND l.companyId = ?
         AND UPPER(TRIM(d.category)) = ?
         AND d.name LIKE ?`,
      [loadId, companyId, category, `%${transactionId}%`],
      (findErr, existingDoc) => {
        if (findErr) {
          reject(findErr);
          return;
        }

        if (existingDoc) {
          resolve(existingDoc);
          return;
        }

        const id = uuidv4();
        const uploadedAt = new Date().toISOString();
        const extension = String(document.contentType || '').toLowerCase().includes('image') ? 'jpg' : 'pdf';
        const safeLoadId = String(loadId).replace(/[^a-z0-9_-]/gi, '-');
        const fileName = `${safeLoadId}-${category.replace(/\s+/g, '-').toLowerCase()}-${transactionId}.${extension}`;
        const filePath = path.join(uploadsDir, fileName);

        fs.writeFileSync(filePath, document.buffer);

        db.run(
          `INSERT INTO documents (id, loadId, name, size, type, category, filePath, uploadedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            loadId,
            fileName,
            `${(document.buffer.length / 1024).toFixed(1)} KB`,
            document.contentType || 'application/pdf',
            category,
            filePath,
            uploadedAt,
          ],
          (insertErr) => {
            if (insertErr) {
              reject(insertErr);
              return;
            }

            resolve({
              id,
              loadId,
              name: fileName,
              size: `${(document.buffer.length / 1024).toFixed(1)} KB`,
              type: document.contentType || 'application/pdf',
              category,
              filePath,
              uploadedAt,
              url: `/uploads/${path.basename(filePath)}`,
            });
          }
        );
      }
    );
  });

const formatPortHoustonDate = (value = '') => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPortHoustonYesNo = (value) => {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'true') return 'Yes';
  if (normalized.toLowerCase() === 'false') return 'No';
  return normalized;
};

const buildGeneratedEirRows = ({ transaction = {}, load = {} }) => [
  ['Terminal', transaction.terminal || ''],
  ['Line', transaction.shipLine || ''],
  ['EIR #', transaction.nbr || transaction.gkey || ''],
  ['Type', transaction.subType || ''],
  ['Created', formatPortHoustonDate(transaction.created)],
  ['Handled', formatPortHoustonDate(transaction.handled || transaction.changed)],
  ['Truck Co.', transaction.truckingCompany || ''],
  ['Truck License #', transaction.truckLicenseNbr || ''],
  ['Driver', load.driver || load.driverName || ''],
  ['Container', transaction.containerNumber || load.containerNumber || ''],
  ['Container Size/Type', transaction.containerSize || transaction.containerType || load.containerSize || ''],
  ['Chassis', transaction.chassisNumber || load.chassisNumber || ''],
  ['Owner Chassis', formatPortHoustonYesNo(transaction.chassisIsOwner)],
  ['Release / Booking', transaction.bookingNumber || load.bookingNumber || load.referenceNumber || ''],
  ['BOL', transaction.billOfLading || load.referenceNumber || ''],
  ['Ticket Position', transaction.ticketPosition || ''],
  ['Scale WT', transaction.scaleWeight || ''],
  ['Gross WT', transaction.containerGrossWeight || ''],
  ['Seal', transaction.sealNumber || load.sealNumber || ''],
  ['Status', transaction.status || ''],
  ['Stage', transaction.stageId || ''],
];

const createGeneratedPortHoustonEirPdf = async ({ category, transaction, load }) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const darkBlue = rgb(0.03, 0.19, 0.38);
  const muted = rgb(0.35, 0.42, 0.5);
  const border = rgb(0.82, 0.86, 0.9);
  const softBlue = rgb(0.9, 0.96, 1);
  const black = rgb(0.08, 0.1, 0.12);
  const title = category === 'IN EIR' ? 'PORTFLOW IN EIR DATA SUMMARY' : 'PORTFLOW OUT EIR DATA SUMMARY';

  page.drawRectangle({ x: 36, y: 700, width: 540, height: 56, color: darkBlue });
  page.drawText(title, { x: 54, y: 730, size: 18, font: boldFont, color: rgb(1, 1, 1) });
  page.drawText('Generated from Port Houston gate transaction data', {
    x: 54,
    y: 710,
    size: 9,
    font,
    color: rgb(0.86, 0.93, 1),
  });

  page.drawText(`Load: ${load.loadNumber || load.id || ''}`, { x: 54, y: 674, size: 10, font: boldFont, color: black });
  page.drawText(`Container: ${transaction.containerNumber || load.containerNumber || ''}`, { x: 220, y: 674, size: 10, font: boldFont, color: black });
  page.drawText(`Generated: ${formatPortHoustonDate(new Date().toISOString())}`, { x: 390, y: 674, size: 9, font, color: muted });

  const rows = buildGeneratedEirRows({ transaction, load }).filter(([, value]) => String(value || '').trim());
  let y = 642;
  rows.forEach(([label, value], index) => {
    const isEven = index % 2 === 0;
    if (isEven) {
      page.drawRectangle({ x: 54, y: y - 7, width: 504, height: 22, color: softBlue });
    }
    page.drawRectangle({ x: 54, y: y - 7, width: 504, height: 22, borderColor: border, borderWidth: 0.5 });
    page.drawText(label, { x: 66, y, size: 9, font: boldFont, color: darkBlue });
    page.drawText(String(value), { x: 230, y, size: 9, font, color: black });
    y -= 22;
  });

  page.drawText(
    'Note: This Portflow summary is generated from Port Houston EVP/Road Service data. The official EIR document remains in the Port Houston Customer Service Portal.',
    { x: 54, y: 54, size: 8, font, color: muted, maxWidth: 504 }
  );

  return Buffer.from(await pdfDoc.save());
};

const ensureGeneratedPortHoustonEirDocument = ({
  loadId,
  companyId,
  category,
  transaction,
  load,
}) =>
  new Promise((resolve, reject) => {
    const transactionId = getPortHoustonTransactionId(transaction);
    if (!transactionId || !category) {
      resolve(null);
      return;
    }

    db.get(
      `SELECT d.*
       FROM documents d
       JOIN loads l ON l.id = d.loadId
       WHERE d.loadId = ?
         AND l.companyId = ?
         AND UPPER(TRIM(d.category)) = ?
         AND d.name LIKE ?`,
      [loadId, companyId, category, `%${transactionId}%`],
      async (findErr, existingDoc) => {
        if (findErr) {
          reject(findErr);
          return;
        }

        if (existingDoc) {
          resolve(existingDoc);
          return;
        }

        try {
          const id = uuidv4();
          const uploadedAt = new Date().toISOString();
          const safeContainer = sanitizePdfFilename(transaction.containerNumber || load.containerNumber || loadId, 'container');
          const safeCategory = category.replace(/\s+/g, '-').toLowerCase();
          const fileName = `${safeContainer}-${safeCategory}-${transactionId}-portflow-summary.pdf`;
          const filePath = path.join(uploadsDir, fileName);
          const buffer = await createGeneratedPortHoustonEirPdf({ category, transaction, load });

          fs.writeFileSync(filePath, buffer);

          db.run(
            `INSERT INTO documents (id, loadId, name, size, type, category, filePath, uploadedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              loadId,
              fileName,
              `${(buffer.length / 1024).toFixed(1)} KB`,
              'application/pdf',
              category,
              filePath,
              uploadedAt,
            ],
            (insertErr) => {
              if (insertErr) {
                reject(insertErr);
                return;
              }

              resolve({
                id,
                loadId,
                name: fileName,
                size: `${(buffer.length / 1024).toFixed(1)} KB`,
                type: 'application/pdf',
                category,
                filePath,
                uploadedAt,
                url: `/uploads/${path.basename(filePath)}`,
                generated: true,
              });
            }
          );
        } catch (generateErr) {
          reject(generateErr);
        }
      }
    );
  });

const updateLoadFromPortHoustonCheck = ({
  load,
  companyId,
  availability,
  eir,
}) =>
  new Promise((resolve, reject) => {
    const hasAvailability = typeof availability?.available === 'boolean';
    const nextAvailabilityStatus = hasAvailability
      ? availability.available
        ? 'Available'
        : 'Not Available'
      : load.availabilityStatus || '';
    const nextLastFreeDay = availability?.lastFreeDay || load.lastFreeDay || '';

    db.run(
      `UPDATE loads
       SET availabilityStatus = ?,
           lastFreeDay = ?
       WHERE id = ? AND companyId = ?`,
      [nextAvailabilityStatus, nextLastFreeDay, load.id, companyId],
      async (updateErr) => {
        if (updateErr) {
          reject(updateErr);
          return;
        }

        try {
          const syncedDocuments = [
            ...(eir?.downloadedDocuments || []),
            ...(eir?.generatedDocuments || []),
          ];
          const outUrl = eir?.out?.url || '';
          const outDoc = /^https?:\/\//i.test(outUrl)
            ? await ensureExternalDocumentRecord({
                loadId: load.id,
                companyId,
                category: 'OUT EIR',
                url: outUrl,
              })
            : null;
          if (outDoc) syncedDocuments.push(outDoc);

          const inUrl = eir?.in?.url || '';
          const inDoc = /^https?:\/\//i.test(inUrl)
            ? await ensureExternalDocumentRecord({
                loadId: load.id,
                companyId,
                category: 'IN EIR',
                url: inUrl,
              })
            : null;
          if (inDoc) syncedDocuments.push(inDoc);

          db.get(
            `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
            [load.id, companyId],
            (findErr, updatedLoad) => {
              if (findErr) {
                reject(findErr);
                return;
              }

              attachDocumentsToLoads([updatedLoad], (attachErr, rows) => {
                if (attachErr) {
                  reject(attachErr);
                  return;
                }
                resolve({
                  updatedLoad: rows[0] || updatedLoad,
                  syncedDocuments,
                  changedFields: {
                    availabilityStatus: {
                      oldValue: load.availabilityStatus || '',
                      newValue: nextAvailabilityStatus,
                    },
                    lastFreeDay: {
                      oldValue: load.lastFreeDay || '',
                      newValue: nextLastFreeDay,
                    },
                    syncedDocuments: {
                      oldValue: '',
                      newValue: syncedDocuments.map((doc) => `${doc.category}: ${doc.name}`).join(', '),
                    },
                  },
                });
              });
            }
          );
        } catch (syncErr) {
          reject(syncErr);
        }
      }
    );
  });

const hasRequiredCompletionDocuments = (documents = []) => {
  const uploaded = new Set(
    documents.map((doc) => String(doc.category || doc.type || '').trim().toUpperCase())
  );
  return ['POD'].every((category) => uploaded.has(category));
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
  if (normalized.includes('barbours') || normalized.includes('barbour') || normalized.includes('bct')) {
    return 'barboursCutContainerTracking';
  }
  if (normalized.includes('bayport') || normalized.includes('bpt')) {
    return 'bayportContainerTracking';
  }
  return '';
};

const getLoadPortHoustonFacility = (load = {}) =>
  getPortHoustonFacilityCode([
    load.pickup,
    load.returnLocation,
    load.availabilityStatus,
    load.notes,
  ].filter(Boolean).join(' '));

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

const requirePortHoustonInternalToken = (req, res, next) => {
  const expectedToken = process.env.PORT_HOUSTON_INTERNAL_TOKEN || process.env.PORTFLOW_TMS_API_TOKEN || '';
  const authHeader = req.headers.authorization || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!expectedToken) {
    return res.status(503).json({ error: 'Port Houston internal token is not configured.' });
  }

  if (!providedToken || providedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized Port Houston callback.' });
  }

  next();
};

const findLoadForPortHoustonMapping = ({ containerNumber = '', billOfLading = '' }) =>
  new Promise((resolve, reject) => {
    const normalizedContainer = String(containerNumber || '').trim().toUpperCase();
    const normalizedBol = String(billOfLading || '').trim().toUpperCase();

    if (!normalizedContainer && !normalizedBol) {
      resolve(null);
      return;
    }

    db.get(
      `SELECT *
       FROM loads
       WHERE (? <> '' AND UPPER(TRIM(containerNumber)) = ?)
          OR (? <> '' AND UPPER(TRIM(referenceNumber)) = ?)
          OR (? <> '' AND UPPER(TRIM(poNumber)) = ?)
       ORDER BY COALESCE(loadDate, '') DESC
       LIMIT 1`,
      [
        normalizedContainer,
        normalizedContainer,
        normalizedBol,
        normalizedBol,
        normalizedBol,
        normalizedBol,
      ],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });

app.post('/api/port-houston/events', requirePortHoustonInternalToken, async (req, res) => {
  const mapping = req.body?.mapping || {};
  const sourceEvent = req.body?.sourceEvent || {};

  try {
    const load = await findLoadForPortHoustonMapping(mapping);
    if (!load) {
      return res.status(404).json({
        ok: false,
        error: 'No matching load found for Port Houston event.',
        mapping,
      });
    }

    const nextStatus = String(mapping.shipmentStatus || '').trim();
    const nextAvailability = nextStatus || load.availabilityStatus || '';

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE loads
         SET status = COALESCE(NULLIF(?, ''), status),
             availabilityStatus = COALESCE(NULLIF(?, ''), availabilityStatus),
             chassisNumber = COALESCE(NULLIF(?, ''), chassisNumber)
         WHERE id = ?`,
        [
          nextStatus,
          nextAvailability,
          sourceEvent.chsId || sourceEvent.chassisNumber || '',
          load.id,
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    res.json({
      ok: true,
      loadId: load.id,
      containerNumber: load.containerNumber,
      status: nextStatus || load.status,
      availabilityStatus: nextAvailability,
    });
  } catch (error) {
    console.error('Port Houston event callback failed:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to process Port Houston event.' });
  }
});

app.post('/api/port-houston/eir-upload', requirePortHoustonInternalToken, upload.single('file'), async (req, res) => {
  const category = String(req.body.category || 'Other').trim() || 'Other';
  const mapping = {
    containerNumber: req.body.containerNumber || '',
    billOfLading: req.body.billOfLading || '',
  };

  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No EIR file uploaded.' });
  }

  try {
    const load = await findLoadForPortHoustonMapping(mapping);
    if (!load) {
      return res.status(404).json({
        ok: false,
        error: 'No matching load found for EIR upload.',
        mapping,
      });
    }

    const id = uuidv4();
    const uploadedAt = new Date().toISOString();
    const savedPath = req.file.path;
    const savedName = req.file.originalname || `${category.replace(/\s+/g, '-').toLowerCase()}-${id}.pdf`;
    const size = `${(fs.statSync(savedPath).size / 1024).toFixed(1)} KB`;

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO documents (id, loadId, name, size, type, category, filePath, uploadedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          load.id,
          savedName,
          size,
          req.file.mimetype || 'application/pdf',
          category,
          savedPath,
          uploadedAt,
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    res.json({
      ok: true,
      document: {
        id,
        loadId: load.id,
        name: savedName,
        size,
        type: req.file.mimetype || 'application/pdf',
        category,
        url: `/uploads/${path.basename(savedPath)}`,
        uploadedAt,
      },
    });
  } catch (error) {
    console.error('Port Houston EIR upload failed:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to save Port Houston EIR.' });
  }
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
const dispatchLocationRoles = new Set(['dispatcher', 'manager', ...adminRoles]);
const isPortFlowOwner = (user = {}) =>
  normalizeRole(user.role) === 'owner' || String(user.email || '').trim().toLowerCase() === PORTFLOW_OWNER_EMAIL;
const requireRoles = (allowedRoles) => (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (allowedRoles.has(role)) {
    next();
    return;
  }

  res.status(403).json({ error: 'You do not have permission to access this area.' });
};
const requireTenantOwner = (req, res, next) => {
  if (isPortFlowOwner(req.user)) {
    next();
    return;
  }

  res.status(403).json({ error: 'Tenant Management is only available to the PortFlow owner.' });
};

app.use('/api/invoices', authenticate, createInvoiceRoutes(db));
app.use('/api/driver-settlements', authenticate, createDriverSettlementRoutes(db));

app.post('/api/demo-requests', (req, res) => {
  const companyName = String(req.body?.companyName || '').trim();
  const contactName = String(req.body?.contactName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!companyName || !email) {
    return res.status(400).json({ error: 'Company name and email are required.' });
  }

  const id = uuidv4();
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO demo_requests (id, companyName, contactName, email, phone, message, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, companyName, contactName, email, phone, message, 'New', createdAt, createdAt],
    (err) => {
      if (err) {
        console.error('Demo request insert error:', err.message);
        return res.status(500).json({ error: 'Failed to save demo request.' });
      }

      res.json({ ok: true, id, message: 'Demo request received.' });
    }
  );
});

app.get('/api/tenant-management/companies', authenticate, requireTenantOwner, (_req, res) => {
  db.all(
    `SELECT
       c.id,
       c.name,
       c.email,
       COALESCE(c.serviceStatus, 'Active') AS serviceStatus,
       COALESCE(c.subscriptionPlan, 'Demo') AS subscriptionPlan,
       COALESCE(c.subscriptionNotes, '') AS subscriptionNotes,
       c.createdAt,
       c.tenantUpdatedAt,
       COUNT(DISTINCT u.id) AS usersCount,
       COUNT(DISTINCT l.id) AS loadsCount
     FROM companies c
     LEFT JOIN users u ON u.companyId = c.id
     LEFT JOIN loads l ON l.companyId = c.id
     GROUP BY c.id
     ORDER BY c.createdAt DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Tenant list error:', err.message);
        return res.status(500).json({ error: 'Failed to load tenants.' });
      }

      res.json(rows || []);
    }
  );
});

app.put('/api/tenant-management/companies/:id', authenticate, requireTenantOwner, (req, res) => {
  const { id } = req.params;
  const serviceStatus = String(req.body?.serviceStatus || 'Active').trim();
  const subscriptionPlan = String(req.body?.subscriptionPlan || 'Demo').trim();
  const subscriptionNotes = String(req.body?.subscriptionNotes || '').trim();
  const allowedStatuses = new Set(['Active', 'Trial', 'Past Due', 'Suspended', 'Canceled']);

  if (!allowedStatuses.has(serviceStatus)) {
    return res.status(400).json({ error: 'Invalid tenant status.' });
  }

  const tenantUpdatedAt = new Date().toISOString();
  db.run(
    `UPDATE companies
     SET serviceStatus = ?, subscriptionPlan = ?, subscriptionNotes = ?, tenantUpdatedAt = ?
     WHERE id = ?`,
    [serviceStatus, subscriptionPlan, subscriptionNotes, tenantUpdatedAt, id],
    function updateTenant(err) {
      if (err) {
        console.error('Tenant update error:', err.message);
        return res.status(500).json({ error: 'Failed to update tenant.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tenant not found.' });
      }

      const isEnabledStatus = serviceStatus === 'Active' || serviceStatus === 'Trial';
      db.run(
        `UPDATE users SET isActive = ? WHERE companyId = ? AND role != 'owner'`,
        [isEnabledStatus ? 1 : 0, id],
        (userErr) => {
          if (userErr) {
            console.error('Tenant user status update error:', userErr.message);
            return res.status(500).json({ error: 'Tenant updated, but user access could not be synced.' });
          }

          res.json({ ok: true, id, serviceStatus, subscriptionPlan, subscriptionNotes, tenantUpdatedAt });
        }
      );
    }
  );
});

app.get('/api/tenant-management/demo-requests', authenticate, requireTenantOwner, (_req, res) => {
  db.all(
    `SELECT * FROM demo_requests ORDER BY createdAt DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Demo request list error:', err.message);
        return res.status(500).json({ error: 'Failed to load demo requests.' });
      }

      res.json(rows || []);
    }
  );
});

app.put('/api/tenant-management/demo-requests/:id', authenticate, requireTenantOwner, (req, res) => {
  const { id } = req.params;
  const status = String(req.body?.status || 'New').trim();
  const allowedStatuses = new Set(['New', 'Contacted', 'Approved', 'Closed']);

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: 'Invalid demo request status.' });
  }

  db.run(
    `UPDATE demo_requests SET status = ?, updatedAt = ? WHERE id = ?`,
    [status, new Date().toISOString(), id],
    function updateDemoRequest(err) {
      if (err) {
        console.error('Demo request update error:', err.message);
        return res.status(500).json({ error: 'Failed to update demo request.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Demo request not found.' });
      }

      res.json({ ok: true, id, status });
    }
  );
});

const fuelAccessRoles = new Set(['dispatcher', 'payroll', 'manager', ...adminRoles]);
const getFuelReceiptUrl = (fuel = {}) =>
  fuel.receiptImagePath ? `/api/fuel/${encodeURIComponent(fuel.id)}/receipt` : '';
const mapFuelTransaction = (row = {}) => {
  const amountPaid = Number(row.amountPaid || 0);
  const gallons = Number(row.gallons || 0);
  return {
    id: row.id,
    companyId: row.companyId,
    driverId: row.driverId,
    truckId: row.truckId || '',
    dateTime: row.dateTime,
    amountPaid,
    gallons,
    pricePerGallon: gallons > 0 ? amountPaid / gallons : 0,
    fuelStation: row.fuelStation || '',
    loadNumber: row.loadNumber || '',
    receiptImageUrl: getFuelReceiptUrl(row),
    receiptOriginalName: row.receiptOriginalName || '',
    receiptMimeType: row.receiptMimeType || '',
    createdAt: row.createdAt,
    driverName: row.driverName || '',
  };
};
const parsePositiveFuelNumber = (value) => {
  const numeric = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : NaN;
};

app.post('/api/fuel', authenticate, upload.single('receipt'), (req, res) => {
  const role = normalizeRole(req.user?.role);
  const companyId = req.company.companyId;
  const driverId = String(req.body.driverId || req.user?.driverId || '').trim();
  const truckId = String(req.body.truckId || '').trim().slice(0, 80);
  const dateTime = String(req.body.dateTime || new Date().toISOString()).trim();
  const amountPaid = parsePositiveFuelNumber(req.body.amountPaid);
  const gallons = parsePositiveFuelNumber(req.body.gallons);
  const fuelStation = String(req.body.fuelStation || '').trim().slice(0, 180);
  const loadNumber = String(req.body.loadNumber || '').trim().slice(0, 80);

  if (role === 'driver' && driverId !== String(req.user?.driverId || '').trim()) {
    return res.status(403).json({ error: 'Drivers can only add fuel for their own account.' });
  }

  if (!driverId) {
    return res.status(400).json({ error: 'Driver is required.' });
  }

  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    return res.status(400).json({ error: 'Total amount must be greater than zero.' });
  }

  if (!Number.isFinite(gallons) || gallons <= 0) {
    return res.status(400).json({ error: 'Gallons must be greater than zero.' });
  }

  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const receiptPath = req.file?.path || '';
  const receiptOriginalName = req.file?.originalname || '';
  const receiptMimeType = req.file?.mimetype || '';

  db.get(
    `SELECT id, name FROM drivers WHERE id = ? AND companyId = ?`,
    [driverId, companyId],
    (driverErr, driver) => {
      if (driverErr) {
        console.error('Fuel driver lookup error:', driverErr.message);
        return res.status(500).json({ error: 'Failed to validate driver.' });
      }

      if (!driver) {
        return res.status(404).json({ error: 'Driver not found.' });
      }

      db.run(
        `INSERT INTO fuel_transactions (
           id, companyId, driverId, truckId, dateTime, amountPaid, gallons,
           fuelStation, loadNumber, receiptImagePath, receiptOriginalName,
           receiptMimeType, createdAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          companyId,
          driverId,
          truckId,
          dateTime,
          amountPaid,
          gallons,
          fuelStation,
          loadNumber,
          receiptPath,
          receiptOriginalName,
          receiptMimeType,
          createdAt,
        ],
        function (insertErr) {
          if (insertErr) {
            console.error('Fuel insert error:', insertErr.message);
            return res.status(500).json({ error: 'Failed to save fuel transaction.' });
          }

          const transaction = mapFuelTransaction({
            id,
            companyId,
            driverId,
            driverName: driver.name,
            truckId,
            dateTime,
            amountPaid,
            gallons,
            fuelStation,
            loadNumber,
            receiptImagePath: receiptPath,
            receiptOriginalName,
            receiptMimeType,
            createdAt,
          });

          writeAuditLog(req, {
            action: 'CREATE_FUEL_TRANSACTION',
            entityType: 'FUEL',
            entityId: id,
            entityLabel: `${driverId} ${fuelStation || ''}`.trim(),
            oldValue: null,
            newValue: transaction,
            changedFields: {
              amountPaid: { oldValue: '', newValue: amountPaid },
              gallons: { oldValue: '', newValue: gallons },
            },
          });

          return res.status(201).json(transaction);
        }
      );
    }
  );
});

app.get('/api/fuel/summary', authenticate, requireRoles(fuelAccessRoles), (req, res) => {
  const companyId = req.company.companyId;
  const { from = '', to = '', driverId = '', truckId = '' } = req.query;
  const clauses = ['f.companyId = ?'];
  const params = [companyId];

  if (from) {
    clauses.push('date(f.dateTime) >= date(?)');
    params.push(String(from));
  }
  if (to) {
    clauses.push('date(f.dateTime) <= date(?)');
    params.push(String(to));
  }
  if (driverId) {
    clauses.push('f.driverId = ?');
    params.push(String(driverId));
  }
  if (truckId) {
    clauses.push('LOWER(f.truckId) LIKE LOWER(?)');
    params.push(`%${String(truckId)}%`);
  }

  const where = clauses.join(' AND ');

  db.all(
    `SELECT f.*, d.name AS driverName
     FROM fuel_transactions f
     LEFT JOIN drivers d ON d.id = f.driverId AND d.companyId = f.companyId
     WHERE ${where}
     ORDER BY f.dateTime DESC`,
    params,
    (err, rows = []) => {
      if (err) {
        console.error('Fuel summary error:', err.message);
        return res.status(500).json({ error: 'Failed to load fuel summary.' });
      }

      const transactions = rows.map(mapFuelTransaction);
      const totalFuelSpend = transactions.reduce((sum, item) => sum + item.amountPaid, 0);
      const totalGallons = transactions.reduce((sum, item) => sum + item.gallons, 0);
      const weeklyTotalsMap = transactions.reduce((map, item) => {
        const transactionDate = new Date(item.dateTime);
        if (Number.isNaN(transactionDate.getTime())) return map;

        const weekStartDate = new Date(transactionDate);
        const day = weekStartDate.getDay();
        weekStartDate.setHours(0, 0, 0, 0);
        weekStartDate.setDate(weekStartDate.getDate() - day);

        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekStartDate.getDate() + 6);

        const weekStart = weekStartDate.toISOString().slice(0, 10);
        const weekEnd = weekEndDate.toISOString().slice(0, 10);
        const existing = map.get(weekStart) || {
          weekStart,
          weekEnd,
          totalFuelSpend: 0,
          totalGallons: 0,
          count: 0,
          dailyTotals: Array.from({ length: 7 }, (_, index) => {
            const date = new Date(weekStartDate);
            date.setDate(weekStartDate.getDate() + index);
            return {
              date: date.toISOString().slice(0, 10),
              dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
              totalFuelSpend: 0,
              totalGallons: 0,
              count: 0,
            };
          }),
        };

        existing.totalFuelSpend += item.amountPaid;
        existing.totalGallons += item.gallons;
        existing.count += 1;
        const dailyTotal = existing.dailyTotals[day];
        if (dailyTotal) {
          dailyTotal.totalFuelSpend += item.amountPaid;
          dailyTotal.totalGallons += item.gallons;
          dailyTotal.count += 1;
        }
        map.set(weekStart, existing);
        return map;
      }, new Map());

      const weeklyTotals = Array.from(weeklyTotalsMap.values())
        .map((week) => ({
          ...week,
          averagePricePerGallon: week.totalGallons > 0 ? week.totalFuelSpend / week.totalGallons : 0,
          dailyTotals: (week.dailyTotals || []).map((day) => ({
            ...day,
            averagePricePerGallon: day.totalGallons > 0 ? day.totalFuelSpend / day.totalGallons : 0,
          })),
        }))
        .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));

      return res.json({
        totalFuelSpend,
        totalGallons,
        averagePricePerGallon: totalGallons > 0 ? totalFuelSpend / totalGallons : 0,
        count: transactions.length,
        weeklyTotals,
        transactions,
      });
    }
  );
});

app.get('/api/fuel/driver/:id', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const requestedDriverId = String(req.params.id || '').trim();
  const role = normalizeRole(req.user?.role);

  if (role === 'driver' && requestedDriverId !== String(req.user?.driverId || '').trim()) {
    return res.status(403).json({ error: 'Drivers can only view their own fuel history.' });
  }

  if (role !== 'driver' && !fuelAccessRoles.has(role)) {
    return res.status(403).json({ error: 'You do not have permission to view fuel history.' });
  }

  db.all(
    `SELECT f.*, d.name AS driverName
     FROM fuel_transactions f
     LEFT JOIN drivers d ON d.id = f.driverId AND d.companyId = f.companyId
     WHERE f.companyId = ? AND f.driverId = ?
     ORDER BY f.dateTime DESC`,
    [companyId, requestedDriverId],
    (err, rows = []) => {
      if (err) {
        console.error('Fuel driver history error:', err.message);
        return res.status(500).json({ error: 'Failed to load fuel history.' });
      }

      return res.json(rows.map(mapFuelTransaction));
    }
  );
});

app.get('/api/fuel/:id/receipt', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const fuelId = String(req.params.id || '').trim();
  const role = normalizeRole(req.user?.role);
  const driverId = String(req.user?.driverId || '').trim();
  const roleClause = role === 'driver' ? ' AND f.driverId = ?' : '';
  const params = role === 'driver' ? [fuelId, companyId, driverId] : [fuelId, companyId];

  if (role !== 'driver' && !fuelAccessRoles.has(role)) {
    return res.status(403).json({ error: 'You do not have permission to open this receipt.' });
  }

  db.get(
    `SELECT f.*
     FROM fuel_transactions f
     WHERE f.id = ? AND f.companyId = ?${roleClause}`,
    params,
    (err, fuel) => {
      if (err) {
        console.error('Fuel receipt lookup error:', err.message);
        return res.status(500).json({ error: 'Failed to open receipt.' });
      }

      if (!fuel?.receiptImagePath || !fs.existsSync(fuel.receiptImagePath)) {
        return res.status(404).json({ error: 'Receipt not found.' });
      }

      res.setHeader('Content-Type', fuel.receiptMimeType || getMimeTypeFromName(fuel.receiptOriginalName || 'receipt.jpg'));
      return res.sendFile(path.resolve(fuel.receiptImagePath));
    }
  );
});

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
    `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
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

app.put('/api/company/profile', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;
  const name = String(req.body.name || '').trim().slice(0, 120);
  const invoiceAddress = String(req.body.invoiceAddress || '').trim().slice(0, 500);

  if (!name) {
    return res.status(400).json({ error: 'Company name is required.' });
  }

  db.run(
    `UPDATE companies
     SET name = ?, invoiceAddress = ?
     WHERE id = ?`,
    [name, invoiceAddress, companyId],
    function (err) {
      if (err) {
        console.error('Company profile update error:', err.message);
        return res.status(500).json({ error: 'Failed to save company profile.' });
      }

      db.get(
        `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
        [companyId],
        (lookupErr, company) => {
          if (lookupErr || !company) {
            console.error('Company profile refresh error:', lookupErr?.message);
            return res.status(500).json({ error: 'Profile saved, but profile refresh failed.' });
          }

          writeAuditLog(req, {
            action: 'UPDATE_COMPANY_PROFILE',
            entityType: 'COMPANY',
            entityId: companyId,
            entityLabel: company.name,
            oldValue: null,
            newValue: { name, invoiceAddress },
            changedFields: {
              name: { oldValue: '', newValue: name },
              invoiceAddress: { oldValue: '', newValue: invoiceAddress },
            },
          });

          res.json(getCompanyPayload(company));
        }
      );
    }
  );
});

app.put('/api/company/invoice-branding', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;
  const invoiceName = String(req.body.invoiceName || '').trim().slice(0, 120);
  const invoiceAddress = String(req.body.invoiceAddress || '').trim().slice(0, 500);
  const settlementCompanyName = String(req.body.settlementCompanyName || invoiceName).trim().slice(0, 120);

  if (!invoiceName) {
    return res.status(400).json({ error: 'Invoice company name is required.' });
  }

  db.run(
    `UPDATE companies
     SET invoiceName = ?, invoiceAddress = ?, settlementCompanyName = ?
     WHERE id = ?`,
    [invoiceName, invoiceAddress, settlementCompanyName, companyId],
    function (err) {
      if (err) {
        console.error('Invoice branding update error:', err.message);
        return res.status(500).json({ error: 'Failed to save invoice branding.' });
      }

      db.get(
        `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
        [companyId],
        (lookupErr, company) => {
          if (lookupErr || !company) {
            console.error('Invoice branding lookup error:', lookupErr?.message);
            return res.status(500).json({ error: 'Branding saved, but profile refresh failed.' });
          }

          writeAuditLog(req, {
            action: 'UPDATE_INVOICE_BRANDING',
            entityType: 'COMPANY',
            entityId: companyId,
            entityLabel: company.name,
            oldValue: null,
            newValue: { invoiceName, invoiceAddress, settlementCompanyName },
            changedFields: {
              invoiceName: { oldValue: '', newValue: invoiceName },
              invoiceAddress: { oldValue: '', newValue: invoiceAddress },
              settlementCompanyName: { oldValue: '', newValue: settlementCompanyName },
            },
          });

          res.json(getCompanyPayload(company));
        }
      );
    }
  );
});

app.put('/api/company/pod-settings', authenticate, requireRoles(adminRoles), (req, res) => {
  const companyId = req.company.companyId;
  const nextSettings = {
    ...defaultPodSettings,
    showCompanyInfo: isTruthy(req.body.showCompanyInfo),
    showCustomerInfo: req.body.showCustomerInfo === undefined ? true : isTruthy(req.body.showCustomerInfo),
    showPickup: req.body.showPickup === undefined ? true : isTruthy(req.body.showPickup),
    showDelivery: req.body.showDelivery === undefined ? true : isTruthy(req.body.showDelivery),
    showReturn: req.body.showReturn === undefined ? true : isTruthy(req.body.showReturn),
    showDriverTruck: req.body.showDriverTruck === undefined ? true : isTruthy(req.body.showDriverTruck),
    showSignatures: req.body.showSignatures === undefined ? true : isTruthy(req.body.showSignatures),
  };

  db.run(
    `UPDATE companies
     SET podSettingsJson = ?
     WHERE id = ?`,
    [JSON.stringify(nextSettings), companyId],
    function (err) {
      if (err) {
        console.error('POD settings update error:', err.message);
        return res.status(500).json({ error: 'Failed to save POD settings.' });
      }

      db.get(
        `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
        [companyId],
        (lookupErr, company) => {
          if (lookupErr || !company) {
            console.error('POD settings lookup error:', lookupErr?.message);
            return res.status(500).json({ error: 'POD settings saved, but profile refresh failed.' });
          }

          writeAuditLog(req, {
            action: 'UPDATE_POD_SETTINGS',
            entityType: 'COMPANY',
            entityId: companyId,
            entityLabel: company.name,
            oldValue: null,
            newValue: nextSettings,
            changedFields: Object.fromEntries(
              Object.entries(nextSettings).map(([key, value]) => [key, { oldValue: '', newValue: value }])
            ),
          });

          res.json(getCompanyPayload(company));
        }
      );
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
            `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
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
        `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
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
  const facility = getPortHoustonFacilityCode(req.query.facility || req.query.terminal || '');

  if (!containerNumber) {
    return res.status(400).json({ error: 'Container number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId, facility);
    const result = await getContainerAvailability(containerNumber, credentials, facility);
    const log = await insertPortCheckLog({
      companyId,
      containerNumber,
      terminal: result.terminal || facility || '',
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
  const facility = getPortHoustonFacilityCode(req.query.facility || req.query.terminal || '');

  if (!bolNumber) {
    return res.status(400).json({ error: 'Bill of lading number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId, facility);
    const result = await getBolAvailability(bolNumber, credentials, facility);
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
  const facility = getPortHoustonFacilityCode(req.query.facility || '');

  if (!containerNumber) {
    return res.status(400).json({ error: 'Container number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId);
    const result = await getGateHistory(containerNumber, credentials, facility);
    const log = await insertPortCheckLog({
      companyId,
      containerNumber,
      terminal: facility || 'ALL',
      requestType: 'GATE_HISTORY',
      status: 'SUCCESS',
      response: result,
      checkedByUserId: req.user?.id || '',
    });

    res.json({ ...result, facility: facility || 'ALL', checkedBy: req.user?.name || req.user?.email || '', checkedAt: log.checkedAt });
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

app.get('/api/port-houston/load-lookup', authenticate, async (req, res) => {
  const companyId = req.company.companyId;
  const containerNumber = String(req.query.containerNumber || '').trim().toUpperCase();
  const bolNumber = String(req.query.bolNumber || '').trim();
  const terminal = String(req.query.terminal || '').trim();

  if (!containerNumber && !bolNumber) {
    return res.status(400).json({ error: 'Container number or BOL/reference number is required.' });
  }

  try {
    const credentials = await getCompanyPortHoustonCredentials(companyId, terminal);
    const facility = getPortHoustonFacilityCode(terminal);
    const availability = containerNumber ? await getContainerAvailability(containerNumber, credentials, facility) : null;
    const bolAvailability = bolNumber ? await getBolAvailability(bolNumber, credentials, facility) : null;
    const primaryContainer =
      (availability?.found ? availability : null) ||
      bolAvailability?.containers?.find((item) => item?.containerNumber) ||
      bolAvailability?.containers?.[0] ||
      {};
    const statusSource = availability || primaryContainer;
    const lookupContainerNumber = containerNumber || primaryContainer.containerNumber || '';
    const gate = lookupContainerNumber ? await getGateHistory(lookupContainerNumber, credentials, facility) : null;
    const suggested = {
      containerNumber: lookupContainerNumber,
      containerSize: primaryContainer.containerSize || '',
      shipLine: primaryContainer.shipLine || '',
      bookingNumber: primaryContainer.bookingNumber || '',
      billOfLading: primaryContainer.billOfLading || bolNumber || '',
      sealNumber: primaryContainer.sealNumber || '',
      lastFreeDay: primaryContainer.lastFreeDay || '',
      availabilityStatus: typeof statusSource.available === 'boolean'
        ? statusSource.available
          ? 'Available'
          : 'Not Available'
        : '',
      portStatusReason: statusSource.statusReason || '',
      transitState: statusSource.transitState || '',
      stoppedRoad: statusSource.stoppedRoad ?? null,
      terminal: statusSource.terminal || primaryContainer.terminal || facility || '',
      vesselName: primaryContainer.vesselName || '',
      timeIn: primaryContainer.timeIn || '',
      timeOut: primaryContainer.timeOut || '',
    };
    const response = {
      containerNumber: lookupContainerNumber,
      bolNumber,
      facility: facility || 'ALL',
      suggested,
      availability,
      bolAvailability,
      gate,
    };
    const log = await insertPortCheckLog({
      companyId,
      containerNumber: lookupContainerNumber,
      terminal: suggested.terminal || terminal || '',
      requestType: 'SMART_LOAD_LOOKUP',
      status: 'SUCCESS',
      response,
      checkedByUserId: req.user?.id || '',
    });

    res.json({ ...response, checkedBy: req.user?.name || req.user?.email || '', checkedAt: log.checkedAt });
  } catch (error) {
    const status = error.status || 502;
    await insertPortCheckLog({
      companyId,
      containerNumber,
      terminal,
      requestType: 'SMART_LOAD_LOOKUP',
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

    const facility = getLoadPortHoustonFacility(load);
    const credentials = await getCompanyPortHoustonCredentials(
      companyId,
      facility || `${load.pickup || ''} ${load.returnLocation || ''}`
    );
    const availability = containerNumber ? await getContainerAvailability(containerNumber, credentials, facility) : null;
    const bolAvailability = bolNumber ? await getBolAvailability(bolNumber, credentials, facility) : null;
    const gate = containerNumber ? await getGateHistory(containerNumber, credentials, facility) : null;
    const gateTransactionNumbers = extractGateTransactionNumbersFromHistory(gate);
    let gateTransactions = null;
    try {
      const containerGateTransactions = containerNumber
        ? await getGateTransactionsByContainer(containerNumber, credentials, facility)
        : null;
      if (containerGateTransactions?.transactions?.length) {
        gateTransactions = containerGateTransactions;
      } else if (gateTransactionNumbers.length) {
        gateTransactions = await getGateTransactionsByNumbers(gateTransactionNumbers, credentials, facility);
        gateTransactions.lookupMethod = 'equipment-history-nbr';
        gateTransactions.containerLookupEmpty = true;
      } else {
        gateTransactions = {
            transactions: [],
            outEirTransaction: null,
            inEirTransaction: null,
            lookupMethod: containerNumber ? 'ctrId' : '',
            requestedContainerNumber: containerNumber,
            requestedTransactionNumbers: [],
            errors: [],
            reason: containerNumber
              ? 'No Port Houston gate transaction was returned for this container number.'
              : 'No container number was available for gate transaction lookup.',
          };
      }
    } catch (gateTransactionErr) {
      gateTransactions = {
        transactions: [],
        outEirTransaction: null,
        inEirTransaction: null,
        error: gateTransactionErr.message,
      };
    }

    const portDocumentSignals = getPortHoustonDocumentSignals({ availability, bolAvailability, gate, gateTransactions });
    const outEirUrl = findPortHoustonEirUrl({ availability, bolAvailability, gate, gateTransactions }, 'OUT EIR');
    const inEirUrl = findPortHoustonEirUrl({ availability, bolAvailability, gate, gateTransactions }, 'IN EIR');
    const downloadedDocuments = [];
    const eirDownloadErrors = [];
    const eirDocumentDownloadEnabled = Boolean(process.env.PORT_HOUSTON_EIR_DOCUMENT_URL_PATTERN);

    for (const transaction of [
      gateTransactions?.outEirTransaction,
      gateTransactions?.inEirTransaction,
    ].filter(Boolean)) {
      const category = getPortHoustonEirCategory(transaction);
      const transactionId = getPortHoustonTransactionId(transaction);
      if (!category || !transactionId) continue;
      if (!eirDocumentDownloadEnabled) continue;

      try {
        const document = await downloadGateTransactionDocument(transactionId, credentials);
        const savedDoc = await ensureDownloadedPortHoustonDocument({
          loadId,
          companyId,
          category,
          transaction,
          document,
        });
        if (savedDoc) downloadedDocuments.push(savedDoc);
      } catch (downloadErr) {
        eirDownloadErrors.push({
          category,
          transactionId,
          message: downloadErr.message,
        });
      }
    }

    const generatedDocuments = [];
    for (const transaction of [
      gateTransactions?.outEirTransaction,
      gateTransactions?.inEirTransaction,
    ].filter(Boolean)) {
      const category = getPortHoustonEirCategory(transaction);
      const transactionId = getPortHoustonTransactionId(transaction);
      if (!category || !transactionId) continue;

      const alreadyHasOfficialDocument = downloadedDocuments.some((doc) =>
        String(doc.category || '').trim().toUpperCase() === category
      );
      if (alreadyHasOfficialDocument) continue;

      try {
        const generatedDoc = await ensureGeneratedPortHoustonEirDocument({
          loadId,
          companyId,
          category,
          transaction,
          load,
        });
        if (generatedDoc) generatedDocuments.push(generatedDoc);
      } catch (generateErr) {
        eirDownloadErrors.push({
          category,
          transactionId,
          message: `Generated EIR summary failed: ${generateErr.message}`,
        });
      }
    }

    const downloadedOutDoc = downloadedDocuments.find((doc) => doc.category === 'OUT EIR');
    const downloadedInDoc = downloadedDocuments.find((doc) => doc.category === 'IN EIR');
    const generatedOutDoc = generatedDocuments.find((doc) => doc.category === 'OUT EIR');
    const generatedInDoc = generatedDocuments.find((doc) => doc.category === 'IN EIR');
    const getPortHoustonDocumentUrl = (doc) =>
      doc?.id ? `/api/documents/${doc.id}/file` : doc?.url || '';
    const outTransactionId = getPortHoustonTransactionId(gateTransactions?.outEirTransaction);
    const inTransactionId = getPortHoustonTransactionId(gateTransactions?.inEirTransaction);
    const gateTransactionCount = gateTransactions?.transactions?.length || 0;
    const gateTransactionTypes = [
      gateTransactions?.outEirTransaction ? `OUT EIR ${outTransactionId || ''}`.trim() : '',
      gateTransactions?.inEirTransaction ? `IN EIR ${inTransactionId || ''}`.trim() : '',
    ].filter(Boolean).join(' and ');
    const eir = {
      out: downloadedOutDoc
        ? {
            url: getPortHoustonDocumentUrl(downloadedOutDoc),
            source: 'Port Houston',
            transactionNumber: outTransactionId,
          }
        : generatedOutDoc
        ? {
            url: getPortHoustonDocumentUrl(generatedOutDoc),
            source: 'Portflow Generated from Port Houston Data',
            transactionNumber: outTransactionId,
          }
        : outEirUrl
        ? {
            url: outEirUrl,
            source: 'Port Houston',
            transactionNumber: outTransactionId,
          }
        : null,
      in: downloadedInDoc
        ? {
            url: getPortHoustonDocumentUrl(downloadedInDoc),
            source: 'Port Houston',
            transactionNumber: inTransactionId,
          }
        : generatedInDoc
        ? {
            url: getPortHoustonDocumentUrl(generatedInDoc),
            source: 'Portflow Generated from Port Houston Data',
            transactionNumber: inTransactionId,
          }
        : inEirUrl
        ? {
            url: inEirUrl,
            source: 'Port Houston',
            transactionNumber: inTransactionId,
          }
        : null,
      hasPortDocuments: portDocumentSignals.hasDocuments,
      hasDigitalEirData: gateTransactionCount > 0,
      officialDocumentSource: 'Port Houston Customer Service Portal',
      transactionNumbers: portDocumentSignals.transactionNumbers,
      documentUrlsFound: portDocumentSignals.documentUrls.length,
      downloadedDocuments,
      generatedDocuments,
      downloadErrors: eirDownloadErrors,
      documentDownloadEnabled: eirDocumentDownloadEnabled,
      gateTransactionError: gateTransactions?.error || '',
      equipmentHistoryTransactionNumbers: gateTransactionNumbers,
      note: downloadedDocuments.length
        ? 'Port Houston EIR document was downloaded and synced to paperwork.'
        : generatedDocuments.length
          ? 'Portflow generated an EIR data summary from Port Houston gate transaction data and synced it to paperwork.'
        : outEirUrl || inEirUrl
          ? 'EIR document links were returned by Port Houston and synced to paperwork.'
          : gateTransactionCount
            ? `Port Houston returned digital EIR data${gateTransactionTypes ? ` including ${gateTransactionTypes}` : ''}. Official EIR documents are not available through the EVP API; retrieve the official document from the Port Houston Customer Service Portal.`
          : portDocumentSignals.hasDocuments
            ? `Port Houston found an EIR document flag on transaction ${portDocumentSignals.transactionNumbers.join(', ')}, but EVP does not provide the official EIR document link. Use the Port Houston Customer Service Portal.`
            : gateTransactions?.error
              ? `Gate transaction lookup failed: ${gateTransactions.error}`
              : gateTransactions?.reason
                ? gateTransactions.reason
              : gateTransactions?.transactions?.length === 0
                ? 'No Port Houston gate transaction was returned for this container.'
              : 'No EIR data was returned by Port Houston for this check.',
    };
    const response = {
      loadId,
      containerNumber,
      bolNumber,
      facility: facility || 'ALL',
      availability,
      bolAvailability,
      gate,
      gateTransactions,
      eir,
    };

    const log = await insertPortCheckLog({
      companyId,
      loadId,
      containerNumber,
      terminal: availability?.terminal || facility || load.pickup || '',
      requestType: 'LOAD_PORT_CHECK',
      status: 'SUCCESS',
      response,
      checkedByUserId: req.user?.id || '',
    });

    const syncResult = await updateLoadFromPortHoustonCheck({
      load,
      companyId,
      availability,
      eir,
    });

    writeAuditLog(req, {
      action: 'PORT_HOUSTON_CHECK',
      entityType: 'LOAD',
      entityId: loadId,
      entityLabel: containerNumber || loadId,
      oldValue: null,
      newValue: {
        containerNumber,
        terminal: availability?.terminal || facility || '',
        requestedFacility: facility || 'ALL',
        available: availability?.available ?? null,
        availabilityStatus: syncResult.updatedLoad?.availabilityStatus || '',
        lastFreeDay: syncResult.updatedLoad?.lastFreeDay || '',
        syncedDocuments: syncResult.syncedDocuments?.map((doc) => doc.category) || [],
        checkedAt: log.checkedAt,
      },
      changedFields: {
        portHoustonCheck: {
          oldValue: '',
          newValue: `${containerNumber || bolNumber} checked at ${log.checkedAt}`,
        },
        ...syncResult.changedFields,
      },
    });

    res.json({
      ...response,
      updatedLoad: syncResult.updatedLoad,
      syncedDocuments: syncResult.syncedDocuments,
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

app.post('/api/owner/reset-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const resetCode = String(req.body?.resetCode || '').trim();
  const newPassword = String(req.body?.newPassword || '');

  if (!PORTFLOW_OWNER_RESET_CODE) {
    return res.status(503).json({ error: 'Owner password reset is not configured.' });
  }

  if (email !== PORTFLOW_OWNER_EMAIL || resetCode !== PORTFLOW_OWNER_RESET_CODE) {
    return res.status(403).json({ error: 'Invalid reset email or reset code.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.get(`SELECT * FROM companies WHERE LOWER(email) = ?`, [email], (companyLookupErr, company) => {
      if (companyLookupErr) {
        console.error('Owner company lookup error:', companyLookupErr.message);
        return res.status(500).json({ error: 'Failed to prepare owner account reset.' });
      }

      const ownerCompanyId = company?.id || uuidv4();
      const now = new Date().toISOString();
      const saveOwnerCompany = (done) => {
        if (company?.id) {
          db.run(
            `UPDATE companies
             SET passwordHash = ?,
                 serviceStatus = 'Active',
                 subscriptionPlan = COALESCE(NULLIF(subscriptionPlan, ''), 'Owner'),
                 tenantUpdatedAt = ?
             WHERE id = ?`,
            [passwordHash, now, ownerCompanyId],
            done
          );
          return;
        }

        db.run(
          `INSERT INTO companies (id, name, email, passwordHash, createdAt, serviceStatus, subscriptionPlan, subscriptionNotes, tenantUpdatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ownerCompanyId,
            'PortFlow Owner',
            email,
            passwordHash,
            now,
            'Active',
            'Owner',
            'Owner account created by secure password reset.',
            now,
          ],
          done
        );
      };

      saveOwnerCompany((companyErr) => {
        if (companyErr) {
          console.error('Owner company password reset error:', companyErr.message);
          return res.status(500).json({ error: 'Failed to reset owner company account.' });
        }

        db.get(`SELECT * FROM users WHERE LOWER(email) = ?`, [email], (userLookupErr, user) => {
          if (userLookupErr) {
            console.error('Owner user lookup error:', userLookupErr.message);
            return res.status(500).json({ error: 'Failed to prepare owner user reset.' });
          }

          if (user?.id) {
            db.run(
              `UPDATE users
               SET password = ?,
                   role = 'owner',
                   companyId = ?,
                   isActive = 1
               WHERE id = ?`,
              [passwordHash, ownerCompanyId, user.id],
              (userErr) => {
                if (userErr) {
                  console.error('Owner user password reset error:', userErr.message);
                  return res.status(500).json({ error: 'Failed to reset owner password.' });
                }

                res.json({ ok: true, message: 'Owner password reset. You can log in now.' });
              }
            );
            return;
          }

          db.run(
            `INSERT INTO users (id, companyId, name, email, password, role, isActive)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), ownerCompanyId, 'PortFlow Owner', email, passwordHash, 'owner', 1],
            (userErr) => {
              if (userErr) {
                console.error('Owner user create error:', userErr.message);
                return res.status(500).json({ error: 'Failed to create owner login.' });
              }

              res.json({ ok: true, message: 'Owner password reset. You can log in now.' });
            }
          );
        });
      });
    });
  } catch (error) {
    console.error('Owner password reset route error:', error.message);
    res.status(500).json({ error: 'Server error resetting password.' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get(
    `SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND isActive = 1`,
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

        const effectiveRole = isPortFlowOwner(user) ? 'owner' : user.role;
        const token = jwt.sign(
          {
            id: user.id,
            name: user.name,
            email: user.email,
            role: effectiveRole,
            companyId: user.companyId || null,
            driverId: user.driverId || null,
          },
          JWT_SECRET,
          { expiresIn: effectiveRole === 'driver' ? '30d' : '7d' }
        );

        db.get(
          `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
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
                role: effectiveRole,
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

  findDuplicateContainerLoad(companyId, l.containerNumber, loadId, (duplicateErr, duplicateLoad) => {
    if (duplicateErr) {
      console.error('Error checking duplicate container:', duplicateErr.message);
      return res.status(500).json({ error: 'Failed to validate container number' });
    }

    if (duplicateLoad && !isTruthy(l.streetTurn)) {
      return res.status(409).json({
        error: `Container ${String(l.containerNumber || '').trim().toUpperCase()} is already assigned to load ${duplicateLoad.id}. Mark as Street Turn only for a valid export reuse.`,
      });
    }

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

      const nextStatus = getStatusAfterDriverAssignment(normalizedDriver, l.status, existingLoad.status || 'Pending');

      db.run(
        `UPDATE loads SET
          loadDate = ?,
          customer = ?,
          referenceNumber = ?,
          poNumber = ?,
          pickupNumber = ?,
          reservationNumber = ?,
          returnNumber = ?,
          pod = ?,
          driver = ?,
          truck = ?,
          pickup = ?,
          delivery = ?,
          deliveryType = ?,
          appointmentTime = ?,
          eta = ?,
          returnLocation = ?,
          nextMoveType = ?,
          dropType = ?,
          dropLocation = ?,
          droppedBy = ?,
          dropDateTime = ?,
          containerNumber = ?,
          streetTurn = ?,
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
          customerExtraChargesJson = ?,
          lastFreeDay = ?,
          miles = ?,
          billingStatus = ?
         WHERE id = ? AND companyId = ?`,
        [
          l.loadDate || '',
          l.customer || '',
          l.referenceNumber || '',
          l.poNumber || '',
          l.pickupNumber || '',
          l.reservationNumber || '',
          l.returnNumber || '',
          l.pod || '',
          normalizedDriver,
          l.truck || '',
          l.pickup || '',
          l.delivery || '',
          l.deliveryType || '',
          l.appointmentTime || '',
          l.eta || '',
          l.returnLocation || '',
          l.nextMoveType || existingLoad.nextMoveType || '',
          l.dropType || '',
          l.dropLocation || '',
          normalizedDroppedBy,
          l.dropDateTime || '',
          l.containerNumber || '',
          isTruthy(l.streetTurn) ? '1' : '',
          l.bookingNumber || '',
          l.shipLine || '',
          l.chassisNumber || '',
          l.sealNumber || '',
          l.containerSize || '',
          l.rate || 0,
          l.driverRate || 0,
          nextStatus,
          l.availabilityStatus ?? '',
          l.paperwork || '',
          l.detention || 0,
          l.lumper || 0,
          l.fuelAdvance || 0,
          l.settlement || 0,
          l.notes || '',
          typeof l.customerExtraChargesJson === 'string' ? l.customerExtraChargesJson : JSON.stringify(l.customerExtraCharges || []),
          body.lastFreeDay || '',
          parseNumericField(l.miles),
          l.billingStatus || existingLoad.billingStatus || '',
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

app.get('/api/driver-locations', authenticate, requireRoles(dispatchLocationRoles), (req, res) => {
  const companyId = req.company.companyId;

  db.all(
    `SELECT
       dl.*,
       d.name AS driverName,
       d.truck AS truck,
       d.phone AS phone
     FROM driver_locations dl
     LEFT JOIN drivers d
       ON d.id = dl.driverId
      AND d.companyId = dl.companyId
     WHERE dl.companyId = ?
     ORDER BY dl.updatedAt DESC`,
    [companyId],
    (err, rows = []) => {
      if (err) {
        console.error('Error fetching driver locations:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json(rows);
    }
  );
});

app.post('/api/driver-location', authenticate, (req, res) => {
  const role = normalizeRole(req.user?.role);
  const companyId = req.company.companyId;
  const driverId = String(req.user?.driverId || '').trim();

  if (role !== 'driver' || !driverId) {
    return res.status(403).json({ error: 'Only driver accounts can share location.' });
  }

  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
  const heading = req.body?.heading == null ? null : Number(req.body.heading);
  const speed = req.body?.speed == null ? null : Number(req.body.speed);
  const source = String(req.body?.source || 'driver-phone').slice(0, 40);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({ error: 'A valid phone location is required.' });
  }

  const updatedAt = new Date().toISOString();

  db.run(
    `INSERT INTO driver_locations (
       driverId,
       companyId,
       userId,
       latitude,
       longitude,
       accuracy,
       heading,
       speed,
       source,
       updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(driverId) DO UPDATE SET
       companyId = excluded.companyId,
       userId = excluded.userId,
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       accuracy = excluded.accuracy,
       heading = excluded.heading,
       speed = excluded.speed,
       source = excluded.source,
       updatedAt = excluded.updatedAt`,
    [
      driverId,
      companyId,
      req.user?.userId || req.user?.id || '',
      latitude,
      longitude,
      Number.isFinite(accuracy) ? accuracy : null,
      Number.isFinite(heading) ? heading : null,
      Number.isFinite(speed) ? speed : null,
      source,
      updatedAt,
    ],
    (err) => {
      if (err) {
        console.error('Error saving driver location:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json({
        success: true,
        driverId,
        latitude,
        longitude,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        updatedAt,
      });
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
    const normalizedDriverId = normalizeDriverIdInput(id);
    if (!/^DRV-\d{3,}$/.test(normalizedDriverId)) {
      return res.status(400).json({ error: 'Driver ID must be like DRV-001.' });
    }

    createDriver(normalizedDriverId, false);
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

          findDuplicateContainerLoad(companyId, l.containerNumber, '', (duplicateErr, duplicateLoad) => {
            if (duplicateErr) {
              console.error('Error checking duplicate container:', duplicateErr.message);
              return res.status(500).json({ error: 'Failed to validate container number' });
            }

            if (duplicateLoad && !isTruthy(l.streetTurn)) {
              return res.status(409).json({
                error: `Container ${String(l.containerNumber || '').trim().toUpperCase()} is already assigned to load ${duplicateLoad.id}. Use Street Turn only for a valid export reuse.`,
              });
            }

          const nextStatus = getStatusAfterDriverAssignment(normalizedDriver, l.status);

          db.run(
            `INSERT INTO loads (
              id,
              loadDate,
              customer,
              referenceNumber,
              poNumber,
              pickupNumber,
              returnNumber,
              reservationNumber,
              driver,
              truck,
              pickup,
              delivery,
              deliveryType,
              appointmentTime,
              eta,
              returnLocation,
              nextMoveType,
              dropType,
dropLocation,
droppedBy,
dropDateTime,
              containerNumber,
              streetTurn,
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
              customerExtraChargesJson,
              companyId,
              lastFreeDay,
              carrierId,
              miles,
              billingStatus
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              generatedLoadId,
              l.loadDate || new Date().toISOString().slice(0, 10),
              l.customer || '',
              l.referenceNumber || '',
              l.poNumber || '',
              l.pickupNumber || '',
              l.returnNumber || '',
              l.reservationNumber || '',
              normalizedDriver,
              l.truck || '',
              l.pickup || '',
              l.delivery || '',
              l.deliveryType || '',
              l.appointmentTime || '',
              l.eta || '',
              l.returnLocation || '',
              l.nextMoveType || '',
              l.dropType || '',
              l.dropLocation || '',
              normalizedDroppedBy,
              l.dropDateTime || '',
              l.containerNumber || '',
              isTruthy(l.streetTurn) ? '1' : '',
              l.bookingNumber || '',
              l.shipLine || '',
              l.chassisNumber || '',
              l.sealNumber || '',
              l.containerSize || '',
              l.rate || 0,
              l.driverRate || 0,
              nextStatus,
              l.availabilityStatus || '',
              l.paperwork || '',
              l.detention || 0,
              l.lumper || 0,
              l.fuelAdvance || 0,
              l.settlement || 0,
              l.notes || '',
              typeof l.customerExtraChargesJson === 'string' ? l.customerExtraChargesJson : JSON.stringify(l.customerExtraCharges || []),
              companyId,
              l.lastFreeDay || '',
              l.carrierId || '',
              parseNumericField(l.miles),
              l.billingStatus || ''
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
          const docsByCategory = (docs || []).reduce((groups, doc) => {
            const key = normalizePacketCategory(doc.category || doc.type || 'OTHER');
            if (!groups[key]) groups[key] = [];
            groups[key].push(doc);
            return groups;
          }, {});

          const orderedDocs = [];
          customerPacketOrder.forEach((category) => {
            const key = normalizePacketCategory(category);
            if (docsByCategory[key]?.length) {
              orderedDocs.push(...docsByCategory[key]);
              delete docsByCategory[key];
            }
          });
          Object.keys(docsByCategory)
            .sort()
            .forEach((key) => orderedDocs.push(...docsByCategory[key]));

          const packetCompany = await new Promise((resolve) => {
            db.get(
              `SELECT ${companyProfileSelect} FROM companies WHERE id = ?`,
              [companyId],
              (companyErr, company) => {
                if (companyErr) {
                  console.error('Error loading company branding for packet:', companyErr.message);
                }
                resolve(company || {});
              }
            );
          });
          const packetCompanyName = packetCompany.invoiceName || packetCompany.name || 'Company';
          const packetCompanyAddress = packetCompany.invoiceAddress || '';
          const packetInvoice = await new Promise((resolve) => {
            db.get(
              `SELECT invoiceNumber FROM invoices WHERE loadId = ? AND companyId = ? ORDER BY id DESC LIMIT 1`,
              [loadId, companyId],
              (invoiceErr, invoice) => {
                if (invoiceErr) {
                  console.error('Error loading invoice number for packet:', invoiceErr.message);
                }
                resolve(invoice || {});
              }
            );
          });
          const packetFilenameBase = sanitizePdfFilename(
            packetInvoice.invoiceNumber || loadRow.invoiceNumber || loadRow.id || loadId,
            loadId
          );

          const mergedPdf = await PDFDocument.create();

          const invoicePdf = await PDFDocument.create();
          const invoicePage = invoicePdf.addPage([612, 792]);
          // Top divider
          invoicePage.drawLine({
            start: { x: 50, y: 675 },
            end: { x: 560, y: 675 },
            thickness: 1,
          });

          invoicePage.drawText(packetCompanyName, {
            x: 50,
            y: 760,
            size: 18,
          });

          if (packetCompanyAddress) {
            invoicePage.drawText(String(packetCompanyAddress).slice(0, 90), {
              x: 50,
              y: 742,
              size: 10,
            });
          }

          invoicePage.drawText('INVOICE', {
            x: 50,
            y: 710,
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

          const parseMoney = (value) => {
            const number = Number(String(value || 0).replace(/[^0-9.-]/g, ''));
            return Number.isNaN(number) ? 0 : number;
          };

          const formatMoney = (value) => {
            const number = parseMoney(value);
            return `$${number.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          };
          const parseCustomerExtraCharges = (load = {}) => {
            try {
              const parsed = JSON.parse(load.customerExtraChargesJson || '[]');
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          };

          const linehaulAmount = parseMoney(loadRow.rate);
          const detentionAmount = parseMoney(loadRow.detention);
          const extraCharges = parseCustomerExtraCharges(loadRow)
            .map((charge) => ({
              type: String(charge.type || 'Extra Charge').trim() || 'Extra Charge',
              description: String(charge.description || '').trim(),
              amount: parseMoney(charge.amount),
            }))
            .filter((charge) => charge.description || charge.amount);
          const extraChargesTotal = extraCharges.reduce((sum, charge) => sum + charge.amount, 0);
          const invoiceTotalAmount = linehaulAmount + detentionAmount + extraChargesTotal;
          const chargeRows = [
            { description: 'Linehaul / Load Rate', amount: linehaulAmount },
            ...(detentionAmount > 0 ? [{ description: 'Detention', amount: detentionAmount }] : []),
            ...extraCharges.map((charge) => ({
              description: `${charge.type}${charge.description ? ` - ${charge.description}` : ''}`,
              amount: charge.amount,
            })),
          ];

          let chargeY = 440;
          chargeRows.forEach((row) => {
            invoicePage.drawText(String(row.description).slice(0, 58), {
              x: 50,
              y: chargeY,
              size: 12,
            });

            invoicePage.drawText(formatMoney(row.amount), {
              x: 450,
              y: chargeY,
              size: 12,
            });
            chargeY -= 20;
          });

          invoicePage.drawLine({
            start: { x: 50, y: chargeY + 6 },
            end: { x: 560, y: chargeY + 6 },
            thickness: 1,
          });

          invoicePage.drawText('Total:', {
            x: 350,
            y: chargeY - 14,
            size: 14,
          });

          invoicePage.drawText(formatMoney(invoiceTotalAmount), {
            x: 450,
            y: chargeY - 14,
            size: 14,
          });

          invoicePage.drawText(`Notes: ${loadRow.notes || 'No additional notes.'}`, {
            x: 50,
            y: Math.max(80, chargeY - 42),
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
            `inline; filename="${packetFilenameBase}.pdf"`
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

      if (/^https?:\/\//i.test(String(doc.filePath))) {
        return res.redirect(doc.filePath);
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

    if (doc.filePath && !/^https?:\/\//i.test(String(doc.filePath)) && fs.existsSync(doc.filePath)) {
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
  const chassisNumber = String(req.body?.chassisNumber || '').trim().toUpperCase();
  const isDriver = req.user?.role === 'driver';
  const driverId = req.user?.driverId;

  if (!containerNumber && !chassisNumber) {
    return res.status(400).json({ error: 'Container number or chassis number is required' });
  }

  const lookupQuery = isDriver
    ? `SELECT id, containerNumber, chassisNumber, driver FROM loads WHERE id = ? AND companyId = ? AND driver = ?`
    : `SELECT id, containerNumber, chassisNumber, driver FROM loads WHERE id = ? AND companyId = ?`;
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

    if (existingLoad.containerNumber && containerNumber) {
      return res.status(409).json({
        error: 'This load already has a container number. Dispatch must edit it if a correction is needed.',
      });
    }

    findDuplicateContainerLoad(companyId, containerNumber, loadId, (duplicateErr, duplicateLoad) => {
      if (duplicateErr) {
        console.error('Error checking duplicate container:', duplicateErr.message);
        return res.status(500).json({ error: 'Failed to validate container number' });
      }

      if (duplicateLoad) {
        return res.status(409).json({
          error: `Container ${containerNumber} is already assigned to load ${duplicateLoad.id}.`,
        });
      }

    db.run(
      `UPDATE loads
       SET containerNumber = COALESCE(NULLIF(?, ''), containerNumber),
           chassisNumber = COALESCE(NULLIF(?, ''), chassisNumber)
       WHERE id = ? AND companyId = ?`,
      [containerNumber, chassisNumber, loadId, companyId],
      function (err) {
        if (err) {
          console.error('Error updating container number:', err.message);
          return res.status(500).json({ error: 'Failed to update container number' });
        }

        const nextContainerNumber = containerNumber || existingLoad.containerNumber || '';
        const nextChassisNumber = chassisNumber || existingLoad.chassisNumber || '';

        writeAuditLog(req, {
          action: 'UPDATE',
          entityType: 'LOAD',
          entityId: loadId,
          entityLabel: nextContainerNumber || nextChassisNumber || loadId,
          oldValue: {
            containerNumber: existingLoad.containerNumber || '',
            chassisNumber: existingLoad.chassisNumber || '',
          },
          newValue: {
            containerNumber: nextContainerNumber,
            chassisNumber: nextChassisNumber,
          },
          changedFields: {
            containerNumber: {
              oldValue: existingLoad.containerNumber || '',
              newValue: nextContainerNumber,
            },
            chassisNumber: {
              oldValue: existingLoad.chassisNumber || '',
              newValue: nextChassisNumber,
            },
          },
        });

        res.json({
          success: true,
          loadId,
          containerNumber: nextContainerNumber,
          chassisNumber: nextChassisNumber,
        });
      }
    );
    });
  });
});

app.put('/api/loads/:id/billing-status', authenticate, (req, res) => {
  const loadId = String(req.params.id || '').trim();
  const companyId = req.company.companyId;
  const billingStatus = String(req.body?.billingStatus || '').trim();

  if (req.user?.role === 'driver') {
    return res.status(403).json({ error: 'Drivers cannot change billing status.' });
  }

  const allowedStatuses = ['', 'Ready To Bill'];
  if (!allowedStatuses.includes(billingStatus)) {
    return res.status(400).json({ error: 'Invalid billing status.' });
  }

  db.get(
    `SELECT id, containerNumber, billingStatus FROM loads WHERE id = ? AND companyId = ?`,
    [loadId, companyId],
    (findErr, oldLoad) => {
      if (findErr) {
        console.error('Error reading load billing status:', findErr.message);
        return res.status(500).json({ error: 'Failed to update billing status.' });
      }

      if (!oldLoad) {
        return res.status(404).json({ error: 'Load not found.' });
      }

      db.run(
        `UPDATE loads SET billingStatus = ? WHERE id = ? AND companyId = ?`,
        [billingStatus, loadId, companyId],
        function updateBillingStatus(err) {
          if (err) {
            console.error('Error updating billing status:', err.message);
            return res.status(500).json({ error: 'Failed to update billing status.' });
          }

          writeAuditLog(req, {
            action: 'BILLING_STATUS_CHANGE',
            entityType: 'LOAD',
            entityId: loadId,
            entityLabel: oldLoad.containerNumber || loadId,
            oldValue: { billingStatus: oldLoad.billingStatus || '' },
            newValue: { billingStatus },
            changedFields: {
              billingStatus: {
                oldValue: oldLoad.billingStatus || '',
                newValue: billingStatus,
              },
            },
          });

          db.get(
            `SELECT * FROM loads WHERE id = ? AND companyId = ?`,
            [loadId, companyId],
            (readErr, updatedLoad) => {
              if (readErr) {
                console.error('Error reading updated billing load:', readErr.message);
                return res.status(500).json({ error: 'Billing status updated, but failed to read load.' });
              }
              res.json(updatedLoad);
            }
          );
        }
      );
    }
  );
});

app.put('/api/loads/:id/status', authenticate, (req, res) => {
  const loadId = req.params.id;
  const { status, dropDateTime, droppedBy } = req.body;
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
    const effectiveDropDateTime =
      status === 'Dropped' ? dropDateTime || new Date().toISOString() : dropDateTime || '';
    const effectiveDroppedBy =
      status === 'Dropped' ? String(isDriver ? driverId : droppedBy || '').trim() : '';

    const query = isDriver
      ? `UPDATE loads
         SET status = ?,
             dropDateTime = ?,
             availabilityStatus = '',
             droppedBy = CASE WHEN ? != '' THEN ? ELSE droppedBy END
         WHERE id = ? AND companyId = ? AND driver = ?`
      : `UPDATE loads
         SET status = ?,
             dropDateTime = ?,
             availabilityStatus = '',
             droppedBy = CASE WHEN ? != '' THEN ? ELSE droppedBy END
         WHERE id = ? AND companyId = ?`;

    const params = isDriver
      ? [status, effectiveDropDateTime, effectiveDroppedBy, effectiveDroppedBy, loadId, companyId, driverId]
      : [status, effectiveDropDateTime, effectiveDroppedBy, effectiveDroppedBy, loadId, companyId];

    db.get(
      `SELECT id, status, dropDateTime, droppedBy, availabilityStatus, containerNumber FROM loads WHERE id = ? AND companyId = ?`,
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
            dropDateTime: effectiveDropDateTime,
            droppedBy: effectiveDroppedBy || oldLoad?.droppedBy || '',
            availabilityStatus: '',
          };
          const oldStatusValue = {
            status: oldLoad?.status || '',
            dropDateTime: oldLoad?.dropDateTime || '',
            droppedBy: oldLoad?.droppedBy || '',
            availabilityStatus: oldLoad?.availabilityStatus || '',
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

          res.json({
            success: true,
            loadId,
            status,
            dropDateTime: effectiveDropDateTime,
            droppedBy: effectiveDroppedBy || oldLoad?.droppedBy || '',
            availabilityStatus: '',
          });
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
            error: 'POD is required before completing this load.',
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
          `INSERT INTO companies (id, name, email, passwordHash, createdAt, serviceStatus, subscriptionPlan, subscriptionNotes, tenantUpdatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId,
            name,
            email,
            passwordHash,
            createdAt,
            'Trial',
            'Pending Approval',
            'Created from public account request. Owner approval required before login.',
            createdAt,
          ],
          function (companyErr) {
            if (companyErr) {
              console.error('Register company insert error:', companyErr.message);
              return res.status(500).json({ error: 'Failed to create company account.' });
            }

            db.run(
              `INSERT INTO users (id, companyId, name, email, password, role, isActive)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [userId, companyId, name, email, passwordHash, 'admin', 0],
              function (userErr) {
                if (userErr) {
                  console.error('Register user insert error:', userErr.message);
                  return res.status(500).json({ error: 'Failed to create admin user.' });
                }

                res.json({
                  ok: true,
                  pendingApproval: true,
                  message: 'Account request received. PortFlow will approve access before login is enabled.',
                  company: {
                    id: companyId,
                    name,
                    email,
                    serviceStatus: 'Trial',
                    subscriptionPlan: 'Pending Approval',
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
        { companyId: company.id, email: company.email, role: String(company.email || '').trim().toLowerCase() === PORTFLOW_OWNER_EMAIL ? 'owner' : 'admin' },
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
