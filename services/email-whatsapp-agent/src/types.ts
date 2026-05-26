export type GmailEmail = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  references?: string;
};

export type DraftResult = {
  summary: string;
  suggestedReply: string;
};

export type ApprovalStatus = 'pending' | 'sent' | 'skipped';

export type PendingApproval = {
  approvalId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  from: string;
  to: string;
  subject: string;
  originalBody: string;
  summary: string;
  draftReply: string;
  whatsappMessageId?: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type WhatsAppCommand =
  | { type: 'SEND' }
  | { type: 'SKIP' }
  | { type: 'EDIT'; text: string }
  | { type: 'UNKNOWN'; text: string };

export type IncomingWhatsAppMessage = {
  from: string;
  id: string;
  text: string;
  timestamp?: string;
};
