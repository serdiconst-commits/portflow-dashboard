import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildSettlementPdf } from '../settlementEmail.js';

test('modern settlement PDF renders movement pay and adjustments', async () => {
  const buffer = await buildSettlementPdf({
    id: 'SETTLEMENT-1234',
    driverId: 'DRV-1',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-07',
    status: 'Reviewed',
    version: 3,
    notes: 'Reviewed with the driver before payroll.',
    statement: {
      driver: { id: 'DRV-1', name: 'Test Driver' },
      loads: [{
        loadId: 'LOAD-1', containerNumber: 'MSBU1599154', completedAt: '2026-09-02T10:00:00Z',
        moveType: 'PICKUP_RETURN', moveOrigin: 'Customer Yard', moveDestination: 'Bayport Terminal', payAmount: 225,
      }],
      deductions: [{ description: 'Parking reimbursement', amount: 25 }],
      netDeductions: [{ description: 'Insurance', amount: -50 }],
      totals: { grossPay: 225, adjustmentsTotal: 25, netDeductionsTotal: 50, netPay: 200 },
    },
  }, { settlementCompanyName: 'Liberty Container Transport LLC' });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1200);
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPageCount(), 1);
});
