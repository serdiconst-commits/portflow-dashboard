import { gmail_v1, google } from 'googleapis';
import { GmailEmail } from './types.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

function getGmailClient(): gmail_v1.Gmail {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Gmail OAuth environment variables are required.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken, scope: SCOPES.join(' ') });
  return google.gmail({ version: 'v1', auth });
}

export async function fetchUnreadEmails(maxResults = 5): Promise<GmailEmail[]> {
  const gmail = getGmailClient();
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread -from:me',
    maxResults,
  });

  const messages = list.data.messages || [];
  const emails: GmailEmail[] = [];

  for (const message of messages) {
    if (!message.id) continue;
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full',
    });
    emails.push(parseGmailMessage(detail.data));
  }

  return emails;
}

export async function sendReplyEmail(approval: {
  gmailThreadId: string;
  from: string;
  to: string;
  subject: string;
  draftReply: string;
}): Promise<void> {
  const gmail = getGmailClient();
  const subject = approval.subject.toLowerCase().startsWith('re:')
    ? approval.subject
    : `Re: ${approval.subject}`;

  const rawMessage = [
    `To: ${approval.from}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    approval.draftReply,
  ].join('\r\n');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      threadId: approval.gmailThreadId,
      raw: toBase64Url(rawMessage),
    },
  });
}

export async function markEmailProcessed(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}

function parseGmailMessage(message: gmail_v1.Schema$Message): GmailEmail {
  const headers = message.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || '';

  return {
    id: requireValue(message.id, 'Missing Gmail message id.'),
    threadId: requireValue(message.threadId, 'Missing Gmail thread id.'),
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject'),
    messageId: getHeader('Message-ID'),
    references: getHeader('References'),
    body: extractBody(message.payload),
  };
}

function extractBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    const plain = payload.parts.map(extractBody).find(Boolean);
    if (plain) return plain;
  }

  if (payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  return '';
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function requireValue(value: string | null | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}
