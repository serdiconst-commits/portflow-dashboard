import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const clean = (value, fallback = '') => String(value ?? fallback).trim();

const drawText = (page, text, x, y, options = {}) => {
  page.drawText(clean(text), {
    x,
    y,
    size: options.size || 9,
    font: options.font,
    color: options.color || rgb(0.12, 0.16, 0.23),
  });
};

export async function buildSettlementPdf(settlement, company = {}) {
  const statement = settlement.statement || {};
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 742;

  const ensureSpace = (height = 28) => {
    if (y > 55 + height) return;
    page = pdf.addPage([612, 792]);
    y = 748;
  };
  const row = (columns, widths, isHeader = false) => {
    ensureSpace(22);
    let x = 42;
    columns.forEach((value, index) => {
      drawText(page, clean(value).slice(0, Math.max(8, Math.floor(widths[index] / 5.3))), x, y, {
        size: isHeader ? 8 : 8.5,
        font: isHeader ? bold : regular,
        color: isHeader ? rgb(1, 1, 1) : rgb(0.12, 0.16, 0.23),
      });
      x += widths[index];
    });
    if (isHeader) page.drawRectangle({ x: 38, y: y - 5, width: 536, height: 18, color: rgb(0.06, 0.46, 0.43), opacity: 1 });
    // Redraw header text above its background.
    if (isHeader) {
      x = 42;
      columns.forEach((value, index) => {
        drawText(page, clean(value), x, y, { size: 8, font: bold, color: rgb(1, 1, 1) });
        x += widths[index];
      });
    }
    y -= 20;
  };

  drawText(page, clean(company.settlementCompanyName || company.invoiceName || company.name || 'PortFlow'), 42, y, { size: 18, font: bold, color: rgb(0.06, 0.46, 0.43) });
  drawText(page, 'DRIVER SETTLEMENT', 390, y, { size: 14, font: bold });
  y -= 30;
  drawText(page, `Driver: ${statement.driver?.id || settlement.driverId} - ${statement.driver?.name || ''}`, 42, y, { size: 10, font: bold });
  drawText(page, `Period: ${settlement.periodStart} to ${settlement.periodEnd}`, 340, y, { size: 9, font: regular });
  y -= 18;
  drawText(page, `Status: ${settlement.status || statement.settlement?.status || 'Complete'}`, 42, y, { font: regular });
  drawText(page, `Statement Version: ${settlement.version || statement.settlement?.version || 1}`, 340, y, { font: regular });
  y -= 28;

  row(['Load', 'Date', 'Description', 'Moves', 'Pay'], [80, 78, 230, 58, 80], true);
  (statement.loads || []).forEach((line) => row([
    line.loadId || line.id || '',
    line.appointmentTime?.slice?.(0, 10) || line.loadDate || '',
    line.description || line.containerNumber || '',
    line.movesCount || 1,
    money(line.payAmount),
  ], [80, 78, 230, 58, 80]));

  y -= 12;
  if ((statement.deductions || []).length) {
    drawText(page, 'Adjustments and deductions', 42, y, { size: 11, font: bold });
    y -= 20;
    row(['Type', 'Description', 'Amount'], [110, 310, 106], true);
    (statement.deductions || []).forEach((item) => row([
      item.type || item.category || 'Deduction',
      item.description || item.reason || '',
      money(item.amount),
    ], [110, 310, 106]));
  }

  ensureSpace(95);
  y -= 16;
  page.drawRectangle({ x: 330, y: y - 62, width: 244, height: 78, color: rgb(0.95, 0.97, 0.98) });
  drawText(page, `Gross Pay: ${money(statement.totals?.grossPay)}`, 350, y, { size: 10, font: bold });
  y -= 20;
  drawText(page, `Deductions: ${money(statement.totals?.adjustmentsTotal || statement.totals?.deductionsTotal)}`, 350, y, { size: 10, font: regular });
  y -= 22;
  drawText(page, `NET PAY: ${money(statement.totals?.netPay)}`, 350, y, { size: 13, font: bold, color: rgb(0.06, 0.46, 0.43) });

  if (clean(settlement.notes || statement.settlement?.notes)) {
    ensureSpace(50);
    y -= 35;
    drawText(page, 'Payroll Note', 42, y, { size: 10, font: bold });
    y -= 16;
    drawText(page, clean(settlement.notes || statement.settlement?.notes).slice(0, 100), 42, y, { font: regular });
  }
  return Buffer.from(await pdf.save());
}

export async function sendSettlementEmail({ settlement, company, driver, pdfBuffer }) {
  if (!process.env.RESEND_API_KEY || !process.env.DRIVER_COMPLIANCE_FROM_EMAIL) {
    const error = new Error('Email service is not configured.');
    error.status = 503;
    throw error;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.DRIVER_COMPLIANCE_FROM_EMAIL,
      to: [driver.email],
      subject: `Driver settlement ${settlement.periodStart} to ${settlement.periodEnd}`,
      html: `<p>Hello ${clean(driver.name, 'Driver')},</p><p>Your completed driver settlement for <strong>${settlement.periodStart} to ${settlement.periodEnd}</strong> is attached.</p><p>Net pay: <strong>${money(settlement.statement?.totals?.netPay)}</strong></p><p>${clean(company.name, 'PortFlow')}</p>`,
      attachments: [{
        filename: `Settlement-${clean(driver.id || settlement.driverId)}-${settlement.periodStart}-${settlement.periodEnd}.pdf`,
        content: pdfBuffer.toString('base64'),
      }],
    }),
  });
  if (!response.ok) {
    const error = new Error(`Email provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    error.status = 502;
    throw error;
  }
  return response.json();
}
