import express from 'express';

export default function createInvoiceRoutes(db) {
  const router = express.Router();

  // GET all invoices
  router.get('/', (req, res) => {
    const companyId = req.company?.companyId;

    db.all(
      `SELECT * FROM invoices WHERE companyId = ? ORDER BY createdAt DESC, id DESC`,
      [companyId],
      (err, rows) => {
        if (err) {
          console.error('Error fetching invoices:', err.message);
          return res.status(500).json({ error: 'Failed to fetch invoices' });
        }
        res.json(rows);
      }
    );
  });

  // GET single invoice
  router.get('/:id', (req, res) => {
    const { id } = req.params;
    const companyId = req.company?.companyId;

    db.get(`SELECT * FROM invoices WHERE id = ? AND companyId = ?`, [id, companyId], (err, row) => {
      if (err) {
        console.error('Error fetching invoice:', err.message);
        return res.status(500).json({ error: 'Failed to fetch invoice' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      res.json(row);
    });
  });

  // CREATE invoice with auto invoice number
  router.post('/', (req, res) => {
    console.log('=== POST /api/invoices HIT ===');
    console.log('BODY:', req.body);

    const body = req.body || {};
    const companyId = req.company?.companyId;

    const {
  customerId = '',
  customerName = '',
  loadId = '',
  referenceNumber = '',
  poNumber = '',
  amount = '',
  status = 'Unpaid',
  paidAmount = 0,
  paymentDate = '',
  paymentMethod = '',
  paymentNotes = '',
  issueDate = '',
  dueDate = '',
  notes = '',
} = body;

    if (!customerName || amount === '') {
      return res.status(400).json({
        error: 'customerName and amount are required',
        details: `customerName="${customerName}" amount="${amount}"`,
      });
    }

    db.get(
      `SELECT * FROM invoices WHERE loadId = ? AND companyId = ?`,
      [loadId, companyId],
      (existingErr, existingInvoice) => {
        if (existingErr) {
          console.error('Error checking existing invoice:', existingErr.message);
          return res.status(500).json({
            error: 'Failed to check existing invoice',
            details: existingErr.message,
          });
        }

        if (existingInvoice) {
          return res.status(200).json(existingInvoice);
        }

        db.get(
          `SELECT invoiceNumber FROM invoices WHERE invoiceNumber LIKE 'INV-%' ORDER BY id DESC LIMIT 1`,
          [],
          (selectErr, lastInvoice) => {
            if (selectErr) {
              console.error('Error getting last invoice:', selectErr.message);
              return res.status(500).json({
                error: 'Failed to generate invoice number',
                details: selectErr.message,
              });
            }

            let nextNumber = 1001;

            if (lastInvoice?.invoiceNumber) {
              const lastNum = parseInt(
                String(lastInvoice.invoiceNumber).replace('INV-', ''),
                10
              );

              if (!Number.isNaN(lastNum)) {
                nextNumber = lastNum + 1;
              }
            }

            const newInvoiceNumber = `INV-${nextNumber}`;

  db.run(
  `INSERT INTO invoices (
    invoiceNumber,
    customerId,
    customerName,
    loadId,
    referenceNumber,
    amount,
    status,
    paidAmount,
    paymentDate,
    paymentMethod,
    paymentNotes,
    issueDate,
    dueDate,
    notes,
    companyId,
    createdAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    newInvoiceNumber,
    customerId,
    customerName,
    loadId,
    referenceNumber,
    amount,
    status,
    Number(paidAmount || 0),
    paymentDate,
    paymentMethod,
    paymentNotes,
    issueDate,
    dueDate,
    notes,
    companyId,
    new Date().toISOString()
  ],
              function (insertErr) {
                if (insertErr) {
                  console.error('Error creating invoice:', insertErr.message);
                  return res.status(500).json({
                    error: 'Failed to create invoice',
                    details: insertErr.message,
                  });
                }

                db.get(
                  `SELECT * FROM invoices WHERE id = ? AND companyId = ?`,
                  [this.lastID, companyId],
                  (fetchErr, row) => {
                    if (fetchErr) {
                      console.error('Error fetching created invoice:', fetchErr.message);
                      return res.status(500).json({
                        error: 'Invoice created but failed to fetch invoice',
                        details: fetchErr.message,
                      });
                    }

                    return res.status(201).json(row);
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  // UPDATE invoice status
  router.put('/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.company?.companyId;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    db.run(
      `UPDATE invoices SET status = ? WHERE id = ? AND companyId = ?`,
      [status, id, companyId],
      function (err) {
        if (err) {
          console.error('Error updating invoice status:', err.message);
          return res.status(500).json({ error: 'Failed to update invoice status' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Invoice not found' });
        }

        res.json({
          success: true,
          message: 'Invoice status updated successfully',
        });
      }
    );
  });

  router.put('/:id/payment', (req, res) => {
    const { id } = req.params;
    const companyId = req.company?.companyId;
    const {
      paidAmount = 0,
      paymentDate = '',
      paymentMethod = '',
      paymentNotes = '',
      status = '',
    } = req.body || {};

    const normalizedPaidAmount = Number(paidAmount || 0);
    if (Number.isNaN(normalizedPaidAmount) || normalizedPaidAmount < 0) {
      return res.status(400).json({ error: 'Paid amount must be a valid number.' });
    }

    db.get(`SELECT * FROM invoices WHERE id = ? AND companyId = ?`, [id, companyId], (findErr, invoice) => {
      if (findErr) {
        console.error('Error loading invoice for payment update:', findErr.message);
        return res.status(500).json({ error: 'Failed to load invoice' });
      }

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const invoiceAmount = Number(invoice.amount || 0);
      const nextStatus =
        status ||
        (normalizedPaidAmount >= invoiceAmount && invoiceAmount > 0
          ? 'Paid'
          : normalizedPaidAmount > 0
          ? 'Partial'
          : 'Unpaid');

      db.run(
        `UPDATE invoices
         SET paidAmount = ?,
             paymentDate = ?,
             paymentMethod = ?,
             paymentNotes = ?,
             status = ?
         WHERE id = ? AND companyId = ?`,
        [
          normalizedPaidAmount,
          String(paymentDate || ''),
          String(paymentMethod || ''),
          String(paymentNotes || ''),
          nextStatus,
          id,
          companyId,
        ],
        function (updateErr) {
          if (updateErr) {
            console.error('Error updating invoice payment:', updateErr.message);
            return res.status(500).json({ error: 'Failed to update invoice payment' });
          }

          if (this.changes === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
          }

          db.get(`SELECT * FROM invoices WHERE id = ? AND companyId = ?`, [id, companyId], (fetchErr, row) => {
            if (fetchErr) {
              console.error('Error fetching updated invoice payment:', fetchErr.message);
              return res.status(500).json({ error: 'Payment saved but failed to fetch invoice' });
            }

            return res.json(row);
          });
        }
      );
    });
  });

  return router;
}
