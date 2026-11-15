import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBilling } from "./billing.ts";
import { credentialsFor, listConnections, stubConnect } from "./connections.ts";
import { addClient, recordPurchase, tickFulfillment } from "./runner.ts";
import { confirmWorkspace, finishOnboarding, replaceTenant, startMarketerOnboarding, workspaceFor } from "./tenancy.ts";
import { EMPTY_FULFILLMENT } from "./types.ts";
import { pipelineView } from "./view.ts";

const NOW = "2026-11-15T15:00:00.000Z";

function openPair() {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "B Agency", now: NOW });
  if (!second.ok) throw new Error("b");
  return { state: second.state, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

test("onboarding walks workspace, plan, client, package, then connections", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!opened.ok) throw new Error("open");
  assert.equal(opened.workspace.onboarding, "workspace");
  assert.equal(finishOnboarding(opened.state, opened.workspace.id).ok, false);
  const named = confirmWorkspace(opened.state, opened.workspace.id, "A Agency Desk", NOW);
  if (!named.ok) throw new Error("name");
  assert.equal(named.workspace.onboarding, "plan");
  const planned = fakeBilling.selectPlan(named.state, named.workspace.id, "test_operator", NOW, "bill-1");
  if (!planned.ok) throw new Error("plan");
  assert.equal(planned.event.amountCents, 0);
  assert.equal(planned.event.billingMode, "test");
  const client = addClient(planned.state, named.workspace.id, "North Roofing", NOW, (() => { let n = 0; return () => `c-${++n}`; })());
  if (!client.ok) throw new Error(client.reason);
  assert.equal(workspaceFor(client.state, named.workspace.id)?.onboarding, "packages");
  const again = recordPurchase(client.state, named.workspace.id, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, (() => { let n = 0; return () => `d-${++n}`; })());
  if (!again.ok) throw new Error(again.reason);
  assert.equal(workspaceFor(again.state, named.workspace.id)?.onboarding, "connections");
  const done = finishOnboarding(again.state, named.workspace.id);
  assert.equal(done.ok, true);
  if (done.ok) assert.equal(done.workspace.onboarding, "desk");
});

test("a connection stub is tenant scoped and pipelines name the missing one", () => {
  const { state, tenantA, tenantB } = openPair();
  const boughtA = recordPurchase(state, tenantA, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, (() => { let n = 0; return () => `a-${++n}`; })());
  if (!boughtA.ok) throw new Error("buy");
  const blocked = tickFulfillment(
    tickFulfillment(boughtA.state, tenantA, NOW, { enabled: true }).state,
    tenantA,
    NOW,
    { enabled: true, credentials: credentialsFor(boughtA.state, tenantA) },
  );
  const ack = pipelineView(blocked.state, tenantA, boughtA.enrollmentId)?.steps.find((step) => step.title === "Acknowledge the inquiry");
  assert.match(ack?.output || "", /Missing connection: Mailbox/);
  const connected = stubConnect(blocked.state, tenantA, "mailbox", NOW);
  if (!connected.ok) throw new Error("connect");
  assert.equal(credentialsFor(connected.state, tenantA).has("client_mailbox"), true);
  assert.equal(credentialsFor(connected.state, tenantB).has("client_mailbox"), false);
  assert.equal(listConnections(connected.state, tenantB).every((row) => row.status === "missing"), true);
  const poisoned = replaceTenant(EMPTY_FULFILLMENT, tenantB, connected.state);
  assert.equal(poisoned.connections.length, 0);
  assert.equal(poisoned.clients.length, 0);
  assert.equal(credentialsFor(poisoned, tenantB).has("client_mailbox"), false);
  const unblocked = tickFulfillment(
    { ...connected.state, steps: connected.state.steps.map((step) => step.stepId === "acknowledge" ? { ...step, status: "pending" as const, nextRunAt: NOW } : step) },
    tenantA,
    NOW,
    { enabled: true, credentials: credentialsFor(connected.state, tenantA) },
  );
  const running = tickFulfillment(unblocked.state, tenantA, NOW, { enabled: true, credentials: credentialsFor(connected.state, tenantA) });
  const next = pipelineView(running.state, tenantA, boughtA.enrollmentId)?.steps.find((step) => step.title === "Acknowledge the inquiry");
  assert.match(next?.output || "", /Mailbox is marked connected in test mode/);
  assert.doesNotMatch(next?.output || "", /Missing connection: Mailbox/);
});

test("plan limits come from the test billing provider and stay inside one workspace", () => {
  const { state, tenantA, tenantB } = openPair();
  const agency = fakeBilling.selectPlan(state, tenantA, "test_agency", NOW, "bill-a");
  if (!agency.ok) throw new Error("agency");
  assert.equal(fakeBilling.clientLimit("test_trial"), 3);
  assert.equal(fakeBilling.clientLimit("test_operator"), 25);
  assert.equal(fakeBilling.clientLimit("test_agency"), null);
  const crowded = {
    ...agency.state,
    clients: Array.from({ length: 3 }, (_, index) => ({
      id: `b-${index}`,
      tenantId: tenantB,
      name: `Client ${index}`,
      createdAt: NOW,
    })),
  };
  const blocked = fakeBilling.assertCanAddClient(crowded, tenantB, NOW, "limit-b");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /No charge was attempted/);
  const stillOpen = fakeBilling.assertCanAddClient(crowded, tenantA, NOW, "limit-a");
  assert.equal(stillOpen.ok, true);
  const webhook = fakeBilling.handleWebhook(agency.state, tenantA, { type: "plan.updated", planId: "test_operator" }, NOW, "wh-1");
  if (!webhook.ok) throw new Error(webhook.reason);
  assert.equal(webhook.event.amountCents, 0);
  assert.equal(webhook.event.billingMode, "test");
  assert.equal(webhook.event.tenantId, tenantA);
  assert.equal(workspaceFor(webhook.state, tenantA)?.planId, "test_operator");
  assert.equal(webhook.state.billingEvents.some((row) => row.tenantId === tenantB), false);
  const foreign = fakeBilling.handleWebhook(webhook.state, "ws_missing", { type: "plan.updated", planId: "test_agency" }, NOW, "wh-2");
  assert.equal(foreign.ok, false);
  const badPlan = fakeBilling.handleWebhook(webhook.state, tenantA, { type: "plan.updated", planId: "live_plan" }, NOW, "wh-3");
  assert.equal(badPlan.ok, false);
});

test("billing and connection modules do not read keys or the environment", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const billing = readFileSync(join(root, "billing.ts"), "utf8");
  const connections = readFileSync(join(root, "connections.ts"), "utf8");
  assert.doesNotMatch(billing, /process\.env|sk_live|stripe/i);
  assert.doesNotMatch(connections, /process\.env|token|secret|apiKey/i);
  assert.match(billing, /interface BillingProvider/);
  assert.match(billing, /handleWebhook/);
});
