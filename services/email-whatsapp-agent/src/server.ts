import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import { processUnreadEmails } from './agent.js';
import { webhookRouter } from './routes/webhook.js';
import { sendWhatsAppText } from './whatsapp.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(webhookRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'email-whatsapp-agent' });
});

app.post('/test-whatsapp', async (_req, res, next) => {
  const to = process.env.MY_WHATSAPP_NUMBER;
  const message = 'Porflow AI email agent connected successfully';

  if (!to) {
    const error = new Error('MY_WHATSAPP_NUMBER is required.');
    console.error('[test-whatsapp] Missing MY_WHATSAPP_NUMBER.');
    next(error);
    return;
  }

  console.log(`[test-whatsapp] Sending test WhatsApp message to ${to}.`);

  try {
    const whatsappMessageId = await sendWhatsAppText(to, message);
    console.log(
      `[test-whatsapp] Message sent successfully${
        whatsappMessageId ? ` with id ${whatsappMessageId}` : ''
      }.`,
    );
    res.json({
      ok: true,
      to,
      whatsappMessageId,
      message,
    });
  } catch (error) {
    console.error('[test-whatsapp] Failed to send WhatsApp message:', error);
    next(error);
  }
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

app.listen(port, () => {
  console.log(`email-whatsapp-agent listening on port ${port}`);
});

const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 60_000);
setInterval(() => {
  processUnreadEmails().catch((error) => {
    console.error('Email polling failed:', error);
  });
}, pollIntervalMs);
