import crypto from 'node:crypto';
import { fetchUnreadEmails, markEmailProcessed, sendReplyEmail } from './gmail.js';
import { summarizeAndDraftReply } from './openai.js';
import { store } from './store.js';
import { IncomingWhatsAppMessage } from './types.js';
import {
  extractIncomingMessages,
  formatApprovalMessage,
  parseCommand,
  sendWhatsAppText,
} from './whatsapp.js';

export async function processUnreadEmails(): Promise<{ processed: number }> {
  const targetNumber = process.env.MY_WHATSAPP_NUMBER;
  if (!targetNumber) {
    throw new Error('MY_WHATSAPP_NUMBER is required.');
  }

  const emails = await fetchUnreadEmails();
  let processed = 0;

  for (const email of emails) {
    if (store.hasProcessedGmailMessage(email.id)) continue;

    const draft = await summarizeAndDraftReply(email);
    const approval = store.createPending({
      approvalId: crypto.randomUUID(),
      gmailMessageId: email.id,
      gmailThreadId: email.threadId,
      from: email.from,
      to: email.to,
      subject: email.subject,
      originalBody: email.body,
      summary: draft.summary,
      draftReply: draft.suggestedReply,
    });

    const whatsappMessageId = await sendWhatsAppText(targetNumber, formatApprovalMessage(approval));
    store.markWhatsappSent(approval.approvalId, targetNumber, whatsappMessageId);
    await markEmailProcessed(email.id);
    processed += 1;
  }

  return { processed };
}

export async function handleWhatsAppWebhook(payload: unknown): Promise<void> {
  const messages = extractIncomingMessages(payload);

  for (const message of messages) {
    await handleIncomingWhatsAppMessage(message);
  }
}

async function handleIncomingWhatsAppMessage(message: IncomingWhatsAppMessage): Promise<void> {
  const command = parseCommand(message.text);
  const approval =
    store.getByWhatsappMessageId(message.id) || store.getLatestPendingForPhone(message.from);

  if (!approval) {
    await sendWhatsAppText(message.from, 'No pending PortFlow email approval was found.');
    return;
  }

  if (command.type === 'SEND') {
    await sendReplyEmail(approval);
    store.markSent(approval.approvalId);
    await sendWhatsAppText(
      message.from,
      `Sent Gmail reply for: ${approval.subject || approval.gmailMessageId}`,
    );
    return;
  }

  if (command.type === 'EDIT') {
    const updated = store.updateDraft(approval.approvalId, command.text);
    await sendWhatsAppText(
      message.from,
      [
        'Draft updated. Reply SEND to send it, or SKIP to ignore.',
        '',
        'Updated draft:',
        updated.draftReply,
      ].join('\n'),
    );
    return;
  }

  if (command.type === 'SKIP') {
    store.markSkipped(approval.approvalId);
    await sendWhatsAppText(message.from, `Skipped email: ${approval.subject || approval.gmailMessageId}`);
    return;
  }

  await sendWhatsAppText(
    message.from,
    'Command not recognized. Reply SEND, SKIP, or EDIT: <new message>.',
  );
}
