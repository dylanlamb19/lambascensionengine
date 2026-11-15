import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLAGS } from "../flags.ts";
import { sentinelPackageHealth } from "./health.ts";
import { PACKAGE_FULFILLMENT_TAB, packageFulfillmentNav } from "./nav.ts";
import { getTestPlan } from "./plans.ts";
import { MAX_ATTEMPTS, recordPurchase, setKillSwitch, tickFulfillment } from "./runner.ts";
import { stepIds } from "./steps.ts";
import { fulfillmentStorageKey } from "./storage.ts";
import { replaceTenant, selectTestPlan, sliceTenant, startMarketerOnboarding, workspaceIdForUser } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type FulfillmentState } from "./types.ts";
import { clientList, packageTabs, pipelineView } from "./view.ts";

const NOW = "2026-11-15T15:00:00.000Z";

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function openTwo(): { state: FulfillmentState; tenantA: string; tenantB: string } {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "B Agency", now: NOW });
  assert.equal(second.ok, true);
  if (!second.ok) throw new Error("b");
  return {
    state: second.state,
    tenantA: workspaceIdForUser("marketer-a") || "",
    tenantB: workspaceIdForUser("marketer-b") || "",
  };
}

test("onboarding is idempotent per marketer and does not bill", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(opened.created, true);
  assert.equal(opened.workspace.billingMode, "test");
  assert.equal(opened.workspace.planStatus, "test_inactive");
  assert.equal(opened.workspace.planId, "test_trial");
  const again = startMarketerOnboarding(opened.state, { userId: "marketer-a", workspaceName: "Renamed", now: NOW });
  assert.equal(again.ok && again.created, false);
  assert.equal(again.ok && again.workspace.name, "A Agency");
  assert.equal(workspaceIdForUser("marketer-a"), opened.workspace.id);
  assert.notEqual(workspaceIdForUser("marketer-a"), workspaceIdForUser("marketer-b"));
  assert.equal(workspaceIdForUser("  "), null);
});

test("a test plan can be recorded and cannot charge", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  const chosen = selectTestPlan(opened.state, opened.workspace.id, "test_operator", NOW);
  assert.equal(chosen.ok, true);
  if (!chosen.ok) return;
  assert.equal(chosen.workspace.planId, "test_operator");
  assert.equal(chosen.workspace.planStatus, "test_trial");
  assert.equal(chosen.workspace.billingMode, "test");
  assert.equal(getTestPlan("test_operator").billingMode, "test");
  assert.equal(JSON.stringify(chosen.workspace).includes("stripe"), false);
  const rejected = selectTestPlan(chosen.state, opened.workspace.id, "live_agency", NOW);
  assert.equal(rejected.ok, false);
});

test("each marketer sees only their own clients, packages, and pipelines", () => {
  const { state, tenantA, tenantB } = openTwo();
  const bought = recordPurchase(
    state,
    tenantA,
    { clientName: "North Roofing", packageId: "lead-follow-up", setupPayment: "recorded", monthlyPayment: "unrecorded", startedOn: "2026-11-15" },
    NOW,
    ids(),
  );
  assert.equal(bought.ok, true);
  if (!bought.ok) return;
  assert.equal(clientList(bought.state, tenantA).map((row) => row.name).join(), "North Roofing");
  assert.equal(clientList(bought.state, tenantB).length, 0);
  assert.equal(packageTabs(bought.state, tenantB, bought.clientId).length, 0);
  assert.equal(pipelineView(bought.state, tenantB, bought.enrollmentId), null);
  assert.equal(pipelineView(bought.state, tenantA, bought.enrollmentId)?.packageName, "Lead Follow-Up");
  const otherTick = tickFulfillment(bought.state, tenantB, NOW, { enabled: true });
  assert.equal(otherTick.advanced, 0);
  assert.equal(otherTick.state.steps[0]?.status, "pending");
  const otherKill = setKillSwitch(bought.state, tenantB, bought.enrollmentId, true, NOW);
  assert.equal(otherKill.enrollments[0]?.killSwitch, false);
  const healthB = sentinelPackageHealth(bought.state, tenantB, true, NOW);
  assert.equal(healthB.pipelines.length, 0);
  const healthA = sentinelPackageHealth(bought.state, tenantA, false, NOW);
  assert.equal(healthA.enabled, false);
  assert.equal(healthA.pipelines[0]?.health, "disabled");
});

test("estimate follow-ups stay inside the same workspace and do not copy lead follow-up", () => {
  const { state, tenantA, tenantB } = openTwo();
  const lead = recordPurchase(state, tenantA, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, ids());
  if (!lead.ok) throw new Error("lead");
  const foreign = recordPurchase(lead.state, tenantB, {
    clientName: "North Roofing",
    packageId: "estimate-follow-ups",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, ids());
  assert.equal(foreign.ok, false);
  const own = recordPurchase(lead.state, tenantA, {
    clientName: "North Roofing",
    packageId: "estimate-follow-ups",
    setupPayment: "waived",
    monthlyPayment: "recorded",
  }, NOW, ids());
  assert.equal(own.ok, true);
  const leadIds = new Set(stepIds("lead-follow-up"));
  for (const id of stepIds("estimate-follow-ups")) assert.equal(leadIds.has(id), false);
  if (!own.ok) return;
  const tabs = packageTabs(own.state, tenantA, own.clientId);
  assert.deepEqual(tabs.map((tab) => tab.name), ["Lead Follow-Up", "Estimate Follow-Ups"]);
});

test("the bundle opens the four included pipelines under one purchase", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  const bought = recordPurchase(opened.state, opened.workspace.id, {
    clientName: "Harbor HVAC",
    packageId: "google-meta-ai",
    setupPayment: "waived",
    monthlyPayment: "recorded",
  }, NOW, ids());
  if (!bought.ok) throw new Error("buy");
  const view = pipelineView(bought.state, opened.workspace.id, bought.enrollmentId);
  assert.ok(view);
  assert.equal(view?.setupFeeLabel, "No setup fee");
  const groups = [...new Set(view?.steps.map((step) => step.group))];
  assert.deepEqual(groups, [
    "AI Visibility Optimization",
    "Google Advertising",
    "Meta Advertising",
    "Lead Generation",
  ]);
});

test("due bookkeeping finishes and missing connections escalate without sending", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  const bought = recordPurchase(opened.state, opened.workspace.id, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, ids());
  if (!bought.ok) throw new Error("buy");
  const held = tickFulfillment(bought.state, opened.workspace.id, NOW, { enabled: false });
  assert.equal(held.state, bought.state);
  const started = tickFulfillment(bought.state, opened.workspace.id, NOW, { enabled: true });
  assert.ok(started.advanced > 0);
  const finished = tickFulfillment(started.state, opened.workspace.id, NOW, { enabled: true });
  const view = pipelineView(finished.state, opened.workspace.id, bought.enrollmentId);
  const byTitle = Object.fromEntries((view?.steps || []).map((step) => [step.title, step.status]));
  assert.equal(byTitle["Record the inquiry route"], "done");
  assert.equal(byTitle["Acknowledge the inquiry"], "needs_human");
  assert.equal(byTitle["Schedule follow-ups for unresponsive leads"], "done");
  assert.equal(byTitle["Weekly activity summary"], "pending");
  assert.match(view?.steps.find((step) => step.status === "needs_human")?.output || "", /Nothing was sent/);
  assert.match(view?.steps.find((step) => step.title.startsWith("Schedule"))?.output || "", /sales follow-up sequence was not started/);
  const again = tickFulfillment(finished.state, opened.workspace.id, NOW, { enabled: true });
  const ack = again.state.steps.find((step) => step.stepId === "acknowledge");
  const before = finished.state.steps.find((step) => step.stepId === "acknowledge");
  assert.equal(ack, before);
});

test("kill switch stops the pipeline for that workspace only", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  const bought = recordPurchase(opened.state, opened.workspace.id, {
    clientName: "North Roofing",
    packageId: "google-ads",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, ids());
  if (!bought.ok) throw new Error("buy");
  const stopped = setKillSwitch(bought.state, opened.workspace.id, bought.enrollmentId, true, NOW);
  const ticked = tickFulfillment(stopped, opened.workspace.id, NOW, { enabled: true });
  assert.equal(ticked.advanced, 0);
  assert.equal(ticked.state.steps.every((step) => step.status === "pending"), true);
  const health = sentinelPackageHealth(stopped, opened.workspace.id, true, NOW);
  assert.equal(health.pipelines[0]?.health, "stopped");
});

test("a throwing step retries then fails", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  const bought = recordPurchase(opened.state, opened.workspace.id, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, ids());
  if (!bought.ok) throw new Error("buy");
  let state = bought.state;
  let now = NOW;
  const runStep = () => {
    throw new Error("mailbox timeout");
  };
  for (let i = 0; i < 8; i += 1) {
    const ticked = tickFulfillment(state, opened.workspace.id, now, { enabled: true, runStep });
    state = ticked.state;
    now = new Date(new Date(now).getTime() + 5 * 60_000).toISOString();
  }
  const failed = state.steps.find((step) => step.status === "failed");
  assert.ok(failed);
  assert.equal(failed?.attempts, MAX_ATTEMPTS);
});

test("trial client cap is enforced inside the workspace", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  let state = opened.state;
  const factory = ids();
  for (const name of ["One Co", "Two Co", "Three Co"]) {
    const bought = recordPurchase(state, opened.workspace.id, {
      clientName: name,
      packageId: "reviews-gbp",
      setupPayment: "unrecorded",
      monthlyPayment: "recorded",
    }, NOW, factory);
    assert.equal(bought.ok, true);
    if (bought.ok) state = bought.state;
  }
  const blocked = recordPurchase(state, opened.workspace.id, {
    clientName: "Four Co",
    packageId: "reviews-gbp",
    setupPayment: "unrecorded",
    monthlyPayment: "recorded",
  }, NOW, factory);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /No charge was attempted/);
});

test("storage and slice helpers cannot mix tenants", () => {
  const { state, tenantA, tenantB } = openTwo();
  const bought = recordPurchase(state, tenantA, {
    clientName: "North Roofing",
    packageId: "meta-ads",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, ids());
  if (!bought.ok) throw new Error("buy");
  const sliced = sliceTenant(bought.state, tenantA);
  assert.equal(sliced.clients.length, 1);
  const poisoned = {
    ...sliced,
    clients: [...sliced.clients, { ...sliced.clients[0], id: "smuggled", tenantId: tenantB, name: "Hidden" }],
  };
  const replaced = replaceTenant(EMPTY_FULFILLMENT, tenantA, poisoned);
  assert.equal(replaced.clients.some((row) => row.tenantId === tenantB), false);
  assert.notEqual(fulfillmentStorageKey(tenantA), fulfillmentStorageKey(tenantB));
});

test("the fulfillment tab name is exact and hidden while the flag is off", () => {
  assert.equal(PACKAGE_FULFILLMENT_TAB, "Client Package Fulfillment");
  assert.deepEqual(packageFulfillmentNav(false), { visible: false, label: "Client Package Fulfillment" });
  assert.equal(packageFulfillmentNav(true).visible, true);
  assert.equal(packageFulfillmentNav().visible, FLAGS.PACKAGE_FULFILLMENT);
  const root = dirname(fileURLToPath(import.meta.url));
  const desk = readFileSync(join(root, "../../components/owner-desk.tsx"), "utf8");
  assert.match(desk, /packageFulfillmentNav\(\)/);
  assert.match(desk, /packageNav\.visible/);
  assert.match(desk, /packageNav\.label/);
  assert.doesNotMatch(desk, /signUp\.email/);
  assert.doesNotMatch(desk, /Create account/);
});

test("package modules do not send mail or hold payment secrets", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(root).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  const combined = files.map((name) => readFileSync(join(root, name), "utf8")).join("\n");
  assert.doesNotMatch(combined, /mail\/send|canSend|stripe|sk_live|STRIPE_SECRET/i);
  const reviews = readFileSync(join(root, "steps.ts"), "utf8");
  assert.match(reviews, /Reviews are not purchased and are not filtered/);
  assert.match(reviews, /owner sales calendar was not changed/);
});
