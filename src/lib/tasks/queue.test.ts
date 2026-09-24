import assert from "node:assert/strict";
import test from "node:test";
import {
  approveLabel,
  freezeDraft,
  isUnresolvedTask,
  nextIndexAfterRemoval,
  ownerTaskStateFromHistory,
  primaryTaskCta,
  taskKind,
  voiceTaskIntent,
} from "./queue.ts";

test("a contact task opens review, and Test Mode approves without sending", () => {
  assert.equal(taskKind({ action: "outreach", title: "Contact Davis Roofing Solutions" }), "contact");
  assert.equal(primaryTaskCta("contact", true).label, "Review Outreach");
  assert.equal(approveLabel(true), "Approve for Live");
  const frozen = freezeDraft({
    recipient: "frontdesk@davisroofingsolutions.com",
    subject: "Davis Roofing Solutions — quick opportunity I noticed",
    body: "Hi Team Drew,",
    at: "2026-09-23T18:00:00.000Z",
  });
  assert.equal(frozen.sent, false);
  assert.equal(frozen.state, "APPROVED_WAITING_FOR_LIVE");
  assert.equal(frozen.frozen.recipient, "frontdesk@davisroofingsolutions.com");
  assert.equal(isUnresolvedTask(frozen.state), false);
  assert.equal(isUnresolvedTask("OPEN"), true);
  assert.equal(isUnresolvedTask("SKIPPED"), true);
});

test("resolving a task keeps the same slot so the next task opens", () => {
  assert.equal(nextIndexAfterRemoval(0, 46), 0);
  assert.equal(nextIndexAfterRemoval(46, 0), null);
  assert.equal(ownerTaskStateFromHistory([{ action: "owner_task_approved_waiting" }]), "APPROVED_WAITING_FOR_LIVE");
  assert.equal(voiceTaskIntent("Show me the next one."), "next");
  assert.equal(voiceTaskIntent("Skip this one."), "skip");
  assert.equal(voiceTaskIntent("Not interested in this company."), "not_pursuing");
  assert.equal(voiceTaskIntent("Approve it."), "approve");
});

test("live mode uses Approve and Send, and next does not resolve the task", () => {
  assert.equal(approveLabel(false), "Approve & Send");
  assert.equal(isUnresolvedTask("OPEN"), true);
  assert.equal(primaryTaskCta("call", false).label, "View Call Brief");
  assert.equal(primaryTaskCta("reply", false).label, "Review Reply");
  assert.equal(primaryTaskCta("research", false).label, "Run Research");
});
