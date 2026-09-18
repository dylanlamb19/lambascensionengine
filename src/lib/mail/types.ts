export type MailStatus =
  | "DRAFT"
  | "READY FOR REVIEW"
  | "APPROVED"
  | "SENDING"
  | "SENT"
  | "REPLIED"
  | "BOUNCED"
  | "UNSUBSCRIBED"
  | "FAILED"
  | "UNKNOWN_DELIVERY";

export type MailKind = "email" | "followup1" | "followup2" | "followup3" | "reply";

export type InputMethod = "MANUAL" | "VOICE" | "AUTOMATION" | "COMPUTER";

export type GmailSendInput = {
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
};

export type GmailSendResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; error: string; bounced?: boolean; disconnected?: boolean; timeout?: boolean };

export type GmailPort = {
  send: (input: GmailSendInput) => Promise<GmailSendResult>;
  listNewReplies?: (threadId: string, afterMessageId?: string) => Promise<{ id: string; from: string; body: string; labelIds?: string[] }[]>;
};

export type ProspectMailView = {
  uid: string;
  name: string;
  suppressed?: boolean;
  stage?: string;
  recipient?: string;
  subject?: string;
  body?: string;
  gmailThreadId?: string | null;
};

export type EmailRecord = {
  id: string;
  userId: string;
  prospectUid: string;
  threadId?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  direction: "out" | "in";
  recipient: string;
  subject: string;
  body: string;
  status: MailStatus;
  kind: MailKind;
  idempotencyKey: string;
  inputMethod: InputMethod;
  sequenceId?: string | null;
  sentAt?: string | null;
};

export type SequenceRecord = {
  id: string;
  userId: string;
  prospectUid: string;
  status: "active" | "stopped" | "completed";
  approvedMethod: InputMethod;
};

export type FollowupRecord = {
  id: string;
  userId: string;
  prospectUid: string;
  sequenceId: string;
  step: "followup1" | "followup2" | "followup3";
  dueAt: number;
  status: "scheduled" | "sending" | "sent" | "cancelled" | "failed";
  attemptCount: number;
  idempotencyKey: string;
  gmailThreadId?: string | null;
  body: string;
  subject: string;
  recipient: string;
  approvedAt?: string;
  contentHash?: string;
};

export type CalendarSlot = { start: Date; end: Date; label: string };
