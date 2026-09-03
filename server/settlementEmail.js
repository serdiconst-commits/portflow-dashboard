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
  let y = 720;
  const navy = rgb(0.04, 0.12, 0.2);
  const teal = rgb(0.04, 0.55, 0.5);
  const slate = rgb(0.38, 0.45, 0.54);
  const pale = rgb(0.95, 0.98, 0.98);

  const ensureSpace = (height = 28) => {
    if (y > 62 + height) return;
    page = pdf.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 764, width: 612, height: 28, color: navy });
    drawText(page, clean(company.settlementCompanyName || company.invoiceName || company.name || 'PortFlow'), 38, 774, { size: 9, font: bold, color: rgb(1, 1, 1) });
    drawText(page, `Settlement ${clean(settlement.id).slice(0, 8).toUpperCase()}`, 440, 774, { size: 8, font: regular, color: rgb(1, 1, 1) });
    y = 738;
  };
  const row = (columns, widths, isHeader = false, shaded = false) => {
    ensureSpace(25);
    if (isHeader || shaded) {
      page.drawRectangle({ x: 38, y: y - 6, width: 536, height: 20, color: isHeader ? navy : pale });
    }
    let x = 42;
    columns.forEach((value, index) => {
      drawText(page, clean(value).slice(0, Math.max(8, Math.floor(widths[index] / 5.3))), x, y, {
        size: isHeader ? 8 : 8.5,
        font: isHeader ? bold : regular,
        color: isHeader ? rgb(1, 1, 1) : navy,
      });
      x += widths[index];
    });
    y -= 20;
  };

  page.drawRectangle({ x: 0, y: 690, width: 612, height: 102, color: navy });
  drawText(page, clean(company.settlementCompanyName || company.invoiceName || company.name || 'PortFlow'), 38, 751, { size: 20, font: bold, color: rgb(1, 1, 1) });
  drawText(page, 'DRIVER SETTLEMENT', 38, 725, { size: 10, font: bold, color: teal });
  drawText(page, `#${clean(settlement.id).slice(0, 8).toUpperCase()}`, 478, 748, { size: 10, font: bold, color: rgb(1, 1, 1) });
  y = 656;
  drawText(page, 'DRIVER', 42, y, { size: 7, font: bold, color: slate });
  drawText(page, 'PAY PERIOD', 264, y, { size: 7, font: bold, color: slate });
  drawText(page, 'STATUS', 468, y, { size: 7, font: bold, color: slate });
  y -= 16;
  drawText(page, `${statement.driver?.id || settlement.driverId} - ${statement.driver?.name || ''}`, 42, y, { size: 10, font: bold, color: navy });
  drawText(page, `${settlement.periodStart} to ${settlement.periodEnd}`, 264, y, { size: 9, font: bold, color: navy });
  drawText(page, settlement.status || statement.settlement?.status || 'Draft', 468, y, { size: 9, font: bold, color: teal });
  y -= 34;

  drawText(page, 'COMPLETED MOVES & PAY', 42, y, { size: 10, font: bold, color: navy });
  y -= 20;
  row(['Date', 'Container / Load', 'Movement & Route', 'Pay'], [76, 120, 250, 80], true);
  (statement.loads || []).forEach((line, index) => row([
    line.completedAt?.slice?.(0, 10) || line.appointmentTime?.slice?.(0, 10) || '',
    line.containerNumber || line.loadId || '',
    [clean(line.moveType).replaceAll('_', ' '), [line.moveOrigin, line.moveDestination].filter(Boolean).join(' to ') || line.description].filter(Boolean).join(' - '),
    money(line.payAmount),
  ], [76, 120, 250, 80], false, index % 2 === 1));

  y -= 12;
  const adjustments = [...(statement.deductions || []), ...(statement.netDeductions || [])];
  if (adjustments.length) {
    drawText(page, 'ADJUSTMENTS & DEDUCTIONS', 42, y, { size: 10, font: bold, color: navy });
    y -= 20;
    row(['Type', 'Description', 'Amount'], [110, 310, 106], true);
    adjustments.forEach((item, index) => row([
      Number(item.amount) < 0 ? 'Deduction' : 'Additional pay',
      item.description || item.reason || '',
      money(item.amount),
    ], [110, 310, 106], false, index % 2 === 1));
  }

  ensureSpace(118);
  y -= 18;
  page.drawRectangle({ x: 318, y: y - 78, width: 256, height: 96, color: pale, borderColor: rgb(0.82, 0.9, 0.9), borderWidth: 1 });
  drawText(page, 'SETTLEMENT SUMMARY', 338, y, { size: 8, font: bold, color: slate });
  y -= 20;
  drawText(page, `Gross pay`, 338, y, { size: 9, font: regular, color: slate });
  drawText(page, money(statement.totals?.grossPay), 496, y, { size: 9, font: bold, color: navy });
  y -= 17;
  drawText(page, `Adjustments`, 338, y, { size: 9, font: regular, color: slate });
  drawText(page, money(statement.totals?.adjustmentsTotal), 496, y, { size: 9, font: bold, color: navy });
  y -= 17;
  drawText(page, `Net deductions`, 338, y, { size: 9, font: regular, color: slate });
  drawText(page, money(-(statement.totals?.netDeductionsTotal || 0)), 496, y, { size: 9, font: bold, color: navy });
  y -= 20;
  drawText(page, `NET PAY`, 338, y, { size: 11, font: bold, color: navy });
  drawText(page, money(statement.totals?.netPay), 478, y, { size: 13, font: bold, color: teal });

  if (clean(settlement.notes || statement.settlement?.notes)) {
    ensureSpace(66);
    y -= 38;
    drawText(page, 'PAYROLL NOTE', 42, y, { size: 9, font: bold, color: navy });
    y -= 16;
    const note = clean(settlement.notes || statement.settlement?.notes);
    drawText(page, note.slice(0, 94), 42, y, { font: regular, color: slate });
    if (note.length > 94) {
      y -= 14;
      drawText(page, note.slice(94, 188), 42, y, { font: regular, color: slate });
    }
  }
  drawText(page, `Generated by PortFlow • Version ${settlement.version || statement.settlement?.version || 1}`, 42, 36, { size: 7, font: regular, color: slate });
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
      html: `<div style="font-family:Arial,sans-serif;color:#0b1f33;max-width:560px"><h2 style="margin:0 0 8px">Your driver settlement is ready</h2><p>Hello ${clean(driver.name, 'Driver')},</p><p>Your ${clean(settlement.status, 'reviewed').toLowerCase()} driver settlement for <strong>${settlement.periodStart} to ${settlement.periodEnd}</strong> is attached.</p><div style="background:#f0faf9;border-left:4px solid #0b8c80;padding:14px 18px;margin:18px 0"><span style="color:#64748b">Net pay</span><br><strong style="font-size:24px">${money(settlement.statement?.totals?.netPay)}</strong></div><p>Please contact payroll if you have any questions.</p><p>${clean(company.settlementCompanyName || company.name, 'PortFlow')}</p></div>`,
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
