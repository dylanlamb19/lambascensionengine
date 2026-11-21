import assert from "node:assert/strict";
import test from "node:test";
import { FLAGS } from "../flags.ts";
import { fakeBilling } from "./billing.ts";
import { CADENCE_MAX_ATTEMPTS } from "./cadence.ts";
import { stubConnect } from "./connections.ts";
import { fulfillmentHealthSummary, sentinelPackageHealth } from "./health.ts";
import { saveClientIntake } from "./lead-generation.ts";
import { approveMetaPlan, saveMetaBudget, setMetaAdsKillSwitch, tickMetaAds } from "./meta-ads.ts";
import { saveOfficeWorkflow, setOfficeAutomationKillSwitch, tickOfficeAutomation } from "./office-automation.ts";
import { tickPackagePipelines } from "./pipelines.ts";
import { getTestPlan } from "./plans.ts";
import { recordPurchase, setKillSwitch, type IdFactory } from "./runner.ts";
import { startMarketerOnboarding, selectTestPlan, replaceTenant, sliceTenant } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type FulfillmentState, type PackageRunStep } from "./types.ts";
import { usageFor } from "./usage.ts";
import { bundleRollup, clientPackageOverview, packageRunViews, pipelineView } from "./view.ts";

const NOW = "2026-11-21T15:00:00.000Z";

function ids(): IdFactory {
  let n = 0;
  return () => `cat-${++n}`;
}

function openTwo() {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "Harbor Marketing", now: NOW });
  if (!first.ok) throw new Error(first.reason);
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "Prairie Studio", now: NOW });
  if (!second.ok) throw new Error(second.reason);
  return { state: second.state, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

function buy(state: FulfillmentState, tenantId: string, clientName: string, packageId: "meta-ads" | "office-automation" | "google-ads" | "google-meta-ai" | "ai-visibility", factory: IdFactory) {
  return recordPurchase(state, tenantId, {
    clientName,
    packageId,
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, factory);
}

function connect(state: FulfillmentState, tenantId: string, kind: string) {
  const connected = stubConnect(state, tenantId, kind, NOW);
  if (!connected.ok) throw new Error(connected.reason);
  return connected.state;
}

function remember(state: FulfillmentState, tenantId: string, clientId: string) {
  const saved = saveClientIntake(state, tenantId, {
    clientId,
    businessName: "North Roofing",
    phone: "555-0100",
    address: "1 Harbor Ave",
    website: "https://north.example",
    offer: "Roof repair",
    serviceArea: "Harbor County",
  }, NOW, { enabled: true });
  if (!saved.ok) throw new Error(saved.reason);
  return saved.state;
}

function metaStep(state: FulfillmentState, stepId: string, tenantId: string): PackageRunStep | undefined {
  return (state.packageRunSteps || []).find((row) => row.tenantId === tenantId && row.packageId === "meta-ads" && row.stepId === stepId);
}

function officeStep(state: FulfillmentState, stepId: string, tenantId: string): PackageRunStep | undefined {
  return (state.packageRunSteps || []).find((row) => row.tenantId === tenantId && row.packageId === "office-automation" && row.stepId === stepId);
}

test("meta and office stay inside the workspace that owns them", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const north = buy(state, tenantA, "North Roofing", "meta-ads", factory);
  if (!north.ok) throw new Error(north.reason);
  const south = buy(north.state, tenantB, "North Roofing", "meta-ads", factory);
  if (!south.ok) throw new Error(south.reason);
  const office = buy(south.state, tenantA, "North Roofing", "office-automation", factory);
  if (!office.ok) throw new Error(office.reason);
  let current = connect(office.state, tenantA, "meta");
  current = connect(current, tenantB, "meta");
  current = remember(current, tenantA, north.clientId);
  const budget = saveMetaBudget(current, tenantA, { enrollmentId: north.enrollmentId, proposedCents: 40000 }, NOW, { enabled: true });
  if (!budget.ok) throw new Error(budget.reason);
  const workflow = saveOfficeWorkflow(budget.state, tenantA, {
    enrollmentId: office.enrollmentId,
    kind: "document-collection",
    scheduleNote: "Next business morning.",
  }, NOW, { enabled: true });
  if (!workflow.ok) throw new Error(workflow.reason);
  const foreignBudget = saveMetaBudget(workflow.state, tenantB, { enrollmentId: north.enrollmentId, proposedCents: 1000 }, NOW, { enabled: true });
  assert.equal(foreignBudget.ok, false);
  const foreignWorkflow = saveOfficeWorkflow(workflow.state, tenantB, { enrollmentId: office.enrollmentId, kind: "document-collection" }, NOW, { enabled: true });
  assert.equal(foreignWorkflow.ok, false);
  let ran = workflow.state;
  for (let i = 0; i < 8; i += 1) ran = tickMetaAds(ran, tenantA, NOW, { enabled: true }).state;
  for (let i = 0; i < 4; i += 1) ran = tickOfficeAutomation(ran, tenantA, NOW, { enabled: true }).state;
  assert.equal(metaStep(ran, "creative-plan", tenantA)?.status, "done");
  assert.match(metaStep(ran, "creative-plan", tenantA)?.output || "", /No Meta API was called/);
  assert.match(metaStep(ran, "creative-plan", tenantA)?.logs.map((row) => row.message).join("\n") || "", /Creative plan drafted/);
  assert.equal(packageRunViews(ran, tenantB, north.enrollmentId), null);
  assert.equal(packageRunViews(ran, tenantA, south.enrollmentId), null);
  assert.equal((ran.metaBudgetNotes || []).some((row) => row.tenantId === tenantB), false);
  assert.equal((ran.officeWorkflows || []).some((row) => row.tenantId === tenantB), false);
  const sliced = sliceTenant(ran, tenantA);
  const poisoned = {
    ...sliced,
    metaBudgetNotes: [...sliced.metaBudgetNotes, { ...sliced.metaBudgetNotes[0], enrollmentId: "smuggled", tenantId: tenantB, clientId: "other" }],
    officeWorkflows: [...sliced.officeWorkflows, { ...sliced.officeWorkflows[0], enrollmentId: "smuggled", tenantId: tenantB, clientId: "other" }],
  };
  const replaced = replaceTenant(EMPTY_FULFILLMENT, tenantA, poisoned);
  assert.equal(replaced.metaBudgetNotes.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.officeWorkflows.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.metaBudgetNotes.some((row) => row.enrollmentId === "smuggled"), false);
  const neighbor = tickMetaAds(ran, tenantB, NOW, { enabled: true });
  assert.equal(metaStep(neighbor.state, "creative-plan", tenantB)?.tenantId, tenantB);
  assert.notEqual(metaStep(neighbor.state, "creative-plan", tenantA)?.output, metaStep(neighbor.state, "creative-plan", tenantB)?.output);
});

test("retries wait 60s then 120s and then need a person", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const bought = buy(state, tenantA, "North Roofing", "meta-ads", factory);
  if (!bought.ok) throw new Error(bought.reason);
  const office = buy(bought.state, tenantA, "North Roofing", "office-automation", factory);
  if (!office.ok) throw new Error(office.reason);
  let current = connect(office.state, tenantA, "meta");
  current = remember(current, tenantA, bought.clientId);
  const budget = saveMetaBudget(current, tenantA, { enrollmentId: bought.enrollmentId, proposedCents: 1000 }, NOW, { enabled: true });
  if (!budget.ok) throw new Error(budget.reason);
  const workflow = saveOfficeWorkflow(budget.state, tenantA, { enrollmentId: office.enrollmentId, kind: "document-collection" }, NOW, { enabled: true });
  if (!workflow.ok) throw new Error(workflow.reason);
  const runStep = () => {
    throw new Error("adapter timeout");
  };
  let meta = workflow.state;
  let at = NOW;
  meta = tickMetaAds(meta, tenantA, at, { enabled: true, runStep }).state;
  meta = tickMetaAds(meta, tenantA, at, { enabled: true, runStep }).state;
  const first = metaStep(meta, "creative-plan", tenantA);
  assert.equal(first?.status, "pending");
  assert.equal(first?.attempts, 1);
  assert.equal(first?.nextRunAt, new Date(Date.parse(at) + 60_000).toISOString());
  assert.match(first?.logs.map((row) => row.message).join("\n") || "", /Retry 1/);
  at = first?.nextRunAt || at;
  meta = tickMetaAds(meta, tenantA, at, { enabled: true, runStep }).state;
  meta = tickMetaAds(meta, tenantA, at, { enabled: true, runStep }).state;
  const second = metaStep(meta, "creative-plan", tenantA);
  assert.equal(second?.attempts, 2);
  assert.equal(second?.nextRunAt, new Date(Date.parse(at) + 120_000).toISOString());
  at = second?.nextRunAt || at;
  meta = tickMetaAds(meta, tenantA, at, { enabled: true, runStep }).state;
  meta = tickMetaAds(meta, tenantA, at, { enabled: true, runStep }).state;
  const failed = metaStep(meta, "creative-plan", tenantA);
  assert.equal(failed?.status, "needs_human");
  assert.equal(failed?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.match(failed?.output || "", /Needs a person/);
  assert.match(failed?.output || "", /No spend was made/);
  assert.equal(metaStep(meta, "audience-plan", tenantA)?.status, "needs_human");

  let desk = workflow.state;
  let when = NOW;
  desk = tickOfficeAutomation(desk, tenantA, when, { enabled: true, runStep }).state;
  desk = tickOfficeAutomation(desk, tenantA, when, { enabled: true, runStep }).state;
  when = officeStep(desk, "intake", tenantA)?.nextRunAt || when;
  desk = tickOfficeAutomation(desk, tenantA, when, { enabled: true, runStep }).state;
  desk = tickOfficeAutomation(desk, tenantA, when, { enabled: true, runStep }).state;
  when = officeStep(desk, "intake", tenantA)?.nextRunAt || when;
  desk = tickOfficeAutomation(desk, tenantA, when, { enabled: true, runStep }).state;
  desk = tickOfficeAutomation(desk, tenantA, when, { enabled: true, runStep }).state;
  assert.equal(officeStep(desk, "intake", tenantA)?.status, "needs_human");
  assert.equal(officeStep(desk, "schedule", tenantA)?.status, "needs_human");
  assert.match(officeStep(desk, "schedule", tenantA)?.output || "", /Nothing was charged/);
});

test("kill switches stop one pipeline and leave the neighbor running", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const north = buy(state, tenantA, "North Roofing", "meta-ads", factory);
  if (!north.ok) throw new Error(north.reason);
  const south = buy(north.state, tenantA, "Lakeside HVAC", "meta-ads", factory);
  if (!south.ok) throw new Error(south.reason);
  const neighbor = buy(south.state, tenantB, "Red Barn Roofing", "meta-ads", factory);
  if (!neighbor.ok) throw new Error(neighbor.reason);
  const office = buy(neighbor.state, tenantA, "North Roofing", "office-automation", factory);
  if (!office.ok) throw new Error(office.reason);
  let current = connect(office.state, tenantA, "meta");
  current = connect(current, tenantB, "meta");
  const workspaceStop = setMetaAdsKillSwitch(current, tenantA, true, NOW, { enabled: true });
  assert.equal(workspaceStop.workspaces.find((row) => row.id === tenantA)?.metaAdsKillSwitch, true);
  assert.equal(workspaceStop.workspaces.find((row) => row.id === tenantB)?.metaAdsKillSwitch, false);
  const held = tickMetaAds(workspaceStop, tenantA, NOW, { enabled: true });
  assert.equal(held.advanced, 0);
  assert.equal(metaStep(held.state, "creative-plan", tenantA)?.status, "pending");
  const moving = tickMetaAds(held.state, tenantB, NOW, { enabled: true });
  assert.equal(moving.advanced, 1);
  assert.equal(sentinelPackageHealth(moving.state, tenantA, true, NOW).pipelines.find((row) => row.packageId === "meta-ads")?.health, "stopped");
  assert.notEqual(sentinelPackageHealth(moving.state, tenantB, true, NOW).pipelines.find((row) => row.enrollmentId === neighbor.enrollmentId)?.health, "stopped");
  const cleared = setMetaAdsKillSwitch(moving.state, tenantA, false, NOW, { enabled: true });
  const clientStop = setKillSwitch(cleared, tenantA, north.enrollmentId, true, NOW);
  const after = tickMetaAds(clientStop, tenantA, NOW, { enabled: true });
  assert.equal(metaStep(after.state, "creative-plan", tenantA)?.status, "pending");
  const southStep = (after.state.packageRunSteps || []).find((row) => row.enrollmentId === south.enrollmentId && row.stepId === "creative-plan");
  assert.equal(southStep?.status, "running");
  const officeMoving = tickOfficeAutomation(after.state, tenantA, NOW, { enabled: true });
  assert.equal(officeMoving.advanced, 1);
  const officeStop = setOfficeAutomationKillSwitch(officeMoving.state, tenantA, true, NOW, { enabled: true });
  assert.equal(tickOfficeAutomation(officeStop, tenantA, NOW, { enabled: true }).advanced, 0);
  const beforeNeighbor = (officeStop.packageRunSteps || []).find((row) => row.tenantId === tenantB && row.stepId === "creative-plan")?.status;
  const neighborTick = tickMetaAds(officeStop, tenantB, NOW, { enabled: true });
  const afterNeighbor = (neighborTick.state.packageRunSteps || []).find((row) => row.tenantId === tenantB && row.stepId === "creative-plan")?.status;
  assert.equal(neighborTick.advanced, 1);
  assert.notEqual(afterNeighbor, beforeNeighbor);
});

test("a missing connection, an unnamed workflow, and an over-cap budget need a person", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const meta = buy(state, tenantA, "North Roofing", "meta-ads", factory);
  if (!meta.ok) throw new Error(meta.reason);
  const office = buy(meta.state, tenantA, "North Roofing", "office-automation", factory);
  if (!office.ok) throw new Error(office.reason);
  let missing = office.state;
  for (let i = 0; i < 4; i += 1) missing = tickMetaAds(missing, tenantA, NOW, { enabled: true }).state;
  assert.equal(metaStep(missing, "creative-plan", tenantA)?.status, "needs_human");
  assert.match(metaStep(missing, "creative-plan", tenantA)?.output || "", /Missing connection: Meta/);
  assert.equal(metaStep(missing, "audience-plan", tenantA)?.status, "needs_human");
  assert.match(metaStep(missing, "approval", tenantA)?.output || "", /No spend was made/);
  let unnamed = missing;
  for (let i = 0; i < 4; i += 1) unnamed = tickOfficeAutomation(unnamed, tenantA, NOW, { enabled: true }).state;
  assert.match(officeStep(unnamed, "intake", tenantA)?.output || "", /not agreed/);
  assert.equal(officeStep(unnamed, "invoice-reminder", tenantA)?.status, "needs_human");
  assert.match(officeStep(unnamed, "invoice-reminder", tenantA)?.output || "", /Needs a person/);

  const capBuy = buy(unnamed, tenantA, "Cap Roofing", "meta-ads", factory);
  if (!capBuy.ok) throw new Error(capBuy.reason);
  let ready = connect(capBuy.state, tenantA, "meta");
  ready = remember(ready, tenantA, capBuy.clientId);
  const over = saveMetaBudget(ready, tenantA, { enrollmentId: capBuy.enrollmentId, proposedCents: 60000 }, NOW, { enabled: true });
  if (!over.ok) throw new Error(over.reason);
  let capped = over.state;
  for (let i = 0; i < 8; i += 1) capped = tickMetaAds(capped, tenantA, NOW, { enabled: true }).state;
  const budgetStep = (capped.packageRunSteps || []).find((row) => row.enrollmentId === capBuy.enrollmentId && row.stepId === "budget-check");
  assert.equal(budgetStep?.status, "needs_human");
  assert.match(budgetStep?.output || "", /Over the test plan ad budget cap/);
  assert.match(budgetStep?.output || "", /Nothing was spent/);
  const refused = approveMetaPlan(capped, tenantA, capBuy.enrollmentId, NOW, { enabled: true });
  assert.equal(refused.ok, false);
  assert.equal(getTestPlan("test_trial").adBudgetCapCents, 50000);
  const keys = saveMetaBudget(capped, tenantA, { enrollmentId: capBuy.enrollmentId, proposedCents: 1000, accessToken: "secret" }, NOW, { enabled: true });
  assert.equal(keys.ok, false);
  if (!keys.ok) assert.match(keys.reason, /not stored/);

  const agency = selectTestPlan(capped, tenantA, "test_agency", NOW);
  if (!agency.ok) throw new Error(agency.reason);
  const within = saveMetaBudget(agency.state, tenantA, { enrollmentId: capBuy.enrollmentId, proposedCents: 1000000 }, NOW, { enabled: true });
  if (!within.ok) throw new Error(within.reason);
  let cleared = within.state;
  for (let i = 0; i < 6; i += 1) cleared = tickMetaAds(cleared, tenantA, NOW, { enabled: true }).state;
  const clearedBudget = (cleared.packageRunSteps || []).find((row) => row.enrollmentId === capBuy.enrollmentId && row.stepId === "budget-check");
  const clearedGate = (cleared.packageRunSteps || []).find((row) => row.enrollmentId === capBuy.enrollmentId && row.stepId === "approval");
  assert.equal(clearedBudget?.status, "done");
  assert.match(clearedBudget?.output || "", /does not set a budget/);
  assert.equal(clearedGate?.status, "needs_human");
  const approved = approveMetaPlan(cleared, tenantA, capBuy.enrollmentId, NOW, { enabled: true });
  if (!approved.ok) throw new Error(approved.reason);
  const approvedGate = (approved.state.packageRunSteps || []).find((row) => row.enrollmentId === capBuy.enrollmentId && row.stepId === "approval");
  assert.equal(approvedGate?.status, "done");
  assert.match(approvedGate?.output || "", /Nothing was pushed to Meta/);
  assert.equal(approved.state.billingEvents.every((row) => row.amountCents === 0), true);
  assert.equal((approved.state.metaBudgetNotes || []).find((row) => row.enrollmentId === capBuy.enrollmentId)?.status, "approved");

  const ambiguous = saveOfficeWorkflow(approved.state, tenantA, { enrollmentId: office.enrollmentId, kind: "sold-job-handoff", ambiguous: true }, NOW, { enabled: true });
  if (!ambiguous.ok) throw new Error(ambiguous.reason);
  let vague = ambiguous.state;
  for (let i = 0; i < 4; i += 1) vague = tickOfficeAutomation(vague, tenantA, NOW, { enabled: true }).state;
  assert.match(officeStep(vague, "intake", tenantA)?.output || "", /ambiguous/);
  assert.equal(officeStep(vague, "schedule", tenantA)?.status, "needs_human");
  const summary = fulfillmentHealthSummary(vague, tenantA);
  assert.ok((summary.find((row) => row.packageId === "office-automation")?.needsHuman || 0) > 0);
  assert.equal(sentinelPackageHealth(vague, tenantA, true, NOW).pipelines.find((row) => row.enrollmentId === office.enrollmentId)?.health, "degraded");
});

test("an invoice reminder reads the test invoice and does not charge", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const bought = buy(state, tenantA, "North Roofing", "office-automation", factory);
  if (!bought.ok) throw new Error(bought.reason);
  const issued = fakeBilling.issueInvoice(bought.state, tenantA, NOW, "inv-office");
  if (!issued.ok) throw new Error(issued.reason);
  const workflow = saveOfficeWorkflow(issued.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    kind: "invoice-reminders",
    scheduleNote: "Next business morning.",
  }, NOW, { enabled: true });
  if (!workflow.ok) throw new Error(workflow.reason);
  let current = workflow.state;
  for (let i = 0; i < 10; i += 1) current = tickOfficeAutomation(current, tenantA, NOW, { enabled: true }).state;
  const reminder = officeStep(current, "invoice-reminder", tenantA);
  assert.equal(reminder?.status, "done");
  assert.match(reminder?.output || "", /inv-office/);
  assert.match(reminder?.output || "", /\$0/);
  assert.match(reminder?.output || "", /Nothing was charged/);
  assert.match(reminder?.logs.map((row) => row.message).join("\n") || "", /fakeBilling/);
  const invoice = current.invoices.find((row) => row.id === "inv-office");
  assert.equal(invoice?.status, "open");
  assert.equal(invoice?.amountCents, 0);
  assert.equal(current.invoices.filter((row) => row.tenantId === tenantB).length, 0);
  const billed = {
    ...current,
    invoices: current.invoices.map((row) => row.id === "inv-office" ? { ...row, amountCents: 1200 as 0 } : row),
  };
  const fresh = buy(billed, tenantA, "Lakeside HVAC", "office-automation", factory);
  if (!fresh.ok) throw new Error(fresh.reason);
  const noted = saveOfficeWorkflow(fresh.state, tenantA, { enrollmentId: fresh.enrollmentId, kind: "invoice-reminders" }, NOW, { enabled: true });
  if (!noted.ok) throw new Error(noted.reason);
  let again = noted.state;
  for (let i = 0; i < 10; i += 1) again = tickOfficeAutomation(again, tenantA, NOW, { enabled: true }).state;
  const blocked = (again.packageRunSteps || []).find((row) => row.enrollmentId === fresh.enrollmentId && row.stepId === "invoice-reminder");
  assert.equal(blocked?.status, "needs_human");
  assert.match(blocked?.output || "", /does not charge/);
  assert.equal(again.invoices.find((row) => row.id === "inv-office")?.status, "open");
});

test("a bundle fans out once, skips a member bought separately, and the kill switch cascades", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const google = buy(state, tenantA, "North Roofing", "google-ads", factory);
  if (!google.ok) throw new Error(google.reason);
  const south = buy(google.state, tenantA, "Lakeside HVAC", "google-ads", factory);
  if (!south.ok) throw new Error(south.reason);
  const neighbor = buy(south.state, tenantB, "Red Barn Roofing", "google-ads", factory);
  if (!neighbor.ok) throw new Error(neighbor.reason);
  const bundle = buy(neighbor.state, tenantA, "North Roofing", "google-meta-ai", factory);
  if (!bundle.ok) throw new Error(bundle.reason);
  const before = bundle.state.enrollments.filter((row) => row.tenantId === tenantA && row.clientId === google.clientId).length;
  const again = buy(bundle.state, tenantA, "North Roofing", "meta-ads", factory);
  if (!again.ok) throw new Error(again.reason);
  assert.equal(again.enrollmentId, bundle.enrollmentId);
  assert.equal(again.state.enrollments.filter((row) => row.tenantId === tenantA && row.clientId === google.clientId).length, before);
  assert.equal(again.state.enrollments.some((row) => row.packageId === "meta-ads" && row.clientId === google.clientId), false);
  let current = connect(again.state, tenantA, "meta");
  current = connect(current, tenantA, "google_ads");
  current = connect(current, tenantB, "google_ads");
  current = remember(current, tenantA, google.clientId);
  current = tickPackagePipelines(current, tenantA, NOW, { enabled: true }).state;
  current = tickPackagePipelines(current, tenantB, NOW, { enabled: true }).state;
  const northRuns = (current.packageRuns || []).filter((row) => row.tenantId === tenantA && row.clientId === google.clientId);
  assert.equal(northRuns.filter((row) => row.packageId === "google-ads").length, 1);
  assert.equal(northRuns.find((row) => row.packageId === "google-ads")?.enrollmentId, google.enrollmentId);
  for (const part of ["ai-visibility", "meta-ads", "lead-generation"] as const) {
    assert.equal(northRuns.filter((row) => row.packageId === part && row.enrollmentId === bundle.enrollmentId).length, 1);
  }
  const view = pipelineView(current, tenantA, bundle.enrollmentId);
  assert.equal(view?.bundle?.members.find((row) => row.packageId === "google-ads")?.deduped, true);
  assert.equal(view?.bundle?.members.length, 4);
  const overview = clientPackageOverview(current, tenantA, google.clientId);
  assert.equal(overview?.length, 10);
  assert.equal(overview?.find((row) => row.packageId === "reviews-gbp")?.purchased, false);
  assert.equal(overview?.find((row) => row.packageId === "reviews-gbp")?.status, "not_purchased");
  assert.equal(overview?.find((row) => row.packageId === "meta-ads")?.viaBundle, true);
  assert.equal(overview?.find((row) => row.packageId === "google-ads")?.viaBundle, false);
  assert.equal(overview?.find((row) => row.packageId === "google-meta-ai")?.purchased, true);
  assert.equal(clientPackageOverview(current, tenantB, google.clientId), null);
  const runsOnBundle = packageRunViews(current, tenantA, bundle.enrollmentId) || [];
  assert.equal(runsOnBundle.find((row) => row.packageId === "google-ads")?.deduped, true);
  assert.match(runsOnBundle.find((row) => row.packageId === "google-ads")?.packageName || "", /Google/);

  const northBefore = (current.packageRunSteps || []).find((row) => row.enrollmentId === google.enrollmentId && row.stepId === "campaign-plan");
  const southBefore = (current.packageRunSteps || []).find((row) => row.enrollmentId === south.enrollmentId && row.stepId === "campaign-plan");
  const stopped = setKillSwitch(current, tenantA, bundle.enrollmentId, true, NOW);
  const member = stopped.enrollments.find((row) => row.id === google.enrollmentId);
  assert.equal(member?.killSwitch, true);
  assert.equal(member?.cascadeFromEnrollmentId, bundle.enrollmentId);
  assert.equal(stopped.enrollments.find((row) => row.id === south.enrollmentId)?.killSwitch, false);
  assert.equal(stopped.enrollments.find((row) => row.id === neighbor.enrollmentId)?.killSwitch, false);
  const held = tickPackagePipelines(stopped, tenantA, NOW, { enabled: true });
  const northGoogle = (held.state.packageRunSteps || []).find((row) => row.enrollmentId === google.enrollmentId && row.stepId === "campaign-plan");
  const southGoogle = (held.state.packageRunSteps || []).find((row) => row.enrollmentId === south.enrollmentId && row.stepId === "campaign-plan");
  assert.equal(northGoogle?.status, northBefore?.status);
  assert.notEqual(southGoogle?.status, southBefore?.status);
  const health = fulfillmentHealthSummary(held.state, tenantA);
  assert.equal(health.length, 10);
  assert.equal(health.find((row) => row.packageId === "google-ads")?.killed, 1);
  assert.equal(health.find((row) => row.packageId === "google-meta-ai")?.killed, 1);
  assert.equal(health.find((row) => row.packageId === "meta-ads")?.killed, 1);
  assert.equal(fulfillmentHealthSummary(held.state, tenantB).find((row) => row.packageId === "google-ads")?.killed, 0);
  assert.equal(sentinelPackageHealth(held.state, tenantA, true, NOW).summary.find((row) => row.packageId === "google-meta-ai")?.killed, 1);
  assert.equal(bundleRollup(held.state, tenantA, bundle.enrollmentId)?.status, "killed");
  const stillHeld = setKillSwitch(held.state, tenantA, google.enrollmentId, false, NOW);
  assert.equal(stillHeld, held.state);
  const cleared = setKillSwitch(held.state, tenantA, bundle.enrollmentId, false, NOW);
  assert.equal(cleared.enrollments.find((row) => row.id === google.enrollmentId)?.killSwitch, false);
  assert.equal(cleared.enrollments.find((row) => row.id === google.enrollmentId)?.cascadeFromEnrollmentId, null);
  const own = setKillSwitch(cleared, tenantA, google.enrollmentId, true, NOW);
  const bundled = setKillSwitch(own, tenantA, bundle.enrollmentId, true, NOW);
  const released = setKillSwitch(bundled, tenantA, bundle.enrollmentId, false, NOW);
  assert.equal(released.enrollments.find((row) => row.id === google.enrollmentId)?.killSwitch, true);
});

test("the plan cap blocks this workspace and records a zero-dollar notice", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const boughtA = buy(state, tenantA, "North Roofing", "meta-ads", factory);
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = buy(boughtA.state, tenantB, "South Plumbing", "office-automation", factory);
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const noted = saveOfficeWorkflow(boughtB.state, tenantB, { enrollmentId: boughtB.enrollmentId, kind: "document-collection" }, NOW, { enabled: true });
  if (!noted.ok) throw new Error(noted.reason);
  const limit = getTestPlan("test_trial").pipelineRunLimit || 0;
  const capped = {
    ...noted.state,
    usage: noted.state.usage.map((row) => row.tenantId === tenantA ? { ...row, pipelineRuns: limit } : row),
  };
  const stopped = tickMetaAds(capped, tenantA, NOW, { enabled: true });
  assert.equal(stopped.advanced, 0);
  assert.equal(usageFor(stopped.state, tenantA).pipelineRuns, limit);
  assert.equal(metaStep(stopped.state, "creative-plan", tenantA)?.status, "pending");
  const notice = stopped.state.billingEvents.find((row) => row.tenantId === tenantA && row.type === "pipeline_limit");
  assert.ok(notice);
  assert.equal(notice?.amountCents, 0);
  assert.equal(notice?.billingMode, "test");
  const neighbor = tickOfficeAutomation(stopped.state, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(usageFor(neighbor.state, tenantA).pipelineRuns, limit);
  assert.equal(neighbor.state.billingEvents.some((row) => row.amountCents !== 0), false);
  const off = tickPackagePipelines(neighbor.state, tenantA, NOW);
  assert.equal(off.advanced, 0);
  assert.equal(off.state, neighbor.state);
  assert.equal(FLAGS.PACKAGE_FULFILLMENT, false);
  const quiet = tickMetaAds(neighbor.state, tenantA, NOW);
  assert.equal(quiet.advanced, 0);
  assert.equal(quiet.state, neighbor.state);
});
