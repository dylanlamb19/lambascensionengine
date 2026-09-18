import { createHash } from "node:crypto";

export type ApprovedSnapshot = {
  recipient: string;
  subject: string;
  body: string;
  gmailThreadId: string | null;
  sequenceId: string;
  approvedAt: string;
  contentHash: string;
};

export function contentHash(recipient: string, subject: string, body: string): string {
  return createHash("sha256").update(`${recipient}\n${subject}\n${body}`).digest("hex");
}

export function freezeSnapshot(opts: {
  recipient: string;
  subject: string;
  body: string;
  gmailThreadId?: string | null;
  sequenceId: string;
  approvedAt?: Date;
}): ApprovedSnapshot {
  return {
    recipient: opts.recipient,
    subject: opts.subject,
    body: opts.body,
    gmailThreadId: opts.gmailThreadId || null,
    sequenceId: opts.sequenceId,
    approvedAt: (opts.approvedAt || new Date()).toISOString(),
    contentHash: contentHash(opts.recipient, opts.subject, opts.body),
  };
}

export function snapshotMatches(snap: ApprovedSnapshot, live: { recipient: string; subject: string; body: string }): boolean {
  return snap.contentHash === contentHash(live.recipient, live.subject, live.body);
}

/** Automation always sends the frozen snapshot, never a later draft. */
export function payloadToSend(snap: ApprovedSnapshot): { to: string; subject: string; body: string; threadId: string | null } {
  return { to: snap.recipient, subject: snap.subject, body: snap.body, threadId: snap.gmailThreadId };
}
