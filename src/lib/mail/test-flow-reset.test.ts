import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { idempotencyKey } from "./send.ts";
import { revenueSnapshot } from "../attack/revenue.ts";
import {
  TEST_RECORD_NAME,
  TEST_WORKFLOW_UID,
  isTestWorkflowUid,
  isUnusedTestRun,
  newTestRunId,
  shouldCancelOnTestReset,
  testFollowupIdempotencyKey,
  testRunUid,
} from "./test-loop.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("test workflow uid matches exact and run-prefixed identities only", () => {
  assert.equal(isTestWorkflowUid(TEST_WORKFLOW_UID), true);
  assert.equal(isTestWorkflowUid("test-sales-flow:abc123"), true);
  assert.equal(isTestWorkflowUid("test-sales-flow-evil"), false);
  assert.equal(isTestWorkflowUid("company-a"), false);
  assert.equal(isTestWorkflowUid(""), false);
  assert.equal(isTestWorkflowUid(null), false);
});

test("reset cancels only TEST scheduled/sending rows", () => {
  assert.equal(shouldCancelOnTestReset({ prospectUid: TEST_WORKFLOW_UID, status: "scheduled" }), true);
  assert.equal(shouldCancelOnTestReset({ prospectUid: "test-sales-flow:run1", status: "sending" }), true);
  assert.equal(shouldCancelOnTestReset({ prospectUid: TEST_WORKFLOW_UID, status: "sent" }), false);
  assert.equal(shouldCancelOnTestReset({ prospectUid: TEST_WORKFLOW_UID, status: "cancelled" }), false);
  assert.equal(shouldCancelOnTestReset({ prospectUid: TEST_WORKFLOW_UID, status: "failed" }), false);
  assert.equal(shouldCancelOnTestReset({ prospectUid: "company-a", status: "scheduled" }), false);
  assert.equal(shouldCancelOnTestReset({ prospectUid: "company-a", status: "sending" }), false);
});

test("fresh TEST run identity is stable within a run and unique across runs", () => {
  const a = testRunUid("runA");
  const b = testRunUid("runB");
  assert.equal(a, "test-sales-flow:runA");
  assert.notEqual(a, b);
  assert.equal(idempotencyKey("u", a, "email", "initial"), idempotencyKey("u", a, "email", "initial"));
  assert.notEqual(idempotencyKey("u", a, "email", "initial"), idempotencyKey("u", b, "email", "initial"));
  assert.notEqual(idempotencyKey("u", a, "email", "initial"), idempotencyKey("u", TEST_WORKFLOW_UID, "email", "initial"));
  assert.equal(testFollowupIdempotencyKey("u", a, "followup1"), testFollowupIdempotencyKey("u", a, "followup1"));
  assert.notEqual(testFollowupIdempotencyKey("u", a, "followup1"), testFollowupIdempotencyKey("u", b, "followup1"));
  assert.doesNotMatch(testFollowupIdempotencyKey("u", a, "followup1"), /\d{10,}/);
  const id = newTestRunId();
  assert.ok(id.length >= 8);
  assert.doesNotMatch(id, /:/);
});

test("unused TEST run is the one with a run uid and no send yet", () => {
  assert.equal(isUnusedTestRun({ prospect_uid: "test-sales-flow:r1", message_id: null, sequence_id: null }), true);
  assert.equal(isUnusedTestRun({ prospect_uid: "test-sales-flow:r1", message_id: "m1", sequence_id: null }), false);
  assert.equal(isUnusedTestRun({ prospect_uid: "company-a", message_id: null, sequence_id: null }), false);
});

test("Confirm send cannot reuse last night's Gmail ids after a new run", () => {
  const src = readFileSync(join(here, "test-flow.server.ts"), "utf8");
  assert.match(src, /sequenceId: "initial"/);
  assert.doesNotMatch(src, /lastSentIds\(userId, TEST_UID\)/);
  assert.match(src, /lastSentIds\(userId, runUid\)/);
  assert.doesNotMatch(src, /followup1:\$\{stamp\}/);
  assert.match(src, /testFollowupIdempotencyKey\(userId, runUid, "followup1"\)/);
  assert.match(src, /export async function resetTestFlow/);
  assert.doesNotMatch(src, /testrun-\$\{Date\.now/);
});

test("migration and Reset UI are TEST-only and do not send", () => {
  const mig = readFileSync(join(here, "../../../migrations/0015_test_flow_reset.sql"), "utf8");
  assert.match(mig, /TEST_FLOW_RESET/);
  assert.match(mig, /prospect_uid = 'test-sales-flow' OR prospect_uid LIKE 'test-sales-flow:%'/);
  assert.match(mig, /status IN \('scheduled', 'sending'\)/);
  assert.doesNotMatch(mig, /DELETE FROM scheduled_followups/i);
  assert.doesNotMatch(mig, /DELETE FROM email_messages/i);
  assert.doesNotMatch(mig, /test_mode = false/);
  const ui = readFileSync(join(here, "../../components/test-desk.tsx"), "utf8");
  assert.match(ui, /Reset test flow/);
  assert.match(ui, /Confirm reset/);
  assert.match(ui, /resetTestFlowFn/);
  const actions = readFileSync(join(here, "actions.ts"), "utf8");
  assert.match(actions, /resetTestFlowFn/);
  assert.match(actions, /confirm !== true/);
});

test("TEST run uids stay out of revenue", () => {
  const snap = revenueSnapshot([
    {
      id: 1,
      uid: TEST_WORKFLOW_UID,
      name: TEST_RECORD_NAME,
      vertical: "Internal test",
      city: "Test Mode",
      website: "",
      review_count: 0,
      google_rating: "UNKNOWN",
      phone: "UNKNOWN",
      job_value_est: 0,
      job_value_kind: "UNKNOWN",
      score: 0,
      fit: "possible",
      stage: "Contacted",
      is_demo: true,
    } as never,
    {
      id: 3,
      uid: "test-sales-flow:run_live",
      name: TEST_RECORD_NAME,
      vertical: "Internal test",
      city: "Test Mode",
      website: "",
      review_count: 0,
      google_rating: "UNKNOWN",
      phone: "UNKNOWN",
      job_value_est: 0,
      job_value_kind: "UNKNOWN",
      score: 0,
      fit: "possible",
      stage: "Contacted",
    } as never,
    {
      id: 2,
      uid: "company-a",
      name: "ABC",
      vertical: "Roofing",
      city: "Fort Worth",
      website: "",
      review_count: 0,
      google_rating: "UNKNOWN",
      phone: "UNKNOWN",
      job_value_est: 0,
      job_value_kind: "UNKNOWN",
      score: 0,
      fit: "possible",
      stage: "Contacted",
    } as never,
  ]);
  assert.equal(snap.contacted, 1);
});
