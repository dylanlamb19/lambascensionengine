import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tickAiVisibility, setAiVisibilityKillSwitch } from "./ai-visibility.ts";
import { CADENCE_BACKOFF_MS, CADENCE_MAX_ATTEMPTS, cadenceRetryDelayMs } from "./cadence.ts";
import { FLAGS } from "../flags.ts";
import { sentinelPackageHealth } from "./health.ts";
import {
  captureGeneratedLead,
  saveClientIntake,
  setLeadGenerationKillSwitch,
  tickLeadGeneration,
} from "./lead-generation.ts";
import { getTestPlan } from "./plans.ts";
import { tickPackagePipelines } from "./pipelines.ts";
import { addDays, addMonthsIso, recordPurchase, setKillSwitch } from "./runner.ts";
import { replaceTenant, sliceTenant, startMarketerOnboarding } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type FulfillmentState, type PackageRunStep } from "./types.ts";
import { usageFor } from "./usage.ts";
import { formatFulfillmentStepReport, leadFollowUpView, packageRunViews } from "./view.ts";

const NOW = "2026-11-15T15:00:00.000Z";
const root = dirname(fileURLToPath(import.meta.url));

function ids() {
  let n = 0;
  return () => `pkg-run-${++n}`;
}

function openTwo(): { state: FulfillmentState; tenantA: string; tenantB: string } {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A Agency", now: NOW });
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "B Agency", now: NOW });
  if (!second.ok) throw new Error("b");
  return { state: second.state, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

function buy(state: FulfillmentState, tenantId: string, clientName: string, packageId: "lead-generation" | "ai-visibility" | "lead-follow-up", factory = ids()) {
  return recordPurchase(state, tenantId, {
    clientName,
    packageId,
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, factory);
}

function step(state: FulfillmentState, stepId: string, tenantId?: string): PackageRunStep | undefined {
  return state.packageRunSteps.find((row) => row.stepId === stepId && (!tenantId || row.tenantId === tenantId));
}

function settle(state: FulfillmentState, tenantId: string, now: string, which: "lead" | "ai", times = 12): FulfillmentState {
  let current = state;
  const tick = which === "lead" ? tickLeadGeneration : tickAiVisibility;
  for (let i = 0; i < times; i += 1) current = tick(current, tenantId, now, { enabled: true }).state;
  return current;
}

test("lead generation and ai visibility ticks are no-ops while the flag is off", () => {
  assert.equal(FLAGS.PACKAGE_FULFILLMENT, false);
  const { state, tenantA } = openTwo();
  const bought = buy(state, tenantA, "North Roofing", "lead-generation");
  if (!bought.ok) throw new Error(bought.reason);
  const saved = saveClientIntake(bought.state, tenantA, { clientId: bought.clientId, businessName: "North Roofing" }, NOW);
  assert.equal(saved.ok, false);
  assert.equal(saved.state, bought.state);
  const ticked = tickLeadGeneration(bought.state, tenantA, NOW);
  assert.equal(ticked.advanced, 0);
  assert.equal(ticked.state, bought.state);
  const visibility = tickAiVisibility(bought.state, tenantA, NOW);
  assert.equal(visibility.state, bought.state);
  const both = tickPackagePipelines(bought.state, tenantA, NOW);
  assert.equal(both.advanced, 0);
  assert.equal(both.state, bought.state);
  const killed = setLeadGenerationKillSwitch(bought.state, tenantA, true, NOW);
  assert.equal(killed, bought.state);
  const captured = captureGeneratedLead(bought.state, tenantA, { enrollmentId: bought.enrollmentId, contactName: "Sam Ellis" }, NOW);
  assert.equal(captured.ok, false);
  if (!captured.ok) assert.match(captured.reason, /off/);
});

test("workspace A cannot see or advance workspace B package runs", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const boughtA = buy(state, tenantA, "North Roofing", "lead-generation", factory);
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = buy(boughtA.state, tenantB, "South Plumbing", "lead-generation", factory);
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const openedA = tickLeadGeneration(boughtB.state, tenantA, NOW, { enabled: true });
  const beforeB = JSON.stringify(openedA.state.packageRunSteps.filter((row) => row.tenantId === tenantB));
  const openedB = tickLeadGeneration(openedA.state, tenantB, NOW, { enabled: true });
  assert.ok(openedB.advanced > 0);
  assert.equal(JSON.stringify(openedB.state.packageRunSteps.filter((row) => row.tenantId === tenantA)), JSON.stringify(openedA.state.packageRunSteps.filter((row) => row.tenantId === tenantA)));
  assert.notEqual(JSON.stringify(openedB.state.packageRunSteps.filter((row) => row.tenantId === tenantB)), beforeB);
  assert.equal(packageRunViews(openedB.state, tenantB, boughtA.enrollmentId), null);
  assert.equal(packageRunViews(openedB.state, tenantA, boughtB.enrollmentId), null);
  assert.equal(packageRunViews(openedB.state, tenantA, boughtA.enrollmentId)?.[0]?.packageId, "lead-generation");
  const foreign = captureGeneratedLead(openedB.state, tenantB, {
    enrollmentId: boughtA.enrollmentId,
    contactName: "Smuggled",
  }, NOW, { enabled: true });
  assert.equal(foreign.ok, false);
  const reportA = formatFulfillmentStepReport(openedB.state, tenantA);
  assert.match(reportA, /Campaign brief/);
  assert.doesNotMatch(reportA, /South Plumbing/);
  const sliced = sliceTenant(openedB.state, tenantA);
  const poisoned = {
    ...sliced,
    packageRuns: [...sliced.packageRuns, { ...sliced.packageRuns[0], id: "smuggled", tenantId: tenantB }],
    generatedLeads: [{ id: "hidden", tenantId: tenantB, clientId: "x", enrollmentId: "y", contactName: "Hidden", contactEmail: "", contactPhone: "", source: "x", capturedAt: NOW, followUpLeadId: null, handoffNote: "" }],
  };
  const replaced = replaceTenant(EMPTY_FULFILLMENT, tenantA, poisoned);
  assert.equal(replaced.packageRuns.some((row) => row.tenantId === tenantB), false);
  assert.equal(replaced.packageRuns.length, 1);
  assert.equal(replaced.generatedLeads.length, 0);
  assert.equal(replaced.packageRunSteps.every((row) => row.tenantId === tenantA), true);
});

test("a workspace kill switch stops that package only", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const boughtA = buy(state, tenantA, "North Roofing", "lead-generation", factory);
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtAi = buy(boughtA.state, tenantA, "North Roofing", "ai-visibility", factory);
  if (!boughtAi.ok) throw new Error(boughtAi.reason);
  const boughtB = buy(boughtAi.state, tenantB, "South Plumbing", "lead-generation", factory);
  if (!boughtB.ok) throw new Error(boughtB.reason);
  let current = tickLeadGeneration(boughtB.state, tenantA, NOW, { enabled: true }).state;
  current = tickAiVisibility(current, tenantA, NOW, { enabled: true }).state;
  const stopped = setLeadGenerationKillSwitch(current, tenantA, true, NOW, { enabled: true });
  assert.equal(stopped.workspaces.find((row) => row.id === tenantA)?.leadGenerationKillSwitch, true);
  assert.equal(stopped.workspaces.find((row) => row.id === tenantA)?.aiVisibilityKillSwitch, false);
  assert.equal(stopped.workspaces.find((row) => row.id === tenantB)?.leadGenerationKillSwitch, false);
  assert.match(stopped.packageRunSteps.find((row) => row.tenantId === tenantA && row.packageId === "lead-generation")?.logs.at(-1)?.message || "", /Lead generation is stopped/);
  const held = tickLeadGeneration(stopped, tenantA, addDays(NOW, 10), { enabled: true });
  assert.equal(held.advanced, 0);
  assert.equal(held.state, stopped);
  const visibility = tickAiVisibility(stopped, tenantA, NOW, { enabled: true });
  assert.ok(visibility.advanced > 0);
  const neighbor = tickLeadGeneration(stopped, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(neighbor.state.packageRunSteps.find((row) => row.tenantId === tenantA && row.stepId === "campaign-brief")?.status, stopped.packageRunSteps.find((row) => row.tenantId === tenantA && row.stepId === "campaign-brief")?.status);
  const health = sentinelPackageHealth(stopped, tenantA, true, NOW);
  assert.equal(health.pipelines.find((row) => row.packageId === "lead-generation")?.health, "stopped");
});

test("a client kill switch stops that client's run and leaves the other client moving", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const north = buy(state, tenantA, "North Roofing", "lead-generation", factory);
  if (!north.ok) throw new Error(north.reason);
  const south = buy(north.state, tenantA, "South Plumbing", "lead-generation", factory);
  if (!south.ok) throw new Error(south.reason);
  const opened = tickLeadGeneration(south.state, tenantA, NOW, { enabled: true });
  assert.equal(step(opened.state, "campaign-brief", tenantA)?.status, "running");
  const killed = setKillSwitch(opened.state, tenantA, north.enrollmentId, true, NOW);
  const next = tickLeadGeneration(killed, tenantA, NOW, { enabled: true });
  const northBrief = next.state.packageRunSteps.find((row) => row.enrollmentId === north.enrollmentId && row.stepId === "campaign-brief");
  const southBrief = next.state.packageRunSteps.find((row) => row.enrollmentId === south.enrollmentId && row.stepId === "campaign-brief");
  assert.equal(northBrief?.status, "running");
  assert.equal(southBrief?.status, "done");
  assert.match(northBrief?.logs.map((row) => row.message).join("\n") || "", /This client's pipeline is stopped/);
});

test("retry exhaustion on both packages needs a person", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const lead = buy(state, tenantA, "North Roofing", "lead-generation", factory);
  if (!lead.ok) throw new Error(lead.reason);
  const visibility = buy(lead.state, tenantA, "North Roofing", "ai-visibility", factory);
  if (!visibility.ok) throw new Error(visibility.reason);
  const runStep = () => {
    throw new Error("draft timeout");
  };
  let current = visibility.state;
  let now = NOW;
  current = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep }).state;
  assert.equal(step(current, "campaign-brief")?.status, "running");
  current = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep }).state;
  const afterFirst = step(current, "campaign-brief");
  assert.equal(afterFirst?.status, "pending");
  assert.equal(afterFirst?.attempts, 1);
  assert.equal(afterFirst?.nextRunAt, new Date(new Date(now).getTime() + cadenceRetryDelayMs(1)).toISOString());
  assert.equal(cadenceRetryDelayMs(1), CADENCE_BACKOFF_MS);
  const early = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep });
  assert.equal(early.advanced, 0);
  assert.equal(early.state, current);
  now = afterFirst?.nextRunAt || now;
  current = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep }).state;
  current = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep }).state;
  assert.equal(step(current, "campaign-brief")?.attempts, 2);
  assert.equal(cadenceRetryDelayMs(2), CADENCE_BACKOFF_MS * 2);
  now = step(current, "campaign-brief")?.nextRunAt || now;
  current = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep }).state;
  current = tickLeadGeneration(current, tenantA, now, { enabled: true, runStep }).state;
  const failed = step(current, "campaign-brief");
  assert.equal(failed?.status, "needs_human");
  assert.equal(failed?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.match(failed?.output || "", /Needs a person/);
  assert.match(failed?.output || "", /Nothing was sent/);
  assert.equal(step(current, "weekly-report")?.status, "needs_human");
  assert.match(step(current, "weekly-report")?.output || "", /earlier step failed/);
  assert.equal(current.packageRuns.find((row) => row.packageId === "lead-generation")?.status, "needs_human");

  let visNow = NOW;
  current = tickAiVisibility(current, tenantA, visNow, { enabled: true, runStep }).state;
  current = tickAiVisibility(current, tenantA, visNow, { enabled: true, runStep }).state;
  visNow = step(current, "profile-audit")?.nextRunAt || visNow;
  current = tickAiVisibility(current, tenantA, visNow, { enabled: true, runStep }).state;
  current = tickAiVisibility(current, tenantA, visNow, { enabled: true, runStep }).state;
  visNow = step(current, "profile-audit")?.nextRunAt || visNow;
  current = tickAiVisibility(current, tenantA, visNow, { enabled: true, runStep }).state;
  current = tickAiVisibility(current, tenantA, visNow, { enabled: true, runStep }).state;
  const audit = step(current, "profile-audit");
  assert.equal(audit?.status, "needs_human");
  assert.equal(audit?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.equal(step(current, "monthly-report")?.status, "needs_human");
  assert.match(audit?.output || "", /Nothing was published/);
});

test("plan cap blocks this workspace and records a zero-dollar notice", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const boughtA = buy(state, tenantA, "North Roofing", "ai-visibility", factory);
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = buy(boughtA.state, tenantB, "South Plumbing", "ai-visibility", factory);
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const limit = getTestPlan("test_trial").pipelineRunLimit || 0;
  const capped = {
    ...boughtB.state,
    usage: boughtB.state.usage.map((row) => row.tenantId === tenantA ? { ...row, pipelineRuns: limit } : row),
  };
  const stopped = tickAiVisibility(capped, tenantA, NOW, { enabled: true });
  assert.equal(stopped.advanced, 0);
  assert.equal(usageFor(stopped.state, tenantA).pipelineRuns, limit);
  assert.equal(step(stopped.state, "profile-audit", tenantA)?.status, "pending");
  const notice = stopped.state.billingEvents.find((row) => row.tenantId === tenantA && row.type === "pipeline_limit");
  assert.ok(notice);
  assert.equal(notice?.amountCents, 0);
  assert.equal(notice?.billingMode, "test");
  const neighbor = tickAiVisibility(stopped.state, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(usageFor(neighbor.state, tenantA).pipelineRuns, limit);
  assert.equal(neighbor.state.billingEvents.some((row) => row.tenantId === tenantB && row.amountCents !== 0), false);
});

test("a captured lead is handed to Lead Follow-Up only for that client", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const followA = buy(state, tenantA, "North Roofing", "lead-follow-up", factory);
  if (!followA.ok) throw new Error(followA.reason);
  const genA = buy(followA.state, tenantA, "North Roofing", "lead-generation", factory);
  if (!genA.ok) throw new Error(genA.reason);
  const followB = buy(genA.state, tenantB, "North Roofing", "lead-follow-up", factory);
  if (!followB.ok) throw new Error(followB.reason);
  const alone = buy(followB.state, tenantA, "Lakeside HVAC", "lead-generation", factory);
  if (!alone.ok) throw new Error(alone.reason);
  const handed = captureGeneratedLead(alone.state, tenantA, {
    enrollmentId: genA.enrollmentId,
    contactName: "Sam Ellis",
    contactEmail: "sam@north.example",
  }, NOW, { enabled: true, ids: factory });
  if (!handed.ok) throw new Error(handed.reason);
  assert.equal(handed.created, true);
  assert.ok(handed.followUpLeadId);
  const followLead = handed.state.leads.find((row) => row.id === handed.followUpLeadId);
  assert.equal(followLead?.tenantId, tenantA);
  assert.equal(followLead?.enrollmentId, followA.enrollmentId);
  assert.equal(followLead?.clientId, genA.clientId);
  assert.equal(handed.state.leads.some((row) => row.tenantId === tenantB), false);
  assert.equal(leadFollowUpView(handed.state, tenantB, followB.enrollmentId)?.length, 0);
  assert.match(handed.state.generatedLeads[0]?.handoffNote || "", /Handed to Lead Follow-Up/);
  const kept = captureGeneratedLead(handed.state, tenantA, {
    enrollmentId: alone.enrollmentId,
    contactName: "Pat Quinn",
    contactEmail: "pat@lakeside.example",
  }, NOW, { enabled: true, ids: factory });
  if (!kept.ok) throw new Error(kept.reason);
  assert.equal(kept.followUpLeadId, null);
  assert.match(kept.state.generatedLeads.find((row) => row.id === kept.leadId)?.handoffNote || "", /does not have an active Lead Follow-Up/);
  assert.equal(kept.state.leads.length, handed.state.leads.length);
});

test("lead generation dry-run finishes the brief, drafts, and weekly report without spend", () => {
  const { state, tenantA } = openTwo();
  const bought = buy(state, tenantA, "North Roofing", "lead-generation");
  if (!bought.ok) throw new Error(bought.reason);
  const follow = buy(bought.state, tenantA, "North Roofing", "lead-follow-up", ids());
  if (!follow.ok) throw new Error(follow.reason);
  const intake = saveClientIntake(follow.state, tenantA, {
    clientId: bought.clientId,
    businessName: "North Roofing",
    phone: "555-0142",
    address: "12 Harbor Ave",
    website: "https://north.example",
    offer: "Roof inspections",
    serviceArea: "Harbor County",
  }, NOW, { enabled: true });
  if (!intake.ok) throw new Error(intake.reason);
  let current = settle(intake.state, tenantA, NOW, "lead");
  const brief = step(current, "campaign-brief");
  const page = step(current, "landing-page");
  const ads = step(current, "ad-copy");
  const launch = step(current, "launch");
  assert.equal(brief?.status, "done");
  assert.match(brief?.draft || "", /Roof inspections/);
  assert.match(brief?.draft || "", /stored intake/);
  assert.equal(page?.status, "done");
  assert.match(page?.output || "", /not published/);
  assert.equal(ads?.status, "done");
  assert.match(ads?.draft || "", /Google/);
  assert.match(ads?.draft || "", /Meta/);
  assert.equal(launch?.status, "needs_human");
  assert.match(launch?.output || "", /No live ad account was used/);
  assert.match(launch?.output || "", /No spend was set/);
  assert.equal(step(current, "weekly-report")?.status, "pending");
  const captured = captureGeneratedLead(current, tenantA, {
    enrollmentId: bought.enrollmentId,
    contactName: "Sam Ellis",
    contactEmail: "sam@north.example",
  }, NOW, { enabled: true, ids: ids() });
  if (!captured.ok) throw new Error(captured.reason);
  assert.ok(captured.followUpLeadId);
  const week = addDays(NOW, 7);
  current = settle(captured.state, tenantA, week, "lead", 4);
  const report = step(current, "weekly-report");
  assert.equal(report?.status, "done");
  assert.match(report?.draft || "", /Sam Ellis/);
  assert.match(report?.draft || "", /Lead Follow-Up/);
  assert.match(report?.draft || "", /Spend is UNKNOWN/);
  assert.match(report?.draft || "", /Nothing was emailed/);
  const view = packageRunViews(current, tenantA, bought.enrollmentId);
  assert.equal(view?.[0]?.steps.find((row) => row.title === "Launch")?.statusLabel, "needs human");
  const health = sentinelPackageHealth(current, tenantA, true, week);
  assert.equal(health.pipelines.find((row) => row.packageId === "lead-generation")?.health, "degraded");
});

test("ai visibility dry-run audits stored data and leaves the recommendation for a person", () => {
  const { state, tenantA } = openTwo();
  const bought = buy(state, tenantA, "Lakeside HVAC", "ai-visibility");
  if (!bought.ok) throw new Error(bought.reason);
  const intake = saveClientIntake(bought.state, tenantA, {
    clientId: bought.clientId,
    businessName: "Lakeside Heating",
    phone: "555-0190",
    address: "4 Lake St",
    offer: "Furnace repair",
    serviceArea: "Lakeside",
  }, NOW, { enabled: true });
  if (!intake.ok) throw new Error(intake.reason);
  let current = settle(intake.state, tenantA, NOW, "ai");
  const audit = step(current, "profile-audit");
  const schema = step(current, "schema-faq");
  const check = step(current, "ai-recommendation");
  assert.equal(audit?.status, "done");
  assert.match(audit?.draft || "", /does not match the client name/);
  assert.match(audit?.draft || "", /Missing on file: site/);
  assert.match(audit?.draft || "", /No third-party page was read/);
  assert.equal(schema?.status, "done");
  assert.match(schema?.draft || "", /LocalBusiness/);
  assert.match(schema?.draft || "", /FAQ draft/);
  assert.match(schema?.draft || "", /Nothing was published/);
  assert.equal(check?.status, "needs_human");
  assert.match(check?.output || "", /Dry run/);
  assert.match(check?.output || "", /No live model or search API was called/);
  assert.equal(step(current, "monthly-report")?.status, "pending");
  assert.equal(step(current, "monthly-report")?.nextRunAt, addMonthsIso(NOW, 1));
  const month = addMonthsIso(NOW, 1);
  current = settle(current, tenantA, month, "ai", 4);
  const report = step(current, "monthly-report");
  assert.equal(report?.status, "done");
  assert.match(report?.draft || "", /Monthly visibility report/);
  assert.match(report?.draft || "", /needs a person/);
  assert.match(report?.draft || "", /Nothing was published/);
  const killed = setAiVisibilityKillSwitch(current, tenantA, true, month, { enabled: true });
  const later = tickAiVisibility(killed, tenantA, addMonthsIso(month, 1), { enabled: true });
  assert.equal(later.advanced, 0);
  assert.equal(later.state, killed);
  assert.equal(sentinelPackageHealth(killed, tenantA, true, month).pipelines[0]?.health, "stopped");

  const src = ["cadence.ts", "package-runs.ts", "lead-generation.ts", "ai-visibility.ts", "pipelines.ts"].map((name) => readFileSync(join(root, name), "utf8")).join("\n");
  assert.doesNotMatch(src, /from ["'][^"']*mail\//);
  assert.doesNotMatch(src, /canSend|twilio|mail\/send|fetch\(|sk_live|STRIPE_SECRET|openai|generativelanguage/i);
  assert.match(src, /Dry run/);
  assert.match(src, /No spend was set/);
  assert.match(src, /No live model or search API was called/);
});
