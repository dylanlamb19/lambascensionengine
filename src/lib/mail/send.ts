import { canSend, reasonFor, type Caps, type Usage } from "./guard.ts";
import { DEFAULT_HOURS, type HoursConfig } from "./hours.ts";
import type { EmailRecord, GmailPort, InputMethod, MailKind, ProspectMailView } from "./types.ts";
import type { ReserveResult } from "./reserve.ts";

export type SendDeps = {
  gmail: GmailPort | null;
  gmailConnected: boolean;
  usage: Usage;
  caps: Caps;
  hours?: HoursConfig;
  firstApproved: boolean;
  sequenceActive: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  now?: Date;
  existingKeys: Set<string>;
  reserveKey?: (key: string) => Promise<ReserveResult>;
  reserveCap?: (kind: "first" | "followup") => Promise<boolean>;
  testMode?: boolean;
  allowlist?: string[];
};

export function idempotencyKey(userId: string, prospectUid: string, kind: string, sequenceId?: string): string {
  return `${userId}:${prospectUid}:${kind}:${sequenceId || "first"}`;
}

export async function sendMail(opts: {
  userId: string;
  prospect: ProspectMailView;
  kind: MailKind;
  method: InputMethod;
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  sequenceId?: string | null;
  deps: SendDeps;
}): Promise<
  | { ok: true; record: EmailRecord }
  | { ok: false; reason: string; code: string; record?: EmailRecord }
> {
  const now = opts.deps.now || new Date();
  const key = idempotencyKey(opts.userId, opts.prospect.uid, opts.kind, opts.sequenceId || undefined);

  const gate = canSend({
    prospect: opts.prospect,
    gmailConnected: opts.deps.gmailConnected,
    recipient: opts.to,
    kind: opts.kind === "reply" ? "reply" : opts.kind,
    method: opts.method,
    firstApproved: opts.deps.firstApproved,
    sequenceActive: opts.deps.sequenceActive,
    bounced: opts.deps.bounced,
    unsubscribed: opts.deps.unsubscribed,
    usage: opts.deps.usage,
    caps: opts.deps.caps,
    now,
    hours: opts.deps.hours || DEFAULT_HOURS,
    threadId: opts.threadId,
    testMode: opts.deps.testMode,
    allowlist: opts.deps.allowlist,
  });
  if (!gate.ok) {
    return { ok: false, reason: reasonFor(gate.code), code: gate.code };
  }
  if (!opts.deps.gmail) {
    return { ok: false, reason: reasonFor("DISCONNECTED"), code: "DISCONNECTED" };
  }

  if (opts.deps.reserveKey) {
    const reserved = await opts.deps.reserveKey(key);
    if (reserved !== "won") {
      return { ok: false, reason: "This message is already being sent or was already sent.", code: "DUPLICATE" };
    }
  } else {
    if (opts.deps.existingKeys.has(key)) {
      return { ok: false, reason: "This message is already being sent or was already sent.", code: "DUPLICATE" };
    }
    opts.deps.existingKeys.add(key);
  }

  if (opts.deps.reserveCap) {
    const kind = opts.kind === "email" ? "first" : "followup";
    const capOk = await opts.deps.reserveCap(kind);
    if (!capOk) return { ok: false, reason: reasonFor("RATE_LIMIT"), code: "RATE_LIMIT" };
  }

  const sending: EmailRecord = {
    id: key,
    userId: opts.userId,
    prospectUid: opts.prospect.uid,
    direction: "out",
    recipient: opts.to,
    subject: opts.subject,
    body: opts.body,
    status: "SENDING",
    kind: opts.kind,
    idempotencyKey: key,
    inputMethod: opts.method,
    sequenceId: opts.sequenceId,
    threadId: opts.threadId,
    gmailThreadId: opts.threadId,
  };

  const result = await opts.deps.gmail.send({
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    threadId: opts.threadId,
  });

  if (!result.ok) {
    if (result.timeout || result.error === "timeout") {
      sending.status = "UNKNOWN_DELIVERY";
      return {
        ok: false,
        reason: "Gmail may have accepted this, but we did not get confirmation. It was NOT retried. Check Gmail, then mark it sent or try a new message.",
        code: "UNKNOWN_DELIVERY",
        record: sending,
      };
    }
    sending.status = result.bounced ? "BOUNCED" : "FAILED";
    return {
      ok: false,
      reason: result.disconnected
        ? reasonFor("DISCONNECTED")
        : "Lamb Ascension could not send this email. It has NOT been marked sent.",
      code: result.bounced ? "BOUNCED" : result.disconnected ? "DISCONNECTED" : "FAILED",
      record: sending,
    };
  }

  sending.status = "SENT";
  sending.gmailMessageId = result.messageId;
  sending.gmailThreadId = result.threadId;
  sending.threadId = result.threadId;
  sending.sentAt = now.toISOString();
  if (opts.kind === "email") opts.deps.usage.first += 1;
  else if (opts.kind.startsWith("follow")) opts.deps.usage.followups += 1;
  return { ok: true, record: sending };
}
