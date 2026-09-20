/** Test-workflow identity and speech. Never applied to real prospects. */

export const TEST_WORKFLOW_UID = "test-sales-flow";
export const TEST_UID = TEST_WORKFLOW_UID;
export const TEST_RECORD_NAME = "TEST • Outreach Automation Verification";
/** Parameterized LIKE for TEST run uids. Exact `test-sales-flow` is matched separately. */
export const TEST_UID_LIKE = `${TEST_WORKFLOW_UID}:%`;

/** Short delay so a closed-browser worker tick can be observed. Real prospects keep 3/7/12 day gaps. */
export const TEST_FOLLOWUP_SHORT_MS = 8 * 60 * 1000;
/** Later follow-up that must remain pending until a reply cancels it. */
export const TEST_FOLLOWUP_REMAINING_MS = 24 * 60 * 60 * 1000;

export type TestLoopFailureCode =
  | "INITIAL_SEND_FAILED"
  | "FOLLOWUP_SCHEDULE_FAILED"
  | "WORKER_CLAIM_FAILED"
  | "UNKNOWN_DELIVERY"
  | "REPLY_SYNC_FAILED"
  | "THREAD_MATCH_FAILED"
  | "FOLLOWUP_CANCEL_FAILED"
  | "NOT_ALLOWLISTED";

export function isTestWorkflowUid(uid: string | null | undefined): uid is string {
  if (!uid) return false;
  return uid === TEST_WORKFLOW_UID || uid.startsWith(`${TEST_WORKFLOW_UID}:`);
}

export function newTestRunId(): string {
  const raw = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `r${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  return raw.replace(/-/g, "").slice(0, 16);
}

export function testRunUid(runId: string): string {
  return `${TEST_WORKFLOW_UID}:${runId}`;
}

/** Stable within a run. Unique across runs. Never a timestamp (double-click safe). */
export function testFollowupIdempotencyKey(
  userId: string,
  runUid: string,
  step: "followup1" | "followup2",
): string {
  return `${userId}:${runUid}:${step}`;
}

export function isUnusedTestRun(state: {
  prospect_uid?: string | null;
  message_id?: string | null;
  sequence_id?: string | null;
}): boolean {
  return isTestWorkflowUid(state.prospect_uid) && !state.message_id && !state.sequence_id;
}

/** Only TEST scheduled/sending rows. Never real prospects, never sent/failed/cancelled. */
export function shouldCancelOnTestReset(opts: { prospectUid: string; status: string }): boolean {
  if (!isTestWorkflowUid(opts.prospectUid)) return false;
  return opts.status === "scheduled" || opts.status === "sending";
}

export type TestLoopState = {
  uid: string;
  name: string;
  recipient: string;
  allowlisted: boolean;
  initialSent: boolean;
  followupScheduled: boolean;
  followupDueAt: string | null;
  followupSent: boolean;
  pendingFollowups: number;
  replyDetected: boolean;
  replyCount: number;
  sequenceStopped: boolean;
};

export const EMPTY_TEST_LOOP: TestLoopState = {
  uid: TEST_WORKFLOW_UID,
  name: TEST_RECORD_NAME,
  recipient: "",
  allowlisted: false,
  initialSent: false,
  followupScheduled: false,
  followupDueAt: null,
  followupSent: false,
  pendingFollowups: 0,
  replyDetected: false,
  replyCount: 0,
  sequenceStopped: false,
};

export function testLoopSpeech(s: TestLoopState): {
  followupAnswer: string;
  replyAnswer: string;
  pendingAnswer: string;
  summary: string;
} {
  const followupAnswer = s.followupSent
    ? "Yes. The test follow-up was sent."
    : s.followupScheduled
      ? s.followupDueAt
        ? `The test follow-up is scheduled for ${s.followupDueAt}. It has not sent yet.`
        : "The test follow-up is scheduled. It has not sent yet."
      : "No. A test follow-up has not been scheduled yet.";
  const replyAnswer = s.replyDetected
    ? "Yes. A reply was detected on the test thread."
    : "No. I have not seen a reply on the test thread yet.";
  const pendingAnswer = s.pendingFollowups === 0
    ? "No remaining follow-ups are scheduled for that test thread."
    : `${s.pendingFollowups} follow-up${s.pendingFollowups === 1 ? "" : "s"} still scheduled for the test thread.`;
  const parts = [
    "TEST LOOP (not a real prospect — do not count toward sales metrics):",
    `name: ${s.name}.`,
    `recipient: ${s.recipient || "none"}.`,
    `allowlisted: ${s.allowlisted ? "true" : "false"}.`,
    `initial_sent: ${s.initialSent ? "true" : "false"}.`,
    `followup_scheduled: ${s.followupScheduled ? "true" : "false"}.`,
    `followup_due_at: ${s.followupDueAt || "none"}.`,
    `followup_sent: ${s.followupSent ? "true" : "false"}.`,
    `reply_detected: ${s.replyDetected ? "true" : "false"}.`,
    `reply_count: ${s.replyCount}.`,
    `pending_followups: ${s.pendingFollowups}.`,
    `sequence_stopped: ${s.sequenceStopped ? "true" : "false"}.`,
  ];
  return { followupAnswer, replyAnswer, pendingAnswer, summary: parts.join(" ") };
}

export function testEmailCopy(recipient: string): { subject: string; body: string; followup1: string; followup2: string } {
  const subject = "LambAscensionEngine Test";
  const body = `This is a controlled LambAscensionEngine Test Mode email. No action is required.\n\nIt was sent only because ${recipient} is on the owner’s test allowlist. This is not a sales message.`;
  const followup1 = "This is a controlled LambAscensionEngine Test Mode follow-up. No action is required. This is not a sales message.";
  const followup2 = "This is a controlled LambAscensionEngine Test Mode follow-up (held until reply-stop). No action is required. This is not a sales message.";
  return { subject, body, followup1, followup2 };
}
