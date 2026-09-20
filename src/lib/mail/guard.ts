import { DEFAULT_HOURS, type HoursConfig, withinWorkingHours } from "./hours.ts";
import type { InputMethod, ProspectMailView } from "./types.ts";
import { allowSendRecipient } from "./test-mode.ts";

export type GuardFail =
  | "DNC"
  | "UNSUBSCRIBED"
  | "BOUNCED"
  | "DISCONNECTED"
  | "NO_RECIPIENT"
  | "RATE_LIMIT"
  | "OUTSIDE_HOURS"
  | "NOT_APPROVED"
  | "NO_THREAD"
  | "SUPPRESSED"
  | "NOT_ALLOWLISTED";

export type Usage = { first: number; followups: number };
export type Caps = { maxFirst: number; maxFollowups: number };

export function reasonFor(code: GuardFail): string {
  switch (code) {
    case "DNC":
    case "SUPPRESSED":
      return "This company is on Do Not Contact. Nothing was sent.";
    case "UNSUBSCRIBED":
      return "They asked not to be contacted. Follow-ups are stopped. Nothing was sent.";
    case "BOUNCED":
      return "The last email bounced. We will not keep sending to this address.";
    case "DISCONNECTED":
      return "Gmail needs to be reconnected. No emails were sent while it was disconnected.";
    case "NO_RECIPIENT":
      return "We do not have a verified email address. We will not guess one.";
    case "RATE_LIMIT":
      return "Daily send limit reached. Try again tomorrow. Nothing extra was sent.";
    case "OUTSIDE_HOURS":
      return "Outside working hours. This follow-up is waiting until morning.";
    case "NOT_APPROVED":
      return "The first email still needs your approval. Nothing was sent.";
    case "NO_THREAD":
      return "We are not sure which Gmail thread to use. Check this prospect instead of guessing.";
    case "NOT_ALLOWLISTED":
      return "Test Mode is on. That address is not on your test list. Nothing was sent.";
  }
}

export function canSend(opts: {
  prospect: ProspectMailView;
  gmailConnected: boolean;
  recipient: string;
  kind: "email" | "followup1" | "followup2" | "followup3" | "reply";
  method: InputMethod;
  firstApproved: boolean;
  sequenceActive: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  usage: Usage;
  caps: Caps;
  now: Date;
  hours?: HoursConfig;
  threadId?: string | null;
  skipHours?: boolean;
  testMode?: boolean;
  allowlist?: string[];
}): { ok: true } | { ok: false; code: GuardFail } {
  const p = opts.prospect;
  if (p.suppressed || p.stage === "Do Not Contact") return { ok: false, code: "DNC" };
  if (opts.unsubscribed) return { ok: false, code: "UNSUBSCRIBED" };
  if (opts.bounced) return { ok: false, code: "BOUNCED" };
  if (!opts.gmailConnected) return { ok: false, code: "DISCONNECTED" };
  if (!opts.recipient || opts.recipient === "UNKNOWN") return { ok: false, code: "NO_RECIPIENT" };
  const allow = allowSendRecipient({
    testMode: Boolean(opts.testMode),
    allowlist: opts.allowlist || [],
    recipient: opts.recipient,
  });
  if (!allow.ok) return { ok: false, code: "NOT_ALLOWLISTED" };
  if (opts.kind === "email" && !opts.firstApproved && opts.method !== "MANUAL" && opts.method !== "VOICE") {
    return { ok: false, code: "NOT_APPROVED" };
  }
  if (opts.kind !== "email" && opts.kind !== "reply") {
    if (!opts.sequenceActive) return { ok: false, code: "NOT_APPROVED" };
    if (!opts.threadId) return { ok: false, code: "NO_THREAD" };
  }
  const hours = opts.hours || DEFAULT_HOURS;
  if (opts.method === "AUTOMATION" && !opts.skipHours && !withinWorkingHours(opts.now, hours)) {
    return { ok: false, code: "OUTSIDE_HOURS" };
  }
  if (opts.kind === "email" && opts.usage.first >= opts.caps.maxFirst) return { ok: false, code: "RATE_LIMIT" };
  if (opts.kind.startsWith("follow") && opts.usage.followups >= opts.caps.maxFollowups) return { ok: false, code: "RATE_LIMIT" };
  return { ok: true };
}
