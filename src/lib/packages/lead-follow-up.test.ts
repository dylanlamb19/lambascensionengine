import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLAGS } from "../flags.ts";
import { stubConnect } from "./connections.ts";
import { sentinelPackageHealth } from "./health.ts";
import {
  LEAD_BACKOFF_MS,
  LEAD_MAX_ATTEMPTS,
  captureLead,
  leadRetryDelayMs,
  recordLeadReply,
  setLeadFollowUpKillSwitch,
  tickLeadFollowUp,
  tickPackagePipelines,
} from "./lead-follow-up.ts";
import { getTestPlan } from "./plans.ts";
import { addDays, recordPurchase } from "./runner.ts";
import { replaceTenant, sliceTenant, startMarketerOnboarding } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type FulfillmentState, type LeadStepRun } from "./types.ts";
import { usageFor } from "./usage.ts";
import { leadFollowUpView } from "./view.ts";

const NOW = "2026-11-15T15:00:00.000Z";
const root = dirname(fileURLToPath(import.meta.url));

function ids() {
  let n = 0;
  return () => `lead-${++n}`;
}

function openTwo(): { state: FulfillmentState; tenantA: string; tenantB: string } {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "B Agency", now: NOW });
  if (!second.ok) throw new Error("b");
  return { state: second.state, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

function buyLead(state: FulfillmentState, tenantId: string, clientName: string, factory = ids()) {
  return recordPurchase(state, tenantId, {
    clientName,
    packageId: "lead-follow-up",
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, factory);
}

function step(state: FulfillmentState, stepId: string): LeadStepRun | undefined {
  return state.leadSteps.find((row) => row.stepId === stepId);
}

test("the lead follow-up tick is a no-op while the flag is off", () => {
  assert.equal(FLAGS.PACKAGE_FULFILLMENT, false);
  const { state, tenantA } = openTwo();
  const bought = buyLead(state, tenantA, "North Roofing");
  if (!bought.ok) throw new Error(bought.reason);
  const captured = captureLead(bought.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    contactName: "Sam Ellis",
    contactEmail: "sam@example.com",
  }, NOW);
  assert.equal(captured.ok, false);
  if (!captured.ok) assert.match(captured.reason, /off/);
  const ticked = tickLeadFollowUp(bought.state, tenantA, NOW);
  assert.equal(ticked.advanced, 0);
  assert.equal(ticked.state, bought.state);
  const both = tickPackagePipelines(bought.state, tenantA, NOW);
  assert.equal(both.advanced, 0);
  assert.equal(both.state, bought.state);
  const killed = setLeadFollowUpKillSwitch(bought.state, tenantA, true, NOW);
  assert.equal(killed, bought.state);
  const replied = recordLeadReply(bought.state, tenantA, "missing", NOW);
  assert.equal(replied, bought.state);
});

test("workspace A cannot read or tick workspace B leads", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const boughtA = buyLead(state, tenantA, "North Roofing", factory);
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = buyLead(boughtA.state, tenantB, "South Plumbing", factory);
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const leadA = captureLead(boughtB.state, tenantA, {
    enrollmentId: boughtA.enrollmentId,
    contactName: "Sam Ellis",
    contactEmail: "sam@north.example",
  }, NOW, { enabled: true, ids: factory });
  if (!leadA.ok) throw new Error(leadA.reason);
  const leadB = captureLead(leadA.state, tenantB, {
    enrollmentId: boughtB.enrollmentId,
    contactName: "Pat Quinn",
    contactEmail: "pat@south.example",
  }, NOW, { enabled: true, ids: factory });
  if (!leadB.ok) throw new Error(leadB.reason);

  assert.equal(leadFollowUpView(leadB.state, tenantB, boughtA.enrollmentId), null);
  assert.equal(leadFollowUpView(leadB.state, tenantA, boughtB.enrollmentId), null);
  assert.equal(leadFollowUpView(leadB.state, tenantA, boughtA.enrollmentId)?.length, 1);
  assert.equal(leadFollowUpView(leadB.state, tenantA, boughtA.enrollmentId)?.[0]?.contactName, "Sam Ellis");

  const foreignCapture = captureLead(leadB.state, tenantB, {
    enrollmentId: boughtA.enrollmentId,
    contactName: "Smuggled",
  }, NOW, { enabled: true });
  assert.equal(foreignCapture.ok, false);

  const before = JSON.stringify(leadB.state.leadSteps.filter((row) => row.tenantId === tenantA));
  const otherTick = tickLeadFollowUp(leadB.state, tenantB, NOW, { enabled: true });
  assert.ok(otherTick.advanced > 0);
  assert.equal(JSON.stringify(otherTick.state.leadSteps.filter((row) => row.tenantId === tenantA)), before);
  assert.equal(otherTick.state.leadSteps.filter((row) => row.tenantId === tenantB).some((row) => row.status === "running"), true);

  const foreignReply = recordLeadReply(leadB.state, tenantB, leadA.leadId, NOW, { enabled: true });
  assert.equal(foreignReply.leads.find((row) => row.id === leadA.leadId)?.repliedAt, null);

  const sliced = sliceTenant(leadB.state, tenantA);
  const poisoned = {
    ...sliced,
    leads: [...sliced.leads, { ...sliced.leads[0], id: "smuggled", tenantId: tenantB, contactName: "Hidden" }],
  };
  const replaced = replaceTenant(EMPTY_FULFILLMENT, tenantA, poisoned);
  assert.equal(replaced.leads.some((row) => row.tenantId === tenantB), false);
  assert.equal(replaced.leads.length, 1);
  assert.equal(replaced.leadSteps.every((row) => row.tenantId === tenantA), true);
});

test("a workspace kill switch stops that workspace only", () => {
  const { state, tenantA, tenantB } = openTwo();
  const boughtA = buyLead(state, tenantA, "North Roofing", ids());
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = buyLead(boughtA.state, tenantB, "South Plumbing", ids());
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const leadA = captureLead(boughtB.state, tenantA, {
    enrollmentId: boughtA.enrollmentId,
    contactName: "Sam Ellis",
  }, NOW, { enabled: true, ids: ids() });
  if (!leadA.ok) throw new Error(leadA.reason);
  const leadB = captureLead(leadA.state, tenantB, {
    enrollmentId: boughtB.enrollmentId,
    contactName: "Pat Quinn",
  }, NOW, { enabled: true, ids: ids() });
  if (!leadB.ok) throw new Error(leadB.reason);

  const stopped = setLeadFollowUpKillSwitch(leadB.state, tenantA, true, NOW, { enabled: true });
  assert.equal(stopped.workspaces.find((row) => row.id === tenantA)?.leadFollowUpKillSwitch, true);
  assert.equal(stopped.workspaces.find((row) => row.id === tenantB)?.leadFollowUpKillSwitch, false);
  assert.match(stopped.leadSteps.find((row) => row.tenantId === tenantA)?.logs.at(-1)?.message || "", /Workspace kill switch is on/);
  const later = addDays(NOW, 10);
  const held = tickLeadFollowUp(stopped, tenantA, later, { enabled: true });
  assert.equal(held.advanced, 0);
  assert.equal(held.state, stopped);
  assert.equal(step(held.state, "captured")?.status, "pending");
  const neighbor = tickLeadFollowUp(stopped, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(neighbor.state.leadSteps.find((row) => row.tenantId === tenantA && row.stepId === "captured")?.status, "pending");
  const health = sentinelPackageHealth(stopped, tenantA, true, NOW);
  assert.equal(health.pipelines[0]?.health, "stopped");
});

test("a throwing step backs off and then needs a person", () => {
  const { state, tenantA } = openTwo();
  const bought = buyLead(state, tenantA, "North Roofing");
  if (!bought.ok) throw new Error(bought.reason);
  const captured = captureLead(bought.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    contactName: "Sam Ellis",
  }, NOW, { enabled: true, ids: ids() });
  if (!captured.ok) throw new Error(captured.reason);
  const runStep = () => {
    throw new Error("mailbox timeout");
  };
  let current = captured.state;
  let now = NOW;
  const started = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep });
  current = started.state;
  assert.equal(step(current, "captured")?.status, "running");

  const first = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep });
  current = first.state;
  const afterFirst = step(current, "captured");
  assert.equal(afterFirst?.status, "pending");
  assert.equal(afterFirst?.attempts, 1);
  assert.equal(afterFirst?.nextRunAt, addDaysMs(now, leadRetryDelayMs(1)));
  assert.equal(leadRetryDelayMs(1), LEAD_BACKOFF_MS);

  const early = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep });
  assert.equal(early.advanced, 0);
  assert.equal(early.state, current);

  now = afterFirst?.nextRunAt || now;
  current = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep }).state;
  assert.equal(step(current, "captured")?.status, "running");
  const second = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep });
  current = second.state;
  const afterSecond = step(current, "captured");
  assert.equal(afterSecond?.attempts, 2);
  assert.equal(afterSecond?.nextRunAt, addDaysMs(now, leadRetryDelayMs(2)));
  assert.equal(leadRetryDelayMs(2), LEAD_BACKOFF_MS * 2);

  now = afterSecond?.nextRunAt || now;
  current = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep }).state;
  const third = tickLeadFollowUp(current, tenantA, now, { enabled: true, runStep });
  current = third.state;
  const failed = step(current, "captured");
  assert.equal(failed?.status, "needs_human");
  assert.equal(failed?.attempts, LEAD_MAX_ATTEMPTS);
  assert.match(failed?.lastError || "", /mailbox timeout/);
  assert.match(failed?.output || "", /Needs a person/);
  assert.match(failed?.output || "", /Nothing was sent/);
  const day1 = step(current, "day-1");
  assert.equal(day1?.status, "needs_human");
  assert.match(day1?.output || "", /earlier step failed/);
  assert.equal(current.leads[0]?.status, "needs_human");
});

test("plan cap blocks this workspace and leaves the neighbor running", () => {
  const { state, tenantA, tenantB } = openTwo();
  const boughtA = buyLead(state, tenantA, "North Roofing", ids());
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = buyLead(boughtA.state, tenantB, "South Plumbing", ids());
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const leadA = captureLead(boughtB.state, tenantA, {
    enrollmentId: boughtA.enrollmentId,
    contactName: "Sam Ellis",
  }, NOW, { enabled: true, ids: ids() });
  if (!leadA.ok) throw new Error(leadA.reason);
  const leadB = captureLead(leadA.state, tenantB, {
    enrollmentId: boughtB.enrollmentId,
    contactName: "Pat Quinn",
  }, NOW, { enabled: true, ids: ids() });
  if (!leadB.ok) throw new Error(leadB.reason);
  const limit = getTestPlan("test_trial").pipelineRunLimit || 0;
  const capped = {
    ...leadB.state,
    usage: leadB.state.usage.map((row) => row.tenantId === tenantA ? { ...row, pipelineRuns: limit } : row),
  };
  const stopped = tickLeadFollowUp(capped, tenantA, NOW, { enabled: true });
  assert.equal(stopped.advanced, 0);
  assert.equal(usageFor(stopped.state, tenantA).pipelineRuns, limit);
  assert.equal(step(stopped.state, "captured")?.status, "pending");
  const notice = stopped.state.billingEvents.find((row) => row.tenantId === tenantA && row.type === "pipeline_limit");
  assert.ok(notice);
  assert.equal(notice?.amountCents, 0);
  assert.equal(notice?.billingMode, "test");
  const neighbor = tickLeadFollowUp(stopped.state, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(usageFor(neighbor.state, tenantA).pipelineRuns, limit);
  assert.equal(neighbor.state.billingEvents.some((row) => row.tenantId === tenantB && row.amountCents !== 0), false);
});

test("dry-run writes the draft and a connected test stub stays needs human", () => {
  const { state, tenantA } = openTwo();
  const bought = buyLead(state, tenantA, "North Roofing");
  if (!bought.ok) throw new Error(bought.reason);
  const missing = captureLead(bought.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    contactName: "Sam Ellis",
    contactEmail: "sam@example.com",
  }, NOW, { enabled: true, ids: ids() });
  if (!missing.ok) throw new Error(missing.reason);
  let current = settleImmediate(missing.state, tenantA, NOW);
  const speedMissing = leadFollowUpView(current, tenantA, bought.enrollmentId)?.[0]?.steps.find((row) => row.title === "Speed-to-lead reply");
  assert.equal(speedMissing?.status, "needs_human");
  assert.match(speedMissing?.lastError || "", /Missing connection: Mailbox/);
  assert.doesNotMatch(speedMissing?.lastError || "", /Connected \(test\)/);
  assert.match(speedMissing?.logs.map((row) => row.message).join("\n") || "", /Dry run/);
  assert.match(speedMissing?.logs.map((row) => row.message).join("\n") || "", /Nothing was sent/);
  assert.match(speedMissing?.draftedMessage || "", /Sam Ellis/);
  const day1 = leadFollowUpView(current, tenantA, bought.enrollmentId)?.[0]?.steps.find((row) => row.title === "Day 1 follow-up");
  assert.equal(day1?.status, "pending");
  assert.equal(day1?.nextRunAt, addDays(NOW, 1));
  assert.equal(day1?.attempts, 0);

  const connected = stubConnect(bought.state, tenantA, "mailbox", NOW);
  if (!connected.ok) throw new Error(connected.reason);
  const stubLead = captureLead(connected.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    contactName: "Riley Chen",
    contactPhone: "555-0100",
  }, NOW, { enabled: true, ids: ids() });
  if (!stubLead.ok) throw new Error(stubLead.reason);
  current = settleImmediate(stubLead.state, tenantA, NOW);
  const speedStub = current.leadSteps.find((row) => row.leadId === stubLead.leadId && row.stepId === "speed-to-lead");
  assert.equal(speedStub?.status, "needs_human");
  assert.match(speedStub?.lastError || "", /Connected \(test\): Mailbox/);
  assert.match(speedStub?.lastError || "", /Missing connection: Mailbox/);
  assert.match(speedStub?.logs.map((row) => row.message).join("\n") || "", /Dry run/);
  assert.match(speedStub?.logs.map((row) => row.message).join("\n") || "", /Not sent by text/);
  assert.match(speedStub?.logs.map((row) => row.message).join("\n") || "", /Nothing was sent/);
  assert.equal(speedStub?.attempts, 1);

  const dayLater = addDays(NOW, 1);
  const due = tickLeadFollowUp(tickLeadFollowUp(current, tenantA, dayLater, { enabled: true }).state, tenantA, dayLater, { enabled: true });
  const follow = due.state.leadSteps.find((row) => row.leadId === stubLead.leadId && row.stepId === "day-1");
  assert.equal(follow?.status, "needs_human");
  assert.match(follow?.draftedMessage || "", /Riley Chen/);
  const day3 = due.state.leadSteps.find((row) => row.leadId === stubLead.leadId && row.stepId === "day-3");
  assert.equal(day3?.status, "pending");
  assert.equal(day3?.nextRunAt, addDays(NOW, 3));

  const replied = recordLeadReply(due.state, tenantA, stubLead.leadId, dayLater, { enabled: true });
  const stopped = replied.leadSteps.find((row) => row.leadId === stubLead.leadId && row.stepId === "day-3");
  assert.equal(replied.leads.find((row) => row.id === stubLead.leadId)?.status, "needs_human");
  assert.equal(stopped?.status, "needs_human");
  assert.match(stopped?.logs.map((row) => row.message).join("\n") || "", /Lead replied/);
  const after = tickLeadFollowUp(replied, tenantA, addDays(NOW, 8), { enabled: true });
  assert.equal(after.state.leadSteps.find((row) => row.leadId === stubLead.leadId && row.stepId === "day-7")?.status, "needs_human");
  assert.equal(after.state.leadSteps.find((row) => row.leadId === stubLead.leadId && row.stepId === "day-7")?.draftedMessage, null);

  const src = ["lead-follow-up.ts", "dry-run-sender.ts"].map((name) => readFileSync(join(root, name), "utf8")).join("\n");
  assert.doesNotMatch(src, /from ["'][^"']*mail\//);
  assert.doesNotMatch(src, /canSend|twilio|mail\/send|fetch\(|sk_live|STRIPE_SECRET/i);
  assert.match(src, /Dry run/);
});

function addDaysMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

/** Run the immediate capture and speed-to-lead steps. Later days stay scheduled. */
function settleImmediate(state: FulfillmentState, tenantId: string, now: string): FulfillmentState {
  let current = state;
  for (let i = 0; i < 4; i += 1) {
    current = tickLeadFollowUp(current, tenantId, now, { enabled: true }).state;
  }
  return current;
}
