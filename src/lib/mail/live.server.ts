import type { Prospect } from "@/lib/review-brief";
import { liveGmail } from "../google/gmail";
import { refreshAccess, ensureFreshAccess, type GoogleTokens } from "../google/oauth";
import { classifyReply, draftReply } from "../outreach/reply";
import { sendMail, idempotencyKey } from "./send";
import type { InputMethod, MailKind } from "./types";
import {
  activeSequence,
  audit,
  claimDueFollowups,
  finishFollowup,
  getUsage,
  insertReply,
  lastThread,
  listGmailUsers,
  listOpenThreads,
  loadSettings,
  loadTokens,
  markGoogleError,
  markTestWorkflowSeen,
  outboundMessageIds,
  startWorkerHeartbeat,
  finishWorkerHeartbeat,
  reserveSendCap,
  reserveSendKey,
  saveGoogleAccount,
  seenReplyIds,
  stopSequencesForProspect,
  updateMessageStatus,
  countScheduledFollowups,
} from "./sql.server";
import { getProspectByUid } from "@/lib/prospects/repo.server";
import { emailCannotBecomeCommand } from "./untrusted";
import { inboundReplies } from "./inbound";
import { decideFollowupSend } from "./worker";
import { freezeSnapshot } from "./snapshot";
import { allowSendRecipient, effectiveCaps } from "./test-mode";
import { isTestWorkflowUid } from "./test-loop";
import type { OauthKind } from "./oauth-state";

export async function accessFor(userId: string, kind: OauthKind = "gmail"): Promise<GoogleTokens | null> {
  const tokens = await loadTokens(userId, kind);
  if (!tokens) return null;
  const fresh = await ensureFreshAccess(tokens, (rt) => refreshAccess(rt));
  if (!fresh.ok) {
    await markGoogleError(userId, kind, kind === "calendar" ? "Calendar needs to be reconnected." : "Gmail needs to be reconnected.");
    return null;
  }
  if (fresh.refreshed) await saveGoogleAccount(userId, kind, fresh.tokens);
  return fresh.tokens;
}

export async function sendLive(opts: {
  userId: string;
  prospect: Prospect;
  kind: MailKind;
  method: InputMethod;
  to: string;
  subject: string;
  body: string;
  firstApproved: boolean;
  threadId?: string | null;
  sequenceId?: string | null;
}): Promise<{ ok: true; threadId: string; messageId: string } | { ok: false; reason: string; code?: string }> {
  const uid = opts.prospect.uid || "";
  const tokens = await accessFor(opts.userId, "gmail");
  const usage = await getUsage(opts.userId);
  const settings = await loadSettings(opts.userId);
  const allow = allowSendRecipient({ testMode: settings.testMode, allowlist: settings.allowlist, recipient: opts.to });
  if (!allow.ok) {
    await audit(opts.userId, "send_blocked", allow.reason, { prospectUid: uid, method: opts.method });
    return { ok: false, reason: allow.reason, code: "NOT_ALLOWLISTED" };
  }
  const caps = effectiveCaps(settings);
  const seq = await activeSequence(opts.userId, uid);
  const key = idempotencyKey(opts.userId, uid, opts.kind, opts.sequenceId || undefined);
  const gmail = tokens ? liveGmail(tokens.access_token) : null;
  const testRecord = isTestWorkflowUid(uid);
  const result = await sendMail({
    userId: opts.userId,
    prospect: {
      uid,
      name: opts.prospect.name,
      suppressed: opts.prospect.suppressed,
      stage: opts.prospect.stage,
    },
    kind: opts.kind,
    method: opts.method,
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    threadId: opts.threadId || (await lastThread(opts.userId, uid)),
    sequenceId: opts.sequenceId,
    deps: {
      gmail,
      gmailConnected: Boolean(tokens),
      usage,
      caps,
      hours: {
        workStart: settings.workStart,
        workEnd: settings.workEnd,
        workDays: settings.workDays,
        timezone: settings.timezone,
      },
      firstApproved: opts.firstApproved,
      sequenceActive: seq || opts.kind === "email",
      bounced: false,
      unsubscribed: opts.prospect.stage === "Do Not Contact",
      existingKeys: new Set(),
      testMode: settings.testMode,
      allowlist: settings.allowlist,
      reserveKey: async () =>
        reserveSendKey(opts.userId, key, {
          prospectUid: uid,
          recipient: opts.to,
          subject: opts.subject,
          body: opts.body,
          kind: opts.kind,
          inputMethod: opts.method,
          sequenceId: opts.sequenceId,
        }),
      reserveCap: (k) => reserveSendCap(opts.userId, k, {
        ...caps,
        minDelayMinutes: testRecord ? 0 : settings.minDelayMinutes,
      }),
      skipHours: testRecord,
    },
  });
  if (!result.ok) {
    if (result.record) {
      await updateMessageStatus(opts.userId, key, result.record.status);
    }
    await audit(opts.userId, "send_failed", result.reason, { prospectUid: uid, method: opts.method });
    return { ok: false, reason: result.reason, code: result.code };
  }
  await updateMessageStatus(opts.userId, key, "SENT", result.record.gmailMessageId || undefined, result.record.gmailThreadId || undefined);
  await audit(opts.userId, "sent", `${opts.kind} sent`, {
    prospectUid: uid,
    method: opts.method,
    providerIds: result.record.gmailMessageId || "",
  });
  return { ok: true, threadId: result.record.gmailThreadId || "", messageId: result.record.gmailMessageId || "" };
}

export async function runDueFollowups(): Promise<{ sent: number; skipped: number; rescheduled: number }> {
  const due = await claimDueFollowups();
  let sent = 0;
  let skipped = 0;
  let rescheduled = 0;
  for (const job of due) {
    const prospect = await getProspectByUid(job.user_id, job.prospect_uid);
    const settings = await loadSettings(job.user_id);
    const seq = await activeSequence(job.user_id, job.prospect_uid);
    const snapshot = freezeSnapshot({
      recipient: job.recipient,
      subject: job.subject,
      body: job.body,
      gmailThreadId: job.gmail_thread_id,
      sequenceId: job.sequence_id,
    });
    snapshot.contentHash = job.content_hash || snapshot.contentHash;
    if (isTestWorkflowUid(job.prospect_uid)) {
      await audit(job.user_id, "worker_claimed", `${job.step} claimed by worker`, {
        prospectUid: job.prospect_uid,
        method: "AUTOMATION",
        sequenceId: job.sequence_id,
      });
    }
    const decision = decideFollowupSend({
      prospect: prospect
        ? { uid: prospect.uid || job.prospect_uid, name: prospect.name, suppressed: prospect.suppressed, stage: prospect.stage }
        : { uid: job.prospect_uid, name: "UNKNOWN", suppressed: true },
      sequenceActive: seq,
      snapshot,
      now: new Date(),
      hours: {
        workStart: settings.workStart,
        workEnd: settings.workEnd,
        workDays: settings.workDays,
        timezone: settings.timezone,
      },
      gmailConnected: Boolean(await loadTokens(job.user_id, "gmail")),
      testMode: settings.testMode,
      allowlist: settings.allowlist,
      skipHours: isTestWorkflowUid(job.prospect_uid),
    });
    if (decision.action === "reschedule") {
      await finishFollowup(job.id, "scheduled", decision.dueAt);
      rescheduled += 1;
      continue;
    }
    if (decision.action === "cancel" || !prospect) {
      await finishFollowup(job.id, "cancelled");
      skipped += 1;
      continue;
    }
    const result = await sendLive({
      userId: job.user_id,
      prospect,
      kind: job.step as MailKind,
      method: "AUTOMATION",
      to: snapshot.recipient,
      subject: snapshot.subject,
      body: snapshot.body,
      firstApproved: true,
      threadId: snapshot.gmailThreadId,
      sequenceId: job.sequence_id,
    });
    if (result.ok) {
      await finishFollowup(job.id, "sent");
      sent += 1;
      if (isTestWorkflowUid(job.prospect_uid)) {
        await audit(job.user_id, "test_followup_sent", `${job.step} sent by worker`, {
          prospectUid: job.prospect_uid,
          method: "AUTOMATION",
          sequenceId: job.sequence_id,
          providerIds: result.messageId,
        });
      }
    } else if (/working hours|wait/i.test(result.reason)) {
      await finishFollowup(job.id, "scheduled", decision.dueAt);
      rescheduled += 1;
    } else if (result.code === "UNKNOWN_DELIVERY") {
      await finishFollowup(job.id, "failed");
      await audit(job.user_id, "UNKNOWN_DELIVERY", result.reason, {
        prospectUid: job.prospect_uid,
        method: "AUTOMATION",
        sequenceId: job.sequence_id,
      });
      skipped += 1;
    } else {
      await finishFollowup(job.id, "failed");
      skipped += 1;
    }
  }
  return { sent, skipped, rescheduled };
}

export async function syncRepliesForUser(userId: string): Promise<{ ok: true; replies: number }> {
  const tokens = await accessFor(userId, "gmail");
  if (!tokens) return { ok: true, replies: 0 };
  const gmail = liveGmail(tokens.access_token);
  const threads = await listOpenThreads(userId);
  const seen = await seenReplyIds(userId);
  const outbound = await outboundMessageIds(userId);
  let n = 0;
  for (const t of threads) {
    const msgs = (await gmail.listNewReplies?.(t.gmail_thread_id)) || [];
    const inbound = inboundReplies(msgs, { outboundIds: outbound, ownerEmail: tokens.email || "" });
    for (const m of inbound) {
      if (seen.has(m.id)) continue;
      emailCannotBecomeCommand(m.body);
      const cls = classifyReply(m.body);
      const ins = await insertReply(userId, t.prospect_uid, m.id, cls, m.body);
      if (ins === "duplicate") continue;
      seen.add(m.id);
      n += 1;
      await stopSequencesForProspect(userId, t.prospect_uid);
      const left = await countScheduledFollowups(userId, t.prospect_uid);
      if (left > 0) {
        await audit(userId, "FOLLOWUP_CANCEL_FAILED", `${left} follow-up(s) still pending after reply`, { prospectUid: t.prospect_uid, method: "AUTOMATION", providerIds: m.id });
      } else {
        await audit(userId, "followups_cancelled", "remaining follow-ups cancelled", { prospectUid: t.prospect_uid, method: "AUTOMATION", providerIds: m.id });
      }
      await audit(userId, "reply", `${cls}: inbound reply detected`, { prospectUid: t.prospect_uid, method: "AUTOMATION", providerIds: m.id });
      const prospect = await getProspectByUid(userId, t.prospect_uid);
      if (cls === "UNSUBSCRIBE" && prospect) {
        prospect.suppressed = true;
        prospect.stage = "Do Not Contact";
        const { upsertProspects } = await import("@/lib/prospects/repo.server");
        await upsertProspects(userId, [prospect]);
      }
      void draftReply(cls, prospect?.name || "");
    }
  }
  return { ok: true, replies: n };
}

export async function tickOutreachWorker(source = "in-process"): Promise<{
  runId: string;
  sawTest: number;
  sent: number;
  followupsSkipped: number;
  rescheduled: number;
  skippedReason?: string;
}> {
  const { newUid } = await import("../prospects/ids");
  const runId = newUid();
  const started = await startWorkerHeartbeat(runId, source);
  if (!started) {
    return { runId, sawTest: 0, sent: 0, followupsSkipped: 0, rescheduled: 0, skippedReason: "already-running" };
  }
  try {
    const users = await listGmailUsers();
    for (const userId of users) {
      await syncRepliesForUser(userId);
    }
    const due = await runDueFollowups();
    const sawTest = await markTestWorkflowSeen(runId);
    const summary = `ok sent=${due.sent} skipped=${due.skipped} rescheduled=${due.rescheduled}`;
    await finishWorkerHeartbeat(runId, sawTest ? `${summary} test-seen` : summary);
    return { runId, sawTest, sent: due.sent, followupsSkipped: due.skipped, rescheduled: due.rescheduled };
  } catch (err) {
    await finishWorkerHeartbeat(runId, "error", err instanceof Error ? err.message : "worker failed");
    throw err;
  }
}
