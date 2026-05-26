import { IncomingWhatsAppMessage, PendingApproval, WhatsAppCommand } from './types.js';

const GRAPH_API_VERSION = 'v21.0';

function getWhatsAppUrl(): string {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID is required.');
  }
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

export function parseCommand(text: string): WhatsAppCommand {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper === 'SEND') return { type: 'SEND' };
  if (upper === 'SKIP') return { type: 'SKIP' };
  if (upper.startsWith('EDIT:')) {
    const editText = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    return editText ? { type: 'EDIT', text: editText } : { type: 'UNKNOWN', text };
  }

  return { type: 'UNKNOWN', text };
}

export function formatApprovalMessage(approval: PendingApproval): string {
  return [
    'PortFlow email approval',
    '',
    `From: ${approval.from}`,
    `Subject: ${approval.subject || '(no subject)'}`,
    '',
    `Summary: ${approval.summary}`,
    '',
    'Suggested reply:',
    approval.draftReply,
    '',
    'Reply with one command:',
    'SEND',
    'SKIP',
    'EDIT: <new message>',
  ].join('\n');
}

export async function sendWhatsAppText(to: string, body: string): Promise<string | undefined> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    throw new Error('WHATSAPP_TOKEN is required.');
  }

  const res = await fetch(getWhatsAppUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body,
      },
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `WhatsApp send failed with ${res.status}`);
  }

  return data.messages?.[0]?.id;
}

export function extractIncomingMessages(payload: unknown): IncomingWhatsAppMessage[] {
  const entries = asArray((payload as { entry?: unknown })?.entry);
  const messages: IncomingWhatsAppMessage[] = [];

  for (const entry of entries) {
    const changes = asArray((entry as { changes?: unknown })?.changes);
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown } }).value;
      const rawMessages = asArray(value?.messages);
      for (const rawMessage of rawMessages) {
        const message = rawMessage as {
          from?: string;
          id?: string;
          timestamp?: string;
          text?: { body?: string };
        };
        if (message.from && message.id && message.text?.body) {
          messages.push({
            from: message.from,
            id: message.id,
            text: message.text.body,
            timestamp: message.timestamp,
          });
        }
      }
    }
  }

  return messages;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
