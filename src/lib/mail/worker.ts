import { canSend } from "./guard.ts";
import { DEFAULT_HOURS, nextWorkingInstant, type HoursConfig } from "./hours.ts";
import { payloadToSend, type ApprovedSnapshot } from "./snapshot.ts";
import type { ProspectMailView } from "./types.ts";
import { inboundReplies, type ThreadMessage } from "./inbound.ts";
import { ingestReply } from "./replies.ts";
import { stopSequence } from "./sequence.ts";
import type { FollowupRecord, SequenceRecord } from "./types.ts";

export type DueJob = {
  id: string;
  prospectUid: string;
  snapshot: ApprovedSnapshot;
  sequence: SequenceRecord;
  followup: FollowupRecord;
};

export async function runOutreachTick(opts: {
  syncReplies: () => Promise<void>;
  claimDue: () => Promise<DueJob[]>;
  send: (job: DueJob) => Promise<"sent" | "rescheduled" | "cancelled" | "failed" | "unknown">;
}): Promise<{ sent: number; skipped: number; rescheduled: number }> {
  await opts.syncReplies();
  const due = await opts.claimDue();
  let sent = 0;
  let skipped = 0;
  let rescheduled = 0;
  for (const job of due) {
    const result = await opts.send(job);
    if (result === "sent") sent += 1;
    else if (result === "rescheduled") rescheduled += 1;
    else skipped += 1;
  }
  return { sent, skipped, rescheduled };
}

export function decideFollowupSend(opts: {
  prospect: ProspectMailView;
  sequenceActive: boolean;
  snapshot: ApprovedSnapshot;
  now: Date;
  hours: HoursConfig;
  gmailConnected: boolean;
  testMode?: boolean;
  allowlist?: string[];
}): { action: "send" | "reschedule" | "cancel"; dueAt?: Date; reason: string } {
  if (!opts.sequenceActive || opts.prospect.suppressed || opts.prospect.stage === "Do Not Contact") {
    return { action: "cancel", reason: "Sequence stopped. Follow-up was not sent." };
  }
  const gate = canSend({
    prospect: opts.prospect,
    gmailConnected: opts.gmailConnected,
    recipient: opts.snapshot.recipient,
    kind: "followup1",
    method: "AUTOMATION",
    firstApproved: true,
    sequenceActive: true,
    bounced: false,
    unsubscribed: false,
    usage: { first: 0, followups: 0 },
    caps: { maxFirst: 999, maxFollowups: 999 },
    now: opts.now,
    hours: opts.hours || DEFAULT_HOURS,
    threadId: opts.snapshot.gmailThreadId,
    testMode: opts.testMode,
    allowlist: opts.allowlist,
  });
  if (!gate.ok && gate.code === "OUTSIDE_HOURS") {
    return { action: "reschedule", dueAt: nextWorkingInstant(opts.now, opts.hours || DEFAULT_HOURS), reason: "Outside working hours. Waiting until the next work window." };
  }
  if (!gate.ok) return { action: "cancel", reason: gate.code };
  return { action: "send", reason: "ok" };
}

export function processThread(opts: {
  messages: ThreadMessage[];
  outboundIds: Set<string>;
  ownerEmail: string;
  sequence: SequenceRecord;
  followups: FollowupRecord[];
  alreadySeen: Set<string>;
}): { replies: number; sequence: SequenceRecord; followups: FollowupRecord[] } {
  const inbound = inboundReplies(opts.messages, { outboundIds: opts.outboundIds, ownerEmail: opts.ownerEmail });
  let sequence = opts.sequence;
  let followups = opts.followups;
  let replies = 0;
  for (const m of inbound) {
    const r = ingestReply({
      inbound: { id: m.id, from: m.from, body: m.body },
      sequence,
      followups,
      alreadySeen: opts.alreadySeen,
    });
    if (r.duplicate) continue;
    replies += 1;
    sequence = r.sequence;
    followups = r.followups;
  }
  if (replies === 0) return { replies: 0, sequence, followups };
  const stopped = stopSequence(followups, sequence, "reply");
  return { replies, sequence: stopped.sequence, followups: stopped.followups };
}

export { payloadToSend };
