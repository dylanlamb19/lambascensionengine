import { schedulerEvidenceOk } from "./heartbeat.ts";

export const TEST_CAPS = { maxFirst: 2, maxFollowups: 3 } as const;
export const CONTROLLED_LIVE_CAPS = { maxFirst: 5, maxFollowups: 10 } as const;

export type TestSettings = {
  testMode: boolean;
  allowlist: string[];
  maxFirst: number;
  maxFollowups: number;
};

export const DEFAULT_TEST_SETTINGS: TestSettings = {
  testMode: true,
  allowlist: [],
  maxFirst: TEST_CAPS.maxFirst,
  maxFollowups: TEST_CAPS.maxFollowups,
};

export function normalizeEmail(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

export function isEmailShape(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(raw));
}

export function parseAllowlist(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : (raw || "").split(/[\s,;]+/);
  const out: string[] = [];
  for (const p of parts) {
    const n = normalizeEmail(p);
    if (isEmailShape(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export function isAllowlisted(recipient: string, allowlist: string[]): boolean {
  const n = normalizeEmail(recipient);
  if (!n) return false;
  return allowlist.map(normalizeEmail).includes(n);
}

export function effectiveCaps(settings: { testMode: boolean; maxFirst: number; maxFollowups: number }): { maxFirst: number; maxFollowups: number } {
  if (settings.testMode) return { maxFirst: TEST_CAPS.maxFirst, maxFollowups: TEST_CAPS.maxFollowups };
  return {
    maxFirst: Math.min(CONTROLLED_LIVE_CAPS.maxFirst, Math.max(1, settings.maxFirst || CONTROLLED_LIVE_CAPS.maxFirst)),
    maxFollowups: Math.min(CONTROLLED_LIVE_CAPS.maxFollowups, Math.max(1, settings.maxFollowups || CONTROLLED_LIVE_CAPS.maxFollowups)),
  };
}

export function allowSendRecipient(opts: { testMode: boolean; allowlist: string[]; recipient: string }): { ok: true } | { ok: false; code: "NOT_ALLOWLISTED"; reason: string } {
  if (!opts.testMode) return { ok: true };
  if (!opts.allowlist.length) {
    return {
      ok: false,
      code: "NOT_ALLOWLISTED",
      reason: "Test Mode is on. Add a test email in Settings first. Nothing was sent.",
    };
  }
  if (!isAllowlisted(opts.recipient, opts.allowlist)) {
    return {
      ok: false,
      code: "NOT_ALLOWLISTED",
      reason: "Test Mode is on. That address is not on your test list. Nothing was sent.",
    };
  }
  return { ok: true };
}

export function canDisableTestMode(confirm: string): boolean {
  return (confirm || "").trim() === "DISABLE";
}

export function gateTestModeDisable(opts: {
  confirm: string;
  testMode: boolean;
  readiness: { ready: boolean; blockers: string[] };
}): { ok: true } | { ok: false; reason: string; blockers: string[] } {
  if (!canDisableTestMode(opts.confirm)) return { ok: false, reason: "Type DISABLE exactly to continue.", blockers: [] };
  if (!opts.testMode) return { ok: false, reason: "Test Mode is already off.", blockers: [] };
  if (!opts.readiness?.ready) {
    const blockers = opts.readiness?.blockers?.length ? opts.readiness.blockers : ["Live Outreach Readiness is not available."];
    return { ok: false, reason: blockers[0], blockers };
  }
  return { ok: true };
}

/**
 * Disable intent. `testMode: false` is the normal signal.
 * If a serializer drops boolean false, a non-empty confirm still counts as disable.
 */
export function wantsDisableTestMode(data: { testMode?: boolean; confirm?: string }): boolean {
  if (data.testMode === true) return false;
  if (data.testMode === false) return true;
  return typeof data.confirm === "string" && data.confirm.trim().length > 0;
}

/** Coerce DB/driver values. Default ON when unknown. */
export function readTestModeFlag(value: unknown): boolean {
  if (value === false || value === 0 || value === "0" || value === "f" || value === "false" || value === "FALSE") return false;
  if (value === true || value === 1 || value === "1" || value === "t" || value === "true" || value === "TRUE") return true;
  return true;
}

export type LiveCheckKey =
  | "send"
  | "thread"
  | "reply"
  | "stop"
  | "scheduler"
  | "availability"
  | "booking"
  | "pipeline";

export type LiveCheck = { key: LiveCheckKey; label: string; ok: boolean };

export function scoreLiveChecks(evidence: {
  messageId?: string | null;
  threadId?: string | null;
  replyCount?: number;
  followupsBeforeReply?: number;
  followupsAfterSync?: number | null;
  sequenceId?: string | null;
  slotsOffered?: number;
  eventId?: string | null;
  pipelineStage?: string | null;
  workerRunId?: string | null;
  workerSeenAt?: string | number | null;
  secretPresent?: boolean;
}): LiveCheck[] {
  const send = Boolean(evidence.messageId);
  const thread = Boolean(evidence.threadId);
  const reply = (evidence.replyCount || 0) > 0;
  const hadFollowup = (evidence.followupsBeforeReply || 0) > 0;
  const stop = hadFollowup && evidence.followupsAfterSync === 0 && reply;
  const scheduler = schedulerEvidenceOk({
    secretPresent: evidence.secretPresent,
    sequenceId: evidence.sequenceId,
    followupsScheduled: evidence.followupsBeforeReply,
    workerRunId: evidence.workerRunId,
    workerSeenAt: evidence.workerSeenAt,
  });
  const availability = (evidence.slotsOffered || 0) > 0;
  const booking = Boolean(evidence.eventId && String(evidence.eventId).trim());
  const pipeline = evidence.pipelineStage === "Call Booked" && booking;
  return [
    { key: "send", label: "Gmail send", ok: send },
    { key: "thread", label: "Gmail threading", ok: thread },
    { key: "reply", label: "Reply detection", ok: reply },
    { key: "stop", label: "Follow-up stop", ok: stop },
    { key: "scheduler", label: "Scheduler", ok: scheduler },
    { key: "availability", label: "Calendar availability", ok: availability },
    { key: "booking", label: "Booking", ok: booking },
    { key: "pipeline", label: "Pipeline sync", ok: pipeline },
  ];
}

export function secretPresent(value: string | undefined, forbidden: string[] = []): boolean {
  const v = (value || "").trim();
  if (!v) return false;
  return !forbidden.includes(v);
}

export function light(ready: boolean): "ready" | "missing" {
  return ready ? "ready" : "missing";
}

export function integrationLightsDoNotLeak(integrations: Record<string, "ready" | "missing" | boolean>): string[] {
  return Object.entries(integrations).map(([k, v]) => `${k}:${v === "ready" || v === true ? "ready" : "missing"}`);
}
