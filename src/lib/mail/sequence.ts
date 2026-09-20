import type { FollowupRecord, InputMethod, SequenceRecord } from "./types.ts";
import { contentHash } from "./snapshot.ts";
import { idempotencyKey } from "./send.ts";

const GAPS_MS = {
  followup1: 3 * 24 * 60 * 60 * 1000,
  followup2: 7 * 24 * 60 * 60 * 1000,
  followup3: 12 * 24 * 60 * 60 * 1000,
};

export function buildSequence(opts: {
  userId: string;
  prospectUid: string;
  method: InputMethod;
  now?: Date;
  recipient: string;
  subject: string;
  bodies: { followup1: string; followup2: string; followup3: string };
  threadId?: string | null;
}): { sequence: SequenceRecord; followups: FollowupRecord[] } {
  const now = opts.now || new Date();
  const sequence: SequenceRecord = {
    id: `${opts.userId}:${opts.prospectUid}:seq`,
    userId: opts.userId,
    prospectUid: opts.prospectUid,
    status: "active",
    approvedMethod: opts.method,
  };
  const steps = ["followup1", "followup2", "followup3"] as const;
  const followups: FollowupRecord[] = steps.map((step) => ({
    id: `${sequence.id}:${step}`,
    userId: opts.userId,
    prospectUid: opts.prospectUid,
    sequenceId: sequence.id,
    step,
    dueAt: now.getTime() + GAPS_MS[step],
    status: "scheduled",
    attemptCount: 0,
    idempotencyKey: idempotencyKey(opts.userId, opts.prospectUid, step, sequence.id),
    gmailThreadId: opts.threadId,
    body: opts.bodies[step],
    subject: opts.subject.startsWith("Re:") ? opts.subject : `Re: ${opts.subject}`,
    recipient: opts.recipient,
    approvedAt: now.toISOString(),
    contentHash: contentHash(opts.recipient, opts.subject.startsWith("Re:") ? opts.subject : `Re: ${opts.subject}`, opts.bodies[step]),
  }));
  return { sequence, followups };
}

export function stopSequence(followups: FollowupRecord[], sequence: SequenceRecord, why: string): { followups: FollowupRecord[]; sequence: SequenceRecord; why: string } {
  return {
    why,
    sequence: { ...sequence, status: "stopped" },
    followups: followups.map((f) =>
      f.status === "scheduled" || f.status === "sending" ? { ...f, status: "cancelled" as const } : f,
    ),
  };
}

export function claimDue(followups: FollowupRecord[], now: number): FollowupRecord[] {
  const claimed: FollowupRecord[] = [];
  for (const f of followups) {
    if (f.status === "scheduled" && f.dueAt <= now) {
      f.status = "sending";
      f.attemptCount += 1;
      claimed.push(f);
    }
  }
  return claimed;
}
