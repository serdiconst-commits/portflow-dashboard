import { Router } from 'express';
import { handleWhatsAppWebhook, processUnreadEmails } from '../agent.js';

export const webhookRouter = Router();

webhookRouter.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

webhookRouter.post('/webhook/whatsapp', async (req, res, next) => {
  try {
    await handleWhatsAppWebhook(req.body);
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

webhookRouter.post('/agent/poll', async (_req, res, next) => {
  try {
    const result = await processUnreadEmails();
    res.json(result);
  } catch (error) {
    next(error);
  }
});
