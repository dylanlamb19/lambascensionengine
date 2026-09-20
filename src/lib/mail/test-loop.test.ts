import assert from "node:assert/strict";
import test from "node:test";
import { buildSequence } from "./sequence.ts";
import { decideFollowupSend } from "./worker.ts";
import { freezeSnapshot } from "./snapshot.ts";
import { canSend } from "./guard.ts";
import {
  EMPTY_TEST_LOOP,
  TEST_FOLLOWUP_REMAINING_MS,
  TEST_FOLLOWUP_SHORT_MS,
  TEST_RECORD_NAME,
  TEST_WORKFLOW_UID,
  isTestWorkflowUid,
  testEmailCopy,
  testLoopSpeech,
} from "./test-loop.ts";

test("test workflow uid is isolated from real prospects", () => {
  assert.equal(isTestWorkflowUid(TEST_WORKFLOW_UID), true);
  assert.equal(isTestWorkflowUid("company-a"), false);
  assert.equal(isTestWorkflowUid(""), false);
});

test("test-only follow-up delay is 5–10 minutes, not days", () => {
  assert.ok(TEST_FOLLOWUP_SHORT_MS >= 5 * 60 * 1000);
  assert.ok(TEST_FOLLOWUP_SHORT_MS <= 10 * 60 * 1000);
  assert.ok(TEST_FOLLOWUP_REMAINING_MS >= 12 * 60 * 60 * 1000);
});

test("real prospect sequence gaps stay 3/7/12 days", () => {
  const built = buildSequence({
    userId: "u",
    prospectUid: "company-a",
    method: "MANUAL",
    now: new Date("2026-09-20T06:00:00Z"),
    recipient: "owner@company.com",
    subject: "Hi",
    bodies: { followup1: "f1", followup2: "f2", followup3: "f3" },
    threadId: "t",
  });
  const t0 = Date.parse("2026-09-20T06:00:00Z");
  assert.equal(built.followups[0].dueAt - t0, 3 * 86400000);
  assert.equal(built.followups[1].dueAt - t0, 7 * 86400000);
  assert.equal(built.followups[2].dueAt - t0, 12 * 86400000);
});

test("test email copy is not a sales pitch", () => {
  const copy = testEmailCopy("me@test.com");
  assert.equal(copy.subject, "LambAscensionEngine Test");
  assert.match(copy.body, /No action is required/);
  assert.doesNotMatch(copy.body, /book a call|increase revenue|proposal/i);
  assert.match(TEST_RECORD_NAME, /^TEST •/);
});

test("Sunday automation still reschedules for real prospects", () => {
  const sunday = new Date("2026-09-20T06:33:00Z");
  const snap = freezeSnapshot({
    recipient: "owner@company.com",
    subject: "Re: Hi",
    body: "f1",
    gmailThreadId: "t",
    sequenceId: "seq",
  });
  const d = decideFollowupSend({
    prospect: { uid: "company-a", name: "ABC", stage: "Contacted" },
    sequenceActive: true,
    snapshot: snap,
    now: sunday,
    gmailConnected: true,
    hours: { workStart: 8, workEnd: 17, workDays: [1, 2, 3, 4, 5], timezone: "America/Chicago" },
  });
  assert.equal(d.action, "reschedule");
});

test("test-workflow skipHours allows Sunday send without changing real hours", () => {
  const sunday = new Date("2026-09-20T06:33:00Z");
  const snap = freezeSnapshot({
    recipient: "me@test.com",
    subject: "Re: LambAscensionEngine Test",
    body: "f1",
    gmailThreadId: "t",
    sequenceId: "seq",
  });
  const d = decideFollowupSend({
    prospect: { uid: TEST_WORKFLOW_UID, name: TEST_RECORD_NAME, stage: "Contacted" },
    sequenceActive: true,
    snapshot: snap,
    now: sunday,
    gmailConnected: true,
    hours: { workStart: 8, workEnd: 17, workDays: [1, 2, 3, 4, 5], timezone: "America/Chicago" },
    testMode: true,
    allowlist: ["me@test.com"],
    skipHours: true,
  });
  assert.equal(d.action, "send");
});

test("skipHours still fail-closes when the recipient is not allowlisted", () => {
  const sunday = new Date("2026-09-20T06:33:00Z");
  const snap = freezeSnapshot({
    recipient: "stranger@company.com",
    subject: "Re: Hi",
    body: "f1",
    gmailThreadId: "t",
    sequenceId: "seq",
  });
  const d = decideFollowupSend({
    prospect: { uid: TEST_WORKFLOW_UID, name: TEST_RECORD_NAME, stage: "Contacted" },
    sequenceActive: true,
    snapshot: snap,
    now: sunday,
    gmailConnected: true,
    hours: { workStart: 8, workEnd: 17, workDays: [1, 2, 3, 4, 5], timezone: "America/Chicago" },
    testMode: true,
    allowlist: ["me@test.com"],
    skipHours: true,
  });
  assert.equal(d.action, "cancel");
});

test("Ara test-loop answers come from live state, not hardcoded yes", () => {
  const empty = testLoopSpeech(EMPTY_TEST_LOOP);
  assert.match(empty.followupAnswer, /not been scheduled/i);
  assert.match(empty.replyAnswer, /not seen a reply/i);
  assert.match(empty.pendingAnswer, /No remaining follow-ups/);

  const sent = testLoopSpeech({
    ...EMPTY_TEST_LOOP,
    followupScheduled: true,
    followupSent: true,
    pendingFollowups: 1,
    replyDetected: false,
    replyCount: 0,
  });
  assert.equal(sent.followupAnswer, "Yes. The test follow-up was sent.");
  assert.match(sent.replyAnswer, /^No\./);
  assert.match(sent.pendingAnswer, /1 follow-up still scheduled/);

  const replied = testLoopSpeech({
    ...EMPTY_TEST_LOOP,
    followupScheduled: true,
    followupSent: true,
    pendingFollowups: 0,
    replyDetected: true,
    replyCount: 1,
    sequenceStopped: true,
  });
  assert.equal(replied.replyAnswer, "Yes. A reply was detected on the test thread.");
  assert.equal(replied.pendingAnswer, "No remaining follow-ups are scheduled for that test thread.");
});

test("first contact still requires approval even for the test record", () => {
  const r = canSend({
    prospect: { uid: TEST_WORKFLOW_UID, name: TEST_RECORD_NAME, stage: "Approved for Outreach" },
    gmailConnected: true,
    recipient: "me@test.com",
    kind: "email",
    method: "AUTOMATION",
    firstApproved: false,
    sequenceActive: false,
    bounced: false,
    unsubscribed: false,
    usage: { first: 0, followups: 0 },
    caps: { maxFirst: 2, maxFollowups: 3 },
    now: new Date(),
    testMode: true,
    allowlist: ["me@test.com"],
    skipHours: true,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_APPROVED");
});
