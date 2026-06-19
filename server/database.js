import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

sqlite3.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, 'portflow.db');

const db = new sqlite3.Database(dbPath);
console.log('DATABASE FILE:', dbPath);
function initDatabase() {
  db.serialize(() => {
    // CUSTOMERS TABLE
    db.run(`
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contactName TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    notes TEXT,
    companyId TEXT
  )
`);

// DRIVERS TABLE
db.run(`
  CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT,
    truck TEXT,
    phone TEXT,
    companyId TEXT,
    isActive INTEGER DEFAULT 1
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS driver_locations (
    driverId TEXT PRIMARY KEY,
    companyId TEXT NOT NULL,
    userId TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    heading REAL,
    speed REAL,
    source TEXT,
    updatedAt TEXT NOT NULL
  )
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_driver_locations_company_updated
  ON driver_locations(companyId, updatedAt)
`);
db.run(`
  CREATE TABLE IF NOT EXISTS fuel_transactions (
    id TEXT PRIMARY KEY,
    companyId TEXT NOT NULL,
    driverId TEXT NOT NULL,
    truckId TEXT,
    dateTime TEXT NOT NULL,
    amountPaid REAL NOT NULL,
    gallons REAL NOT NULL,
    fuelStation TEXT,
    loadNumber TEXT,
    receiptImagePath TEXT,
    receiptOriginalName TEXT,
    receiptMimeType TEXT,
    createdAt TEXT NOT NULL
  )
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_fuel_transactions_company_date
  ON fuel_transactions(companyId, dateTime)
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_fuel_transactions_driver_date
  ON fuel_transactions(driverId, dateTime)
`);
// DEFAULT DRIVERS
const defaultDrivers = [
  ['DRV-001', 'Juan Driver', 'juan@portflow.com', '1234', '104', '', 'COMP-001', 1],
  ['DRV-002', 'Carlos Driver', 'carlos@portflow.com', '1234', '105', '', 'COMP-001', 1],
  ['DRV-003', 'Miguel Driver', 'driver3@portflow.com', '1234', '106', '', 'COMP-001', 1],
  ['DRV-004', 'Luis Driver', 'driver4@portflow.com', '1234', '107', '', 'COMP-001', 1],
];

defaultDrivers.forEach((driver) => {
  db.run(
    `INSERT OR IGNORE INTO drivers
     (id, name, email, password, truck, phone, companyId, isActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    driver
  );
});

db.run(
  `UPDATE drivers
   SET email = ?
   WHERE id = ?`,
  ['juan@portflow.com', 'DRV-001'],
  (err) => {
    if (err) {
      console.error('Error updating Juan driver email:', err.message);
    } else {
      console.log('Juan driver email synced in drivers table');
    }
  }
);
db.run(`
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    type TEXT,
    customerId TEXT,
    notes TEXT,
    companyId TEXT
  )
`);

    db.run(`ALTER TABLE customers ADD COLUMN address TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding address column:', err.message);
  }
});

db.run(`ALTER TABLE customers ADD COLUMN city TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding city column:', err.message);
  }
});

db.run(`ALTER TABLE customers ADD COLUMN state TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding state column:', err.message);
  }
});

db.run(`ALTER TABLE customers ADD COLUMN zip TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding zip column:', err.message);
  }
});

db.run(`ALTER TABLE customers ADD COLUMN companyId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding companyId column to customers:', err.message);
  }
});

db.run(`ALTER TABLE locations ADD COLUMN companyId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding companyId column to locations:', err.message);
  }
});

db.run(`ALTER TABLE customers ADD COLUMN companyId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding companyId column to customers:', err.message);
  }
});

db.run(`ALTER TABLE locations ADD COLUMN companyId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding companyId column to locations:', err.message);
  }
});

db.run(
  `UPDATE customers
   SET companyId = 'COMP-001'
   WHERE companyId IS NULL OR TRIM(companyId) = ''`,
  function (err) {
    if (err) {
      console.error('Error backfilling customers companyId:', err.message);
    } else {
      console.log('Customers backfilled to COMP-001:', this.changes);
    }
  }
);

db.run(
  `UPDATE locations
   SET companyId = 'COMP-001'
   WHERE companyId IS NULL OR TRIM(companyId) = ''`,
  function (err) {
    if (err) {
      console.error('Error backfilling locations companyId:', err.message);
    } else {
      console.log('Locations backfilled to COMP-001:', this.changes);
    }
  }
);

db.run(
  `UPDATE customers
   SET companyId = 'COMP-001'
   WHERE companyId IS NULL OR companyId = ''`,
  (err) => {
    if (err) {
      console.error('Error backfilling customers companyId:', err.message);
    }
  }
);

db.run(
  `UPDATE locations
   SET companyId = 'COMP-001'
   WHERE companyId IS NULL OR companyId = ''`,
  (err) => {
    if (err) {
      console.error('Error backfilling locations companyId:', err.message);
    }
  }
);
    db.run(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )
`);
db.run(`ALTER TABLE companies ADD COLUMN logoPath TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding logoPath column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN invoiceName TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding invoiceName column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN invoiceAddress TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding invoiceAddress column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN settlementCompanyName TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding settlementCompanyName column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN podSettingsJson TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding podSettingsJson column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN portHoustonUsername TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding portHoustonUsername column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN portHoustonPassword TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding portHoustonPassword column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN portHoustonCredentialsJson TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding portHoustonCredentialsJson column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN serviceStatus TEXT DEFAULT 'Active'`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding serviceStatus column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN subscriptionPlan TEXT DEFAULT 'Demo'`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding subscriptionPlan column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN subscriptionNotes TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding subscriptionNotes column to companies:', err.message);
  }
});
db.run(`ALTER TABLE companies ADD COLUMN tenantUpdatedAt TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding tenantUpdatedAt column to companies:', err.message);
  }
});
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    companyId TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    isActive INTEGER DEFAULT 1
  )
`);
db.run(`ALTER TABLE users ADD COLUMN driverId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding driverId column to users:', err.message);
  }
});
db.run(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    companyId TEXT NOT NULL,
    userId TEXT,
    userName TEXT,
    userRole TEXT,
    action TEXT NOT NULL,
    entityType TEXT NOT NULL,
    entityId TEXT,
    entityLabel TEXT,
    oldValue TEXT,
    newValue TEXT,
    changedFields TEXT,
    ipAddress TEXT,
    userAgent TEXT,
    createdAt TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS demo_requests (
    id TEXT PRIMARY KEY,
    companyName TEXT NOT NULL,
    contactName TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    message TEXT,
    status TEXT DEFAULT 'New',
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS port_check_logs (
    id TEXT PRIMARY KEY,
    companyId TEXT NOT NULL,
    loadId TEXT,
    containerNumber TEXT,
    terminal TEXT,
    provider TEXT NOT NULL,
    requestType TEXT NOT NULL,
    status TEXT NOT NULL,
    responseJson TEXT,
    checkedByUserId TEXT,
    checkedAt TEXT NOT NULL
  )
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_port_check_logs_company_load
  ON port_check_logs(companyId, loadId, checkedAt)
`);
const createDrivers = async () => {
  const drivers = [
    { id: 'USR-DRV-001', name: 'Juan', email: 'juan@portflow.com', driverId: 'DRV-001' },
    { id: 'USR-DRV-002', name: 'Carlos', email: 'carlos@portflow.com', driverId: 'DRV-002' },
    { id: 'USR-DRV-003', name: 'Miguel', email: 'miguel@portflow.com', driverId: 'DRV-003' },
    { id: 'USR-DRV-004', name: 'Luis', email: 'luis@portflow.com', driverId: 'DRV-004' },
  ];

  for (const d of drivers) {
    const hashedPassword = await bcrypt.hash('1234', 10);

    db.run(
      `INSERT OR REPLACE INTO users (
        id,
        name,
        email,
        password,
        role,
        companyId,
        isActive,
        driverId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.id,
        d.name,
        d.email,
        hashedPassword,
        'driver',
        'COMP-001', // IMPORTANT
        1,
        d.driverId,
      ],
      (err) => {
        if (err) {
          console.error('Driver insert error:', err.message);
        } else {
          console.log(`Driver created: ${d.email}`);
        }
      }
    );
  }
};


    // LOADS TABLE
    // LOADS TABLE
db.run(`
 CREATE TABLE IF NOT EXISTS loads (
  id TEXT PRIMARY KEY,
  loadDate TEXT,
  customer TEXT,
  referenceNumber TEXT,
  poNumber TEXT,
  pickupNumber TEXT,
  returnNumber TEXT,
  reservationNumber TEXT,
  driver TEXT,
  truck TEXT,
  pickup TEXT,
  delivery TEXT,
  deliveryType TEXT,
  appointmentTime TEXT,
  eta TEXT,
  returnLocation TEXT,
  dropType TEXT,
dropLocation TEXT,
droppedBy TEXT,
  dropDateTime TEXT,
  containerNumber TEXT,
  streetTurn TEXT,
  bookingNumber TEXT,
  shipLine TEXT,
  chassisNumber TEXT,
  sealNumber TEXT,
  containerSize TEXT,
  rate TEXT,
  driverRate TEXT,
  status TEXT,
  availabilityStatus TEXT,
  paperwork TEXT,
  detention TEXT,
  lumper TEXT,
  fuelAdvance TEXT,
  settlement TEXT,
  notes TEXT,
  customerExtraChargesJson TEXT,
  companyId TEXT,
  lastFreeDay TEXT,
  carrierId TEXT
)
`);

defaultDrivers.forEach(([id, name]) => {
  db.run(
    `UPDATE loads
     SET driver = ?
     WHERE TRIM(LOWER(driver)) IN (
       TRIM(LOWER(?)),
       TRIM(LOWER(?)),
       TRIM(LOWER(?))
     )`,
    [id, name, `- ${name}`, `${id} - ${name}`]
  );

  db.run(
    `UPDATE loads
     SET droppedBy = ?
     WHERE TRIM(LOWER(droppedBy)) IN (
       TRIM(LOWER(?)),
       TRIM(LOWER(?)),
       TRIM(LOWER(?))
     )`,
    [id, name, `- ${name}`, `${id} - ${name}`]
  );
});

db.run(`ALTER TABLE loads ADD COLUMN dropType TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding dropType column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN dropLocation TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding dropLocation column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN droppedBy TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding droppedBy column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN dropDateTime TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding dropDateTime column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN shipLine TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding shipLine column:', err.message);
  }
});
db.run(`ALTER TABLE loads ADD COLUMN returnNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding returnNumber column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN reservationNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding reservationNumber column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN bookingNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding bookingNumber column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN appointmentTime TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding appointmentTime column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN eta TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding eta column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN poNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding poNumber column:', err.message);
  }
});
db.run(`ALTER TABLE loads ADD COLUMN pickupNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding pickupNumber column:', err.message);
  }
});
db.run(`ALTER TABLE loads ADD COLUMN customerExtraChargesJson TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding customerExtraChargesJson column:', err.message);
  }
});
db.run(`ALTER TABLE loads ADD COLUMN deliveryType TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding deliveryType column:', err.message);
  }
});
db.run(`ALTER TABLE loads ADD COLUMN streetTurn TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding streetTurn column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN availabilityStatus TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding availabilityStatus column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN lastFreeDay TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding lastFreeDay column:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN carrierId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding carrierId column:', err.message);
  }
});

    db.run(`ALTER TABLE loads ADD COLUMN referenceNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding referenceNumber column to loads:', err.message);
  }
});

db.run(`ALTER TABLE loads ADD COLUMN carrierId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding carrierId column to loads:', err.message);
  }
});

[
  ['payType', 'TEXT'],
  ['payPerMileRate', 'REAL DEFAULT 0'],
  ['payPerLoadRate', 'REAL DEFAULT 0'],
  ['payPercentageRate', 'REAL DEFAULT 0'],
  ['payHourlyRate', 'REAL DEFAULT 0'],
  ['dispatchPercentage', 'REAL DEFAULT 0'],
  ['driverSplitPercentage', 'REAL DEFAULT 100'],
  ['weeklyInsurance', 'REAL DEFAULT 0'],
  ['weeklyOccupationalAccident', 'REAL DEFAULT 0'],
].forEach(([column, definition]) => {
  db.run(`ALTER TABLE drivers ADD COLUMN ${column} ${definition}`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error(`Error adding ${column} column to drivers:`, err.message);
    }
  });
});

[
  ['miles', 'REAL DEFAULT 0'],
  ['tonnage', 'REAL DEFAULT 0'],
  ['movesCount', 'INTEGER DEFAULT 1'],
  ['hoursWorked', 'REAL DEFAULT 0'],
].forEach(([column, definition]) => {
  db.run(`ALTER TABLE loads ADD COLUMN ${column} ${definition}`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error(`Error adding ${column} column to loads:`, err.message);
    }
  });
});

db.run(`
  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    companyId TEXT NOT NULL,
    driverId TEXT NOT NULL,
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    status TEXT DEFAULT 'Draft',
    grossPay REAL DEFAULT 0,
    deductionsTotal REAL DEFAULT 0,
    netPay REAL DEFAULT 0,
    statementJson TEXT,
    notes TEXT,
    version INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    createdBy TEXT
  )
`);
db.run(`ALTER TABLE settlements ADD COLUMN notes TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding notes column to settlements:', err.message);
  }
});
db.run(`
  CREATE INDEX IF NOT EXISTS idx_settlements_company_driver_period
  ON settlements(companyId, driverId, periodStart, periodEnd)
`);
db.run(`
  CREATE TABLE IF NOT EXISTS settlement_loads (
    id TEXT PRIMARY KEY,
    settlementId TEXT NOT NULL,
    loadId TEXT,
    payAmount REAL DEFAULT 0,
    movesCount INTEGER DEFAULT 1,
    description TEXT,
    source TEXT DEFAULT 'auto',
    createdAt TEXT NOT NULL,
    FOREIGN KEY (settlementId) REFERENCES settlements(id) ON DELETE CASCADE
  )
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_settlement_loads_settlement
  ON settlement_loads(settlementId)
`);
db.run(`
  CREATE TABLE IF NOT EXISTS deductions (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    stage TEXT DEFAULT 'gross_adjustment',
    added_by TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE
  )
`);
db.run(`ALTER TABLE deductions ADD COLUMN stage TEXT DEFAULT 'gross_adjustment'`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding stage column to deductions:', err.message);
  }
});
db.run(`
  CREATE INDEX IF NOT EXISTS idx_deductions_settlement
  ON deductions(settlement_id)
`);
db.run(`
  CREATE TABLE IF NOT EXISTS settlement_audit_logs (
    id TEXT PRIMARY KEY,
    settlementId TEXT NOT NULL,
    action TEXT NOT NULL,
    oldValue TEXT,
    newValue TEXT,
    changedBy TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (settlementId) REFERENCES settlements(id) ON DELETE CASCADE
  )
`);

    // DOCUMENTS TABLE
    db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        loadId TEXT,
        name TEXT,
        size TEXT,
        type TEXT,
        category TEXT,
        filePath TEXT,
        uploadedAt TEXT,
        FOREIGN KEY (loadId) REFERENCES loads(id) ON DELETE CASCADE
      )
    `);

    // INVOICES TABLE
    db.run(`
  CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoiceNumber TEXT UNIQUE,
  customerId TEXT,
  customerName TEXT NOT NULL,
  loadId TEXT,
  referenceNumber TEXT,
  poNumber TEXT,
  amount REAL NOT NULL,
  status TEXT DEFAULT 'Unpaid',
  issueDate TEXT,
  dueDate TEXT,
  notes TEXT,
  companyId TEXT,
  createdAt TEXT
)
`);
db.run(`ALTER TABLE invoices ADD COLUMN companyId TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding companyId column to invoices:', err.message);
  }
});
db.run(
  `UPDATE invoices
   SET companyId = (
     SELECT loads.companyId
     FROM loads
     WHERE loads.id = invoices.loadId
   )
   WHERE companyId IS NULL OR TRIM(companyId) = ''`,
  (err) => {
    if (err) {
      console.error('Error backfilling invoices companyId:', err.message);
    }
  }
);
db.run(`ALTER TABLE invoices ADD COLUMN referenceNumber TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding referenceNumber column to invoices:', err.message);
  }
});
db.run(`ALTER TABLE invoices ADD COLUMN paidAmount REAL DEFAULT 0`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding paidAmount column to invoices:', err.message);
  }
});
db.run(`ALTER TABLE invoices ADD COLUMN paymentDate TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding paymentDate column to invoices:', err.message);
  }
});
db.run(`ALTER TABLE invoices ADD COLUMN paymentMethod TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding paymentMethod column to invoices:', err.message);
  }
});
db.run(`ALTER TABLE invoices ADD COLUMN paymentNotes TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding paymentNotes column to invoices:', err.message);
  }
});
    // Make invoiceNumber unique
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number
      ON invoices(invoiceNumber)
    `);

    // Counter table for invoice numbering
    db.run(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);

    // Start invoice counter at 1000 so first one becomes INV-1001
    db.run(`
      INSERT OR IGNORE INTO counters (name, value)
      VALUES ('invoice', 1000)
    `);

    db.run(`
  INSERT OR IGNORE INTO counters (name, value)
  VALUES ('load', 0)
`);

    // If invoices already exist, sync counter to highest invoice number
    db.get(
      `
        SELECT MAX(CAST(SUBSTR(invoiceNumber, 5) AS INTEGER)) AS maxNumber
        FROM invoices
        WHERE invoiceNumber LIKE 'INV-%'
      `,
      [],
      (err, row) => {
        if (!err && row?.maxNumber) {
          db.run(
            `
              UPDATE counters
              SET value = ?
              WHERE name = 'invoice' AND value < ?
            `,
            [row.maxNumber, row.maxNumber]
          );
        }
      }
    );
  });
}

export { db, initDatabase };
