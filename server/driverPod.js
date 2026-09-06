import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const signedPodSchema = `CREATE TABLE IF NOT EXISTS signed_pods (
  id TEXT PRIMARY KEY, companyId TEXT NOT NULL, loadId TEXT NOT NULL,
  driverId TEXT NOT NULL, payloadHash TEXT NOT NULL, signedAt TEXT NOT NULL,
  documentId TEXT NOT NULL, createdAt TEXT NOT NULL
)`;
export const podEmailSchema = `CREATE TABLE IF NOT EXISTS pod_emails (
  id TEXT PRIMARY KEY, podId TEXT NOT NULL, recipient TEXT NOT NULL,
  providerId TEXT, createdAt TEXT NOT NULL
)`;

export function validatePod(body = {}) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId || '')) fail('Please reopen the POD form and try again.');
  const receiverName = String(body.receiverName || '').trim();
  const notes = String(body.notes || '').trim();
  if (!receiverName || receiverName.length > 100) fail('Enter the receiver name (up to 100 characters).');
  if (notes.length > 600) fail('Delivery notes must be 600 characters or fewer.');
  const time = Date.parse(body.signedAt);
  if (!Number.isFinite(time) || time > Date.now() + 300000) fail('The signature date is invalid. Check the device clock.');
  const signature = body.signature;
  if (!Array.isArray(signature) || !signature.length || signature.length > 100) fail('Receiver signature is required.');
  let count = 0;
  let distance = 0;
  for (const stroke of signature) {
    if (!Array.isArray(stroke) || !stroke.length) fail('Invalid signature. Please sign again.');
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) fail('Invalid signature. Please sign again.');
      if (++count > 5000) fail('Signature is too large. Clear it and sign again.');
      if (i) distance += Math.hypot(p.x - stroke[i - 1].x, p.y - stroke[i - 1].y);
    }
  }
  if (count < 3 || distance < 0.04) fail('Receiver signature is required.');
  return { requestId: body.requestId, receiverName, notes, signedAt: new Date(time).toISOString(), signature: signature.map(s => s.map(({x,y}) => ({x,y}))) };
}

export async function buildSignedPodPdf({ load, company, driverName, pod }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.06, 0.14, 0.23), teal = rgb(0.02, 0.48, 0.43), muted = rgb(0.36, 0.42, 0.48);
  const printable = text => [...String(text || '—')].map(c => { try { font.encodeText(c); return c; } catch { return '?'; } }).join('');
  let page, y;
  const newPage = () => {
    page = pdf.addPage([612, 792]); y = 644;
    page.drawRectangle({ x: 0, y: 686, width: 612, height: 106, color: navy });
    page.drawText('PROOF OF DELIVERY', { x: 40, y: 738, font: bold, size: 22, color: rgb(1,1,1) });
    page.drawText(printable(`Load # ${load.id}  |  ${load.containerNumber || 'No container'}`), { x: 40, y: 712, font, size: 11, color: rgb(0.75,0.9,0.88) });
  };
  newPage();
  const wrap = (text, width, size) => {
    const lines = []; let line = '';
    for (const char of printable(text).replace(/\r/g, '')) {
      if (char === '\n' || font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = char === '\n' ? '' : char; }
      else line += char;
    }
    if (line) lines.push(line);
    return lines;
  };
  const block = (label, value) => {
    const lines = wrap(value, 528, 10);
    if (y - (lines.length * 14 + 32) < 60) newPage();
    page.drawText(label.toUpperCase(), { x: 42, y, font: bold, size: 8, color: teal }); y -= 17;
    for (const line of lines) {
      if (y < 60) { newPage(); page.drawText(`${label.toUpperCase()} (CONTINUED)`, {x:42,y,font:bold,size:8,color:teal}); y -= 17; }
      page.drawText(line, { x: 42, y, font, size: 10, color: navy }); y -= 14;
    }
    y -= 13;
  };
  block('Carrier', company.invoiceName || company.name || 'PortFlow');
  block('Customer / reference', [load.customer, load.referenceNumber].filter(Boolean).join(' / '));
  block('Delivery location', load.deliveryLocationName ? `${load.deliveryLocationName} — ${load.delivery || ''}` : load.delivery);
  block('Driver', driverName);
  let timezone = company.companyTimezone || 'America/Chicago';
  try { new Intl.DateTimeFormat('en-US', {timeZone: timezone}); } catch { timezone = 'America/Chicago'; }
  const displayTime = new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short', timeZone: timezone}).format(new Date(pod.signedAt));
  block('Received by / signed at', `${pod.receiverName} — ${displayTime} (${timezone})`);
  if (pod.notes) block('Delivery notes / exceptions', pod.notes);
  if (y < 230) newPage();
  page.drawText('RECEIVER SIGNATURE', {x: 42, y, size: 8, font: bold, color: teal}); y -= 150;
  page.drawRectangle({x: 40, y, width: 532, height: 135, color: rgb(0.97,0.98,0.99), borderColor: rgb(0.82,0.87,0.9), borderWidth: 1});
  for (const stroke of pod.signature) for (let i = 1; i < stroke.length; i++) {
    page.drawLine({start: {x: 54 + stroke[i-1].x * 504, y: y + 10 + (1-stroke[i-1].y)*115}, end: {x: 54 + stroke[i].x*504, y: y + 10 + (1-stroke[i].y)*115}, thickness: 1.8, color: navy});
  }
  page.drawText('Receipt acknowledged, subject to the delivery notes above.', {x:42,y:y-17,font,size:8,color:muted});
  for (const [index, p] of pdf.getPages().entries()) p.drawText(`PortFlow  |  Signed POD  |  ${index + 1} / ${pdf.getPageCount()}`, {x:42,y:30,font,size:8,color:muted});
  pdf.setTitle(`Signed POD - ${load.id}`);
  pdf.setSubject(`Receiver: ${pod.receiverName}; signed ${pod.signedAt}`);
  return Buffer.from(await pdf.save());
}

export async function sendPodEmail({ recipient, filename, buffer, loadId, idempotencyKey }) {
  const from = process.env.POD_FROM_EMAIL || process.env.DRIVER_COMPLIANCE_FROM_EMAIL;
  if (!process.env.RESEND_API_KEY || !from) throw Object.assign(new Error('Email is not configured. Your POD is saved; contact dispatch to send it.'), {status: 503, notAttempted: true});
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: {Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key': idempotencyKey},
    body: JSON.stringify({from, to:[recipient], subject:`Proof of delivery — Load ${loadId}`, text:`The signed proof of delivery for load ${loadId} is attached.\n\nPlease contact the carrier with any questions.`, attachments:[{filename,content:buffer.toString('base64')}]}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw Object.assign(new Error('Email was not confirmed. Your POD is saved; please retry.'), {status: 502});
  return data.id;
}
