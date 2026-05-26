import { PendingApproval } from './types.js';

class InMemoryApprovalStore {
  private approvals = new Map<string, PendingApproval>();
  private pendingByPhone = new Map<string, string>();
  private approvalByWhatsappMessageId = new Map<string, string>();
  private processedGmailMessageIds = new Set<string>();

  createPending(input: Omit<PendingApproval, 'status' | 'createdAt' | 'updatedAt'>): PendingApproval {
    const now = new Date().toISOString();
    const approval: PendingApproval = {
      ...input,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.approvals.set(approval.approvalId, approval);
    this.processedGmailMessageIds.add(approval.gmailMessageId);
    return approval;
  }

  markWhatsappSent(approvalId: string, phone: string, whatsappMessageId?: string): void {
    const approval = this.get(approvalId);
    if (!approval) return;

    approval.whatsappMessageId = whatsappMessageId;
    approval.updatedAt = new Date().toISOString();
    this.approvals.set(approvalId, approval);
    this.pendingByPhone.set(phone, approvalId);

    if (whatsappMessageId) {
      this.approvalByWhatsappMessageId.set(whatsappMessageId, approvalId);
    }
  }

  get(approvalId: string): PendingApproval | undefined {
    return this.approvals.get(approvalId);
  }

  getLatestPendingForPhone(phone: string): PendingApproval | undefined {
    const approvalId = this.pendingByPhone.get(phone);
    const approval = approvalId ? this.approvals.get(approvalId) : undefined;
    return approval?.status === 'pending' ? approval : undefined;
  }

  getByWhatsappMessageId(messageId: string): PendingApproval | undefined {
    const approvalId = this.approvalByWhatsappMessageId.get(messageId);
    return approvalId ? this.approvals.get(approvalId) : undefined;
  }

  updateDraft(approvalId: string, draftReply: string): PendingApproval {
    const approval = this.requirePending(approvalId);
    approval.draftReply = draftReply;
    approval.updatedAt = new Date().toISOString();
    this.approvals.set(approvalId, approval);
    return approval;
  }

  markSent(approvalId: string): PendingApproval {
    const approval = this.requirePending(approvalId);
    approval.status = 'sent';
    approval.sentAt = new Date().toISOString();
    approval.updatedAt = approval.sentAt;
    this.approvals.set(approvalId, approval);
    return approval;
  }

  markSkipped(approvalId: string): PendingApproval {
    const approval = this.requirePending(approvalId);
    approval.status = 'skipped';
    approval.updatedAt = new Date().toISOString();
    this.approvals.set(approvalId, approval);
    return approval;
  }

  hasProcessedGmailMessage(gmailMessageId: string): boolean {
    return this.processedGmailMessageIds.has(gmailMessageId);
  }

  private requirePending(approvalId: string): PendingApproval {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error('No pending approval found.');
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval is already ${approval.status}.`);
    }
    return approval;
  }
}

export const store = new InMemoryApprovalStore();
