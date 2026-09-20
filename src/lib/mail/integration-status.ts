/**
 * One authoritative integration readiness model.
 * Ara, Settings, Home, Connection Test, and screen reading all derive from this.
 * Connection (Gmail vs Calendar) is independent of OAuth credential configuration.
 *
 * Client loading is tri-state. "Not loaded yet" is unknown — never false.
 */

export type WorkerState = "running" | "configured" | "missing";
export type ConnectionHealth = "unknown" | "connected" | "missing" | "attention";

export type IntegrationStatus = {
  google_oauth_configured: boolean;
  gmail_connected: boolean;
  gmail_identity: string;
  gmail_token_valid: boolean;
  calendar_connected: boolean;
  calendar_identity: string;
  calendar_token_valid: boolean;
  calendar_freebusy_valid: boolean;
  calendar_freebusy_code: string;
  calendar_freebusy_detail: string;
  worker_configured: boolean;
  worker_last_success: string | null;
  worker_state: WorkerState;
  worker_detail: string;
  test_mode: boolean;
};

export type IntegrationSpeech = {
  gmailAnswer: string;
  calendarAnswer: string;
  freeBusyAnswer: string;
  workerAnswer: string;
  setupRemaining: string;
  settingsImportant: string;
  settingsNext: string;
  oauthBlocker: string | null;
  facts: Array<{ kind: "VERIFIED" | "UNKNOWN" | "ESTIMATE" | "ERROR"; text: string }>;
};

function minutesFromIso(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

export function gmailHealth(s: IntegrationStatus): Exclude<ConnectionHealth, "unknown"> {
  if (!s.gmail_connected) return "missing";
  if (!s.gmail_token_valid) return "attention";
  return "connected";
}

export function calendarHealth(s: IntegrationStatus): Exclude<ConnectionHealth, "unknown"> {
  if (!s.calendar_connected) return "missing";
  if (!s.calendar_token_valid) return "attention";
  return "connected";
}

/** Client-side: null/undefined status is UNKNOWN, never disconnected. */
export function resolvedGmailHealth(s: IntegrationStatus | null | undefined): ConnectionHealth {
  if (!s) return "unknown";
  return gmailHealth(s);
}

export function resolvedCalendarHealth(s: IntegrationStatus | null | undefined): ConnectionHealth {
  if (!s) return "unknown";
  return calendarHealth(s);
}

export function oauthCredentialGaps(setup: { name: string; ready: boolean }[]): string[] {
  return setup.filter((row) => !row.ready).map((row) => row.name);
}

/** Connection rows are not OAuth credential gaps. Stale "Gmail connection" / "Calendar connection" must never produce "Google isn’t configured yet". */
export function oauthOnlyGaps(names: string[]): string[] {
  return names.filter((name) => !/gmail connection|calendar connection/i.test(name));
}

function gmailConnectedLine(s: IntegrationStatus): string {
  if (!s.gmail_connected) return "Gmail isn’t connected.";
  if (s.gmail_token_valid) {
    return s.gmail_identity
      ? `Gmail is connected and the token is valid (${s.gmail_identity}).`
      : "Gmail is connected and the token is valid.";
  }
  return s.gmail_identity
    ? `Gmail is connected as ${s.gmail_identity}, but the token needs attention.`
    : "Gmail is connected, but the token needs attention.";
}

function calendarLine(s: IntegrationStatus): string {
  if (s.calendar_connected) {
    return s.calendar_freebusy_valid
      ? "Google Calendar is connected and free/busy can be read."
      : "Google Calendar is connected.";
  }
  return "Google Calendar still needs to be connected.";
}

function workerNeedsObservedRun(s: IntegrationStatus): boolean {
  return s.worker_configured && s.worker_state !== "running";
}

export function integrationSpeech(s: IntegrationStatus, oauthGaps: string[] = []): IntegrationSpeech {
  const oauthBlocker = !s.google_oauth_configured && oauthGaps.length
    ? oauthGaps.length === 1
      ? `Google isn’t configured yet. ${oauthGaps[0]} is missing, so Gmail and Calendar can’t connect yet.`
      : `Google isn’t configured yet. The ${oauthGaps.slice(0, -1).join(", ")}, and ${oauthGaps[oauthGaps.length - 1]} are missing, so Gmail and Calendar can’t connect yet.`
    : !s.google_oauth_configured
      ? "Google isn’t configured yet. Gmail and Calendar can’t connect yet."
      : null;

  const gmailAnswer = s.gmail_connected && s.gmail_token_valid
    ? "Yes. Gmail is connected and the token is valid."
    : s.gmail_connected
      ? "Gmail is connected, but the token needs attention."
      : s.google_oauth_configured
        ? "No. Gmail isn’t connected yet."
        : "No. Google isn’t configured yet, so Gmail can’t connect.";

  const calendarAnswer = s.calendar_connected
    ? "Yes. Google Calendar is connected."
    : s.gmail_connected
      ? "No. Gmail is connected, but Google Calendar still needs to be connected."
      : "No. Google Calendar isn’t connected yet.";

  const freeBusyAnswer = !s.calendar_connected
    ? "No. Calendar still needs to be connected, so I cannot see when you’re free."
    : s.calendar_freebusy_valid
      ? "Yes. I can read your Google Calendar availability."
      : s.calendar_freebusy_detail || "Calendar is connected, but availability couldn’t be read.";

  const workerAnswer = !s.worker_configured && !s.worker_last_success
    ? "No. The outreach worker isn’t configured yet."
    : !s.worker_last_success
      ? "It’s configured, but a successful run hasn’t been observed yet."
      : s.worker_state === "running"
        ? `Yes. The outreach worker completed successfully ${minutesFromIso(s.worker_last_success)} minute${minutesFromIso(s.worker_last_success) === 1 ? "" : "s"} ago.`
        : s.worker_detail.replace(/^[🟢🟡🔴✅❌]\s*/u, "") || "The outreach worker is configured.";

  const remaining: string[] = [];
  if (!s.gmail_connected) remaining.push("Gmail still needs to be connected");
  if (!s.calendar_connected) remaining.push("Google Calendar still needs to be connected");
  if (workerNeedsObservedRun(s)) remaining.push("the outreach worker hasn’t completed an observed run yet");
  else if (!s.worker_configured) remaining.push("the outreach worker still needs to be configured");

  const setupRemaining = s.gmail_connected && s.calendar_connected && remaining.length
    ? `Gmail and Google Calendar are connected. The outreach worker still needs a successful observed run.`
    : !remaining.length
      ? "Gmail and Google Calendar are connected. Nothing else is waiting on setup."
      : remaining.map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part)).join(", and ") + ".";

  const settingsImportant = oauthBlocker
    || [gmailConnectedLine(s), calendarLine(s)].join(" ");

  const settingsNext = oauthBlocker
    ? "Whoever hosts Lamb Ascension needs to add the missing Google OAuth values. We will not ask for your Gmail password."
    : s.calendar_connected
      ? "Gmail and Calendar are ready. You can run a Connection Test if you want a live check."
      : "Connect Google Calendar in Settings when you’re ready. Gmail can already send.";

  const facts: IntegrationSpeech["facts"] = [];
  if (oauthBlocker) facts.push({ kind: "ERROR", text: oauthBlocker });
  if (s.gmail_connected && s.gmail_token_valid) {
    facts.push({ kind: "VERIFIED", text: gmailConnectedLine(s) });
  } else if (s.gmail_connected) {
    facts.push({ kind: "ERROR", text: gmailConnectedLine(s) });
  } else if (!oauthBlocker) {
    facts.push({ kind: "ERROR", text: "Gmail isn’t connected." });
  }
  if (!s.calendar_connected) {
    facts.push({ kind: "UNKNOWN", text: "Google Calendar isn’t connected yet." });
  } else {
    facts.push({ kind: "VERIFIED", text: calendarLine(s) });
  }
  if (workerNeedsObservedRun(s) || !s.worker_configured) {
    facts.push({ kind: "UNKNOWN", text: s.worker_detail.replace(/^[🟢🟡🔴✅❌]\s*/u, "") });
  } else {
    facts.push({ kind: "VERIFIED", text: s.worker_detail.replace(/^[🟢🟡🔴✅❌]\s*/u, "") });
  }
  facts.push({
    kind: "VERIFIED",
    text: s.test_mode ? "Test Mode is on. Emails only go to the allowlist." : "Test Mode is off. Live outreach rules apply. First-contact approval still required.",
  });

  return { gmailAnswer, calendarAnswer, freeBusyAnswer, workerAnswer, setupRemaining, settingsImportant, settingsNext, oauthBlocker, facts };
}

export function integrationInstructionBlock(s: IntegrationStatus, oauthGaps: string[] = []): string {
  const speech = integrationSpeech(s, oauthGaps);
  return [
    "INTEGRATION TRUTH (authoritative — never contradict these flags):",
    `google_oauth_configured: ${s.google_oauth_configured ? "true" : "false"}.`,
    `gmail_connected: ${s.gmail_connected ? "true" : "false"}.`,
    `gmail_token_valid: ${s.gmail_token_valid ? "true" : "false"}.`,
    `gmail_identity: ${s.gmail_identity || "none"}.`,
    `calendar_connected: ${s.calendar_connected ? "true" : "false"}.`,
    `calendar_token_valid: ${s.calendar_token_valid ? "true" : "false"}.`,
    `calendar_identity: ${s.calendar_identity || "none"}.`,
    `calendar_freebusy_valid: ${s.calendar_freebusy_valid ? "true" : "false"}.`,
    `calendar_freebusy_code: ${s.calendar_freebusy_code || "none"}.`,
    `worker_state: ${s.worker_state}. worker_configured: ${s.worker_configured ? "true" : "false"}. worker_last_success: ${s.worker_last_success || "none"}.`,
    `test_mode: ${s.test_mode ? "ON" : "off"}.`,
    `If Dylan asks whether Gmail is connected, answer: ${speech.gmailAnswer}`,
    `If Dylan asks whether Calendar is connected, answer: ${speech.calendarAnswer}`,
    `If Dylan asks whether you can see when he is free, answer: ${speech.freeBusyAnswer}`,
    `If Dylan asks whether the worker is running, or whether the outreach worker is running, answer: ${speech.workerAnswer}`,
    `If Dylan asks what still needs setup, answer: ${speech.setupRemaining}`,
    "Never say Gmail is missing when gmail_connected is true.",
    "Never say Calendar is disconnected when calendar_connected is true.",
    "Never say Google isn’t configured when google_oauth_configured is true.",
    "Gmail and Calendar are separate. A missing Calendar connection does not mean Gmail or Google OAuth is missing.",
    "Ara voice availability is a separate issue from Gmail and Calendar.",
  ].join("\n");
}

export const INTEGRATIONS_LOADING_INSTRUCTION =
  "INTEGRATION TRUTH: status is UNKNOWN because the server IntegrationStatus has not loaded yet. Do not say Gmail isn’t connected. Do not say Calendar is disconnected. Do not say Google isn’t configured. Do not guess. Wait for the next context update, or say you are checking integrations.";
