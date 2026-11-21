import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CADENCE_BACKOFF_MS, CADENCE_MAX_ATTEMPTS } from "./cadence.ts";
import { stubConnect } from "./connections.ts";
import {
  decideEstimate,
  recordOpenEstimate,
  setEstimateFollowUpsKillSwitch,
  tickEstimates,
} from "./estimate-follow-ups.ts";
import { FLAGS } from "../flags.ts";
import {
  approveAdsChange,
  recordAdsMetrics,
  saveAdsChangeNote,
  setGoogleAdsKillSwitch,
  tickGoogleAds,
} from "./google-ads.ts";
import { sentinelPackageHealth } from "./health.ts";
import { saveClientIntake } from "./lead-generation.ts";
import { getTestPlan } from "./plans.ts";
import { tickPackagePipelines } from "./pipelines.ts";
import { recordPurchase, setEnrollmentStatus, setKillSwitch } from "./runner.ts";
import { replaceTenant, sliceTenant, startMarketerOnboarding } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type EstimateStep, type FulfillmentState, type PackageRunStep } from "./types.ts";
import { usageFor } from "./usage.ts";
import { estimateViews, formatFulfillmentStepReport, packageRunViews } from "./view.ts";

const NOW = "2026-11-15T15:00:00.000Z";
const OPENED = "2026-11-13T15:00:00.000Z";
const QUIET_OPENED = "2026-11-13T13:00:00.000Z";
const root = dirname(fileURLToPath(import.meta.url));

function ids() {
  let n = 0;
  return () => `pair-${++n}`;
}

function openTwo(): { state: FulfillmentState; tenantA: string; tenantB: string } {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "Harbor Marketing", now: NOW });
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "Prairie Studio", now: NOW });
  if (!second.ok) throw new Error("b");
  return { state: second.state, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

function buy(state: FulfillmentState, tenantId: string, clientName: string, packageId: "lead-follow-up" | "estimate-follow-ups" | "google-ads", factory = ids()) {
  return recordPurchase(state, tenantId, {
    clientName,
    packageId,
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, factory);
}

function withParent(state: FulfillmentState, tenantId: string, clientName: string, factory = ids()) {
  const parent = buy(state, tenantId, clientName, "lead-follow-up", factory);
  if (!parent.ok) throw new Error(parent.reason);
  const addon = buy(parent.state, tenantId, clientName, "estimate-follow-ups", factory);
  if (!addon.ok) throw new Error(addon.reason);
  return { state: addon.state, enrollmentId: addon.enrollmentId, clientId: addon.clientId };
}

function connect(state: FulfillmentState, tenantId: string, kind: "estimate_feed" | "google_ads") {
  const connected = stubConnect(state, tenantId, kind, NOW);
  if (!connected.ok) throw new Error(connected.reason);
  return connected.state;
}

function estimateStep(state: FulfillmentState, stepId: EstimateStep["stepId"], tenantId?: string) {
  return state.estimateSteps.find((row) => row.stepId === stepId && (!tenantId || row.tenantId === tenantId));
}

function adsStep(state: FulfillmentState, stepId: string, tenantId?: string): PackageRunStep | undefined {
  return state.packageRunSteps.find((row) => row.packageId === "google-ads" && row.stepId === stepId && (!tenantId || row.tenantId === tenantId));
}

function openEstimate(
  state: FulfillmentState,
  tenantId: string,
  enrollmentId: string,
  customerName = "Pat Nguyen",
  openedAt = OPENED,
  factory = ids(),
) {
  return recordOpenEstimate(state, tenantId, {
    enrollmentId,
    customerName,
    customerEmail: "pat@north.example",
    label: "Full roof replacement",
    openedAt,
  }, NOW, { enabled: true, ids: factory });
}

test("estimate and google ads ticks are no-ops while the flag is off", () => {
  assert.equal(FLAGS.PACKAGE_FULFILLMENT, false);
  const { state, tenantA } = openTwo();
  const ready = withParent(state, tenantA, "North Roofing");
  const ads = buy(ready.state, tenantA, "Lakeside HVAC", "google-ads");
  if (!ads.ok) throw new Error(ads.reason);
  const recorded = recordOpenEstimate(ads.state, tenantA, {
    enrollmentId: ready.enrollmentId,
    customerName: "Pat Nguyen",
    label: "Full roof replacement",
    openedAt: OPENED,
  }, NOW);
  assert.equal(recorded.ok, false);
  assert.equal(recorded.state, ads.state);
  assert.equal(tickEstimates(ads.state, tenantA, NOW).state, ads.state);
  assert.equal(tickGoogleAds(ads.state, tenantA, NOW).state, ads.state);
  const pipelines = tickPackagePipelines(ads.state, tenantA, NOW);
  assert.equal(pipelines.advanced, 0);
  assert.equal(pipelines.state, ads.state);
});

test("one workspace cannot read or advance the other's estimates or ad drafts", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const estimatesA = withParent(state, tenantA, "North Roofing", factory);
  const estimatesB = withParent(estimatesA.state, tenantB, "North Roofing", factory);
  const adsA = buy(connect(estimatesB.state, tenantB, "google_ads"), tenantA, "Lakeside HVAC", "google-ads", factory);
  if (!adsA.ok) throw new Error(adsA.reason);
  const adsB = buy(adsA.state, tenantB, "Main Street Dental", "google-ads", factory);
  if (!adsB.ok) throw new Error(adsB.reason);
  const openedA = openEstimate(connect(adsB.state, tenantA, "estimate_feed"), tenantA, estimatesA.enrollmentId);
  if (!openedA.ok) throw new Error(openedA.reason);
  const beforeB = JSON.stringify(openedA.state.estimates.filter((row) => row.tenantId === tenantB));
  const openedB = openEstimate(openedA.state, tenantB, estimatesB.enrollmentId, "Casey Brook");
  if (!openedB.ok) throw new Error(openedB.reason);
  assert.equal(JSON.stringify(openedB.state.estimates.filter((row) => row.tenantId === tenantA)), JSON.stringify(openedA.state.estimates.filter((row) => row.tenantId === tenantA)));
  assert.notEqual(JSON.stringify(openedB.state.estimates.filter((row) => row.tenantId === tenantB)), beforeB);
  const foreign = recordOpenEstimate(openedB.state, tenantA, {
    enrollmentId: estimatesB.enrollmentId,
    customerName: "Smuggled",
    label: "Hidden",
    openedAt: OPENED,
  }, NOW, { enabled: true });
  assert.equal(foreign.ok, false);
  let current = openedB.state;
  for (let i = 0; i < 4; i += 1) current = tickEstimates(current, tenantA, NOW, { enabled: true }).state;
  assert.equal(estimateStep(current, "day-2", tenantA)?.status, "done");
  assert.equal(estimateStep(current, "day-2", tenantB)?.status, "pending");
  assert.equal(estimateViews(current, tenantB, estimatesA.enrollmentId), null);
  assert.equal(estimateViews(current, tenantA, estimatesA.enrollmentId)?.[0]?.customerName, "Pat Nguyen");
  const intakeA = saveClientIntake(current, tenantA, { clientId: adsA.clientId, offer: "Furnace repair", serviceArea: "Lakeside" }, NOW, { enabled: true });
  if (!intakeA.ok) throw new Error(intakeA.reason);
  const intakeB = saveClientIntake(connect(intakeA.state, tenantB, "google_ads"), tenantB, { clientId: adsB.clientId, offer: "Cleanings", serviceArea: "Prairie" }, NOW, { enabled: true });
  if (!intakeB.ok) throw new Error(intakeB.reason);
  const metricB = recordAdsMetrics(intakeB.state, tenantB, {
    enrollmentId: adsB.enrollmentId,
    periodLabel: "Prairie week",
    impressions: 40,
    clicks: 3,
  }, NOW, { enabled: true, ids: factory });
  if (!metricB.ok) throw new Error(metricB.reason);
  const metricA = recordAdsMetrics(metricB.state, tenantA, {
    enrollmentId: adsA.enrollmentId,
    periodLabel: "Harbor week",
    impressions: 120,
    clicks: 9,
  }, NOW, { enabled: true, ids: factory });
  if (!metricA.ok) throw new Error(metricA.reason);
  let blocked = metricA.state;
  blocked = tickGoogleAds(blocked, tenantA, NOW, { enabled: true }).state;
  blocked = tickGoogleAds(blocked, tenantA, NOW, { enabled: true }).state;
  assert.match(adsStep(blocked, "campaign-plan", tenantA)?.lastError || "", /Missing connection: Google Ads/);
  assert.equal(adsStep(blocked, "campaign-plan", tenantB), undefined);
  let ads = connect(metricA.state, tenantA, "google_ads");
  for (let i = 0; i < 6; i += 1) ads = tickGoogleAds(ads, tenantA, NOW, { enabled: true }).state;
  const week = "2026-11-22T15:00:00.000Z";
  for (let i = 0; i < 4; i += 1) ads = tickGoogleAds(ads, tenantA, week, { enabled: true }).state;
  assert.match(adsStep(ads, "weekly-report", tenantA)?.draft || "", /Harbor week/);
  assert.match(adsStep(ads, "weekly-report", tenantA)?.draft || "", /120/);
  assert.doesNotMatch(adsStep(ads, "weekly-report", tenantA)?.draft || "", /Prairie week/);
  assert.equal(adsStep(ads, "campaign-plan", tenantB), undefined);
  assert.equal(packageRunViews(ads, tenantB, adsA.enrollmentId), null);
  const sliced = sliceTenant(ads, tenantA);
  const poisoned = {
    ...sliced,
    estimates: [...sliced.estimates, { ...sliced.estimates[0], id: "smuggled-est", tenantId: tenantB }],
    adsMetrics: [...sliced.adsMetrics, { ...sliced.adsMetrics[0], id: "smuggled-metric", tenantId: tenantB }],
  };
  const replaced = replaceTenant(EMPTY_FULFILLMENT, tenantA, poisoned);
  assert.equal(replaced.estimates.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.adsMetrics.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.estimates.some((row) => row.id === "smuggled-est"), false);
  const report = formatFulfillmentStepReport(ads, tenantA);
  assert.match(report, /Pat Nguyen/);
  assert.match(report, /Campaign plan/);
  assert.doesNotMatch(report, /Casey Brook/);
  assert.doesNotMatch(report, /Prairie week/);
});

test("workspace and client kill switches stop only that pipeline", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const north = withParent(connect(state, tenantA, "estimate_feed"), tenantA, "North Roofing", factory);
  const south = withParent(north.state, tenantA, "Lakeside HVAC", factory);
  const neighbor = withParent(connect(south.state, tenantB, "estimate_feed"), tenantB, "Red Barn Roofing", factory);
  const northEstimate = openEstimate(neighbor.state, tenantA, north.enrollmentId, "Pat Nguyen", OPENED, factory);
  if (!northEstimate.ok) throw new Error(northEstimate.reason);
  const southEstimate = openEstimate(northEstimate.state, tenantA, south.enrollmentId, "Avery Cole", OPENED, factory);
  if (!southEstimate.ok) throw new Error(southEstimate.reason);
  const otherEstimate = openEstimate(southEstimate.state, tenantB, neighbor.enrollmentId, "Casey Brook", OPENED, factory);
  if (!otherEstimate.ok) throw new Error(otherEstimate.reason);
  const stopped = setEstimateFollowUpsKillSwitch(otherEstimate.state, tenantA, true, NOW, { enabled: true });
  assert.equal(stopped.workspaces.find((row) => row.id === tenantA)?.estimateFollowUpsKillSwitch, true);
  assert.equal(stopped.workspaces.find((row) => row.id === tenantB)?.estimateFollowUpsKillSwitch, false);
  assert.match(stopped.estimateSteps.find((row) => row.tenantId === tenantA)?.logs.at(-1)?.message || "", /Estimate follow-ups are stopped/);
  const held = tickEstimates(stopped, tenantA, NOW, { enabled: true });
  assert.equal(held.advanced, 0);
  assert.equal(estimateStep(held.state, "day-2", tenantA)?.status, "pending");
  const moving = tickEstimates(held.state, tenantB, NOW, { enabled: true });
  assert.equal(moving.advanced, 1);
  assert.equal(estimateStep(moving.state, "day-2", tenantB)?.status, "running");
  const cleared = setEstimateFollowUpsKillSwitch(moving.state, tenantA, false, NOW, { enabled: true });
  const clientStop = setKillSwitch(cleared, tenantA, north.enrollmentId, true, NOW);
  let current = clientStop;
  for (let i = 0; i < 4; i += 1) current = tickEstimates(current, tenantA, NOW, { enabled: true }).state;
  assert.equal(current.estimateSteps.find((row) => row.enrollmentId === north.enrollmentId && row.stepId === "day-2")?.status, "pending");
  assert.equal(current.estimateSteps.find((row) => row.enrollmentId === south.enrollmentId && row.stepId === "day-2")?.status, "done");
  const ads = buy(connect(current, tenantA, "google_ads"), tenantA, "North Roofing", "google-ads", factory);
  if (!ads.ok) throw new Error(ads.reason);
  const intake = saveClientIntake(ads.state, tenantA, { clientId: ads.clientId, offer: "Roof inspections" }, NOW, { enabled: true });
  if (!intake.ok) throw new Error(intake.reason);
  const adsKill = setGoogleAdsKillSwitch(intake.state, tenantA, true, NOW, { enabled: true });
  const adsHeld = tickGoogleAds(adsKill, tenantA, NOW, { enabled: true });
  assert.equal(adsHeld.advanced, 0);
  assert.equal(sentinelPackageHealth(adsHeld.state, tenantA, true, NOW).pipelines.find((row) => row.packageId === "google-ads")?.health, "stopped");
  assert.equal(sentinelPackageHealth(adsHeld.state, tenantA, true, NOW).pipelines.find((row) => row.enrollmentId === south.enrollmentId)?.health, "healthy");
  assert.notEqual(sentinelPackageHealth(adsHeld.state, tenantB, true, NOW).pipelines.find((row) => row.packageId === "estimate-follow-ups")?.health, "stopped");
});

test("retries escalate to needs human, and the plan cap records a zero-dollar notice", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const ready = withParent(connect(state, tenantA, "estimate_feed"), tenantA, "North Roofing", factory);
  const recorded = openEstimate(ready.state, tenantA, ready.enrollmentId);
  if (!recorded.ok) throw new Error(recorded.reason);
  const runStep = () => {
    throw new Error("The draft step failed.");
  };
  let current = recorded.state;
  let now = NOW;
  current = tickEstimates(current, tenantA, now, { enabled: true, runStep }).state;
  current = tickEstimates(current, tenantA, now, { enabled: true, runStep }).state;
  assert.equal(estimateStep(current, "day-2")?.attempts, 1);
  now = estimateStep(current, "day-2")?.nextRunAt || now;
  current = tickEstimates(current, tenantA, now, { enabled: true, runStep }).state;
  current = tickEstimates(current, tenantA, now, { enabled: true, runStep }).state;
  assert.equal(estimateStep(current, "day-2")?.attempts, 2);
  assert.equal(estimateStep(current, "day-2")?.nextRunAt, new Date(new Date(now).getTime() + CADENCE_BACKOFF_MS * 2).toISOString());
  now = estimateStep(current, "day-2")?.nextRunAt || now;
  current = tickEstimates(current, tenantA, now, { enabled: true, runStep }).state;
  current = tickEstimates(current, tenantA, now, { enabled: true, runStep }).state;
  assert.equal(estimateStep(current, "day-2")?.status, "needs_human");
  assert.equal(estimateStep(current, "day-2")?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.match(estimateStep(current, "day-2")?.output || "", /Needs a person/);
  assert.equal(estimateStep(current, "day-5")?.status, "needs_human");
  assert.match(estimateStep(current, "close-out")?.output || "", /earlier step failed/);

  const ads = buy(connect(current, tenantA, "google_ads"), tenantA, "Lakeside HVAC", "google-ads", factory);
  if (!ads.ok) throw new Error(ads.reason);
  const intake = saveClientIntake(ads.state, tenantA, { clientId: ads.clientId, offer: "Furnace repair" }, NOW, { enabled: true });
  if (!intake.ok) throw new Error(intake.reason);
  let adsState = intake.state;
  adsState = tickGoogleAds(adsState, tenantA, NOW, { enabled: true, runStep }).state;
  adsState = tickGoogleAds(adsState, tenantA, NOW, { enabled: true, runStep }).state;
  let adsNow = adsStep(adsState, "campaign-plan")?.nextRunAt || NOW;
  adsState = tickGoogleAds(adsState, tenantA, adsNow, { enabled: true, runStep }).state;
  adsState = tickGoogleAds(adsState, tenantA, adsNow, { enabled: true, runStep }).state;
  adsNow = adsStep(adsState, "campaign-plan")?.nextRunAt || adsNow;
  adsState = tickGoogleAds(adsState, tenantA, adsNow, { enabled: true, runStep }).state;
  adsState = tickGoogleAds(adsState, tenantA, adsNow, { enabled: true, runStep }).state;
  assert.equal(adsStep(adsState, "campaign-plan")?.status, "needs_human");
  assert.equal(adsStep(adsState, "campaign-plan")?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.equal(adsStep(adsState, "change-proposal")?.status, "needs_human");
  assert.match(adsStep(adsState, "weekly-report")?.output || "", /earlier step failed/);
  assert.match(adsStep(adsState, "campaign-plan")?.output || "", /No Google Ads API was called/);

  const neighbor = withParent(connect(adsState, tenantB, "estimate_feed"), tenantB, "Red Barn Roofing", factory);
  const limit = getTestPlan("test_trial").pipelineRunLimit || 0;
  const capped = {
    ...neighbor.state,
    usage: neighbor.state.usage.map((row) => row.tenantId === tenantA ? { ...row, pipelineRuns: limit } : row),
  };
  const blockedEstimates = tickEstimates(capped, tenantA, NOW, { enabled: true });
  assert.equal(blockedEstimates.advanced, 0);
  const notice = blockedEstimates.state.billingEvents.find((row) => row.tenantId === tenantA && row.type === "pipeline_limit");
  assert.ok(notice);
  assert.equal(notice?.amountCents, 0);
  assert.equal(notice?.billingMode, "test");
  const blockedAds = tickGoogleAds(blockedEstimates.state, tenantA, NOW, { enabled: true });
  assert.equal(blockedAds.advanced, 0);
  assert.equal(blockedAds.state.billingEvents.filter((row) => row.tenantId === tenantA && row.type === "pipeline_limit").length, 1);
  const opened = openEstimate(blockedAds.state, tenantB, neighbor.enrollmentId, "Casey Brook");
  if (!opened.ok) throw new Error(opened.reason);
  const moved = tickEstimates(opened.state, tenantB, NOW, { enabled: true });
  assert.equal(moved.advanced, 1);
  assert.equal(usageFor(moved.state, tenantA).pipelineRuns, limit);
  assert.equal(moved.state.billingEvents.some((row) => row.amountCents !== 0), false);
});

test("quiet hours, stop conditions, and ambiguity hold the estimate cadence", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const ready = withParent(connect(state, tenantA, "estimate_feed"), tenantA, "North Roofing", factory);
  const early = recordOpenEstimate(ready.state, tenantA, {
    enrollmentId: ready.enrollmentId,
    customerName: "Pat Nguyen",
    label: "Full roof replacement",
    openedAt: QUIET_OPENED,
  }, QUIET_OPENED, { enabled: true, ids: factory });
  if (!early.ok) throw new Error(early.reason);
  assert.equal(estimateStep(early.state, "day-2")?.nextRunAt, "2026-11-15T14:00:00.000Z");
  const tooSoon = tickEstimates(early.state, tenantA, "2026-11-15T13:30:00.000Z", { enabled: true });
  assert.equal(tooSoon.advanced, 0);
  assert.equal(estimateStep(tooSoon.state, "day-2")?.status, "pending");
  let current = tickEstimates(tooSoon.state, tenantA, "2026-11-15T14:00:00.000Z", { enabled: true }).state;
  current = tickEstimates(current, tenantA, "2026-11-15T14:00:00.000Z", { enabled: true }).state;
  assert.equal(estimateStep(current, "day-2")?.status, "done");
  assert.match(estimateStep(current, "day-2")?.output || "", /Dry run/);
  assert.match(estimateStep(current, "day-2")?.output || "", /Nothing was sent/);
  assert.match(estimateStep(current, "day-2")?.draftedMessage || "", /Full roof replacement/);
  const won = decideEstimate(current, tenantA, early.estimateId, "won", NOW, { enabled: true });
  if (!won.ok) throw new Error(won.reason);
  assert.equal(won.state.estimates[0]?.outcome, "won");
  assert.equal(won.state.estimates[0]?.status, "stopped");
  assert.equal(estimateStep(won.state, "day-2")?.draftedMessage?.includes("Full roof replacement"), true);
  assert.equal(estimateStep(won.state, "day-5")?.status, "done");
  assert.equal(estimateStep(won.state, "day-5")?.draftedMessage, null);
  assert.match(estimateStep(won.state, "close-out")?.output || "", /won/);
  const after = tickEstimates(won.state, tenantA, "2026-11-20T15:00:00.000Z", { enabled: true });
  assert.equal(after.advanced, 0);

  const lostReady = withParent(won.state, tenantA, "Lakeside HVAC", factory);
  const lostOpen = openEstimate(lostReady.state, tenantA, lostReady.enrollmentId, "Avery Cole");
  if (!lostOpen.ok) throw new Error(lostOpen.reason);
  const lost = decideEstimate(lostOpen.state, tenantA, lostOpen.estimateId, "lost", NOW, { enabled: true });
  if (!lost.ok) throw new Error(lost.reason);
  const lostStep = lost.state.estimateSteps.find((row) => row.estimateId === lostOpen.estimateId && row.stepId === "day-10");
  assert.equal(lostStep?.status, "done");
  assert.match(lostStep?.output || "", /lost/);
  const replied = decideEstimate(lost.state, tenantA, lostOpen.estimateId, "replied", NOW, { enabled: true });
  if (!replied.ok) throw new Error(replied.reason);
  assert.match(replied.state.estimates.find((row) => row.id === lostOpen.estimateId)?.lastNote || "", /replied/);

  const vague = recordOpenEstimate(replied.state, tenantA, {
    enrollmentId: ready.enrollmentId,
    customerName: "Drew Patel",
    label: "Maybe a repair",
    openedAt: OPENED,
    ambiguous: true,
  }, NOW, { enabled: true, ids: factory });
  if (!vague.ok) throw new Error(vague.reason);
  assert.equal(vague.state.estimates.find((row) => row.id === vague.estimateId)?.outcome, "ambiguous");
  assert.equal(vague.state.estimateSteps.filter((row) => row.estimateId === vague.estimateId).every((row) => row.status === "needs_human"), true);
  assert.match(vague.state.estimateSteps.find((row) => row.estimateId === vague.estimateId)?.output || "", /ambiguous/);
  assert.equal(vague.state.estimateSteps.find((row) => row.estimateId === vague.estimateId)?.draftedMessage, null);
  const health = sentinelPackageHealth(vague.state, tenantA, true, NOW);
  assert.equal(health.pipelines.find((row) => row.enrollmentId === ready.enrollmentId)?.health, "degraded");
  assert.match(formatFulfillmentStepReport(vague.state, tenantA), /estimate follow-ups kill switch off/);
  assert.match(formatFulfillmentStepReport(vague.state, tenantA), /Drew Patel/);
});

test("google ads drafts stay inside this workspace and do not spend", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const bought = buy(state, tenantA, "Lakeside HVAC", "google-ads", factory);
  if (!bought.ok) throw new Error(bought.reason);
  const other = buy(bought.state, tenantB, "Main Street Dental", "google-ads", factory);
  if (!other.ok) throw new Error(other.reason);
  const bare = tickGoogleAds(other.state, tenantA, NOW, { enabled: true });
  let current = bare.state;
  current = tickGoogleAds(current, tenantA, NOW, { enabled: true }).state;
  assert.equal(adsStep(current, "campaign-plan", tenantA)?.status, "needs_human");
  assert.match(adsStep(current, "campaign-plan", tenantA)?.lastError || "", /Missing connection: Google Ads/);
  assert.equal(adsStep(current, "weekly-report", tenantA)?.status, "needs_human");
  assert.match(adsStep(current, "change-proposal", tenantA)?.output || "", /Missing connection: Google Ads/);
  const vagueAds = buy(current, tenantA, "South Plumbing", "google-ads", factory);
  if (!vagueAds.ok) throw new Error(vagueAds.reason);
  const vagueRun = tickGoogleAds(tickGoogleAds(connect(vagueAds.state, tenantA, "google_ads"), tenantA, NOW, { enabled: true }).state, tenantA, NOW, { enabled: true }).state;
  const vaguePlan = vagueRun.packageRunSteps.find((row) => row.enrollmentId === vagueAds.enrollmentId && row.stepId === "campaign-plan");
  assert.match(vaguePlan?.output || "", /ambiguous/);
  assert.equal(vagueRun.packageRunSteps.find((row) => row.enrollmentId === vagueAds.enrollmentId && row.stepId === "weekly-report")?.status, "needs_human");
  const intake = saveClientIntake(connect(other.state, tenantA, "google_ads"), tenantA, {
    clientId: bought.clientId,
    businessName: "Lakeside HVAC",
    offer: "Furnace repair",
    serviceArea: "Lakeside",
  }, NOW, { enabled: true });
  if (!intake.ok) throw new Error(intake.reason);
  const secret = recordAdsMetrics(intake.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    periodLabel: "week",
    apiKey: "live-key",
  }, NOW, { enabled: true });
  assert.equal(secret.ok, false);
  assert.equal(secret.state.adsMetrics.length, 0);
  const stored = recordAdsMetrics(intake.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    periodLabel: "Harbor week",
    impressions: 120,
    clicks: 9,
    conversions: null,
    spendCents: null,
  }, NOW, { enabled: true, ids: factory });
  if (!stored.ok) throw new Error(stored.reason);
  const foreignMetric = recordAdsMetrics(stored.state, tenantB, {
    enrollmentId: bought.enrollmentId,
    periodLabel: "Prairie week",
    impressions: 40,
  }, NOW, { enabled: true });
  assert.equal(foreignMetric.ok, false);
  let ads = stored.state;
  for (let i = 0; i < 6; i += 1) ads = tickGoogleAds(ads, tenantA, NOW, { enabled: true }).state;
  const plan = adsStep(ads, "campaign-plan", tenantA);
  assert.equal(plan?.status, "done");
  assert.match(plan?.draft || "", /Furnace repair/);
  assert.match(plan?.draft || "", /Negative keywords/);
  assert.match(plan?.draft || "", /Budget recommendation/);
  assert.match(plan?.draft || "", /Spend is UNKNOWN/);
  assert.match(plan?.draft || "", /No Google Ads API was called/);
  assert.match(plan?.draft || "", /No spend was made/);
  const proposal = adsStep(ads, "change-proposal", tenantA);
  assert.equal(proposal?.status, "needs_human");
  assert.match(proposal?.lastError || "", /Needs a person to approve/);
  const early = approveAdsChange(ads, tenantB, bought.enrollmentId, NOW, { enabled: true });
  assert.equal(early.ok, false);
  const ambiguous = saveAdsChangeNote(ads, tenantA, { enrollmentId: bought.enrollmentId, ambiguous: true, summary: "Pause something, or maybe do not." }, NOW, { enabled: true });
  if (!ambiguous.ok) throw new Error(ambiguous.reason);
  const refused = approveAdsChange(ambiguous.state, tenantA, bought.enrollmentId, NOW, { enabled: true });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /ambiguous/);
  assert.equal(adsStep(refused.state, "change-proposal", tenantA)?.status, "needs_human");
  const cleared = saveAdsChangeNote(refused.state, tenantA, { enrollmentId: bought.enrollmentId, ambiguous: false, summary: "Add the furnace keywords and leave the budget unset." }, NOW, { enabled: true });
  if (!cleared.ok) throw new Error(cleared.reason);
  const approved = approveAdsChange(cleared.state, tenantA, bought.enrollmentId, NOW, { enabled: true });
  if (!approved.ok) throw new Error(approved.reason);
  assert.equal(adsStep(approved.state, "change-proposal", tenantA)?.status, "done");
  assert.match(adsStep(approved.state, "change-proposal", tenantA)?.output || "", /Nothing was pushed to Google Ads/);
  assert.equal(approved.state.billingEvents.every((row) => row.amountCents === 0), true);
  let reported = approved.state;
  const week = "2026-11-22T15:00:00.000Z";
  for (let i = 0; i < 4; i += 1) reported = tickGoogleAds(reported, tenantA, week, { enabled: true }).state;
  const report = adsStep(reported, "weekly-report", tenantA);
  assert.equal(report?.status, "done");
  assert.match(report?.draft || "", /Harbor week/);
  assert.match(report?.draft || "", /Impressions: 120/);
  assert.match(report?.draft || "", /Conversions: UNKNOWN/);
  assert.match(report?.draft || "", /Spend: UNKNOWN/);
  assert.match(report?.draft || "", /No spend was made/);
  assert.doesNotMatch(report?.draft || "", /Prairie/);
  const paused = setEnrollmentStatus(reported, tenantA, bought.enrollmentId, "paused");
  assert.equal(tickGoogleAds(paused, tenantA, week, { enabled: true }).advanced, 0);
  const src = ["google-ads.ts", "estimate-follow-ups.ts", "dry-run-sender.ts"].map((name) => readFileSync(join(root, name), "utf8")).join("\n");
  assert.doesNotMatch(src, /googleapis|google-ads-api|canSend|twilio|sk_live|STRIPE_SECRET|fetch\(/i);
  assert.equal(sentinelPackageHealth(reported, tenantA, false, week).pipelines[0]?.health, "disabled");
});

test("estimate follow-ups still require this client's lead follow-up, and a missing feed stops the cadence", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const blocked = buy(state, tenantA, "North Roofing", "estimate-follow-ups", factory);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /Lead Follow-Up/);
  const ready = withParent(state, tenantA, "North Roofing", factory);
  const otherParent = withParent(ready.state, tenantB, "North Roofing", factory);
  const wrong = recordOpenEstimate(otherParent.state, tenantA, {
    enrollmentId: otherParent.enrollmentId,
    customerName: "Pat Nguyen",
    label: "Roof",
    openedAt: OPENED,
  }, NOW, { enabled: true });
  assert.equal(wrong.ok, false);
  const cancelled = setEnrollmentStatus(otherParent.state, tenantA, ready.state.enrollments.find((row) => row.tenantId === tenantA && row.packageId === "lead-follow-up")?.id || "", "cancelled");
  const afterCancel = recordOpenEstimate(cancelled, tenantA, {
    enrollmentId: ready.enrollmentId,
    customerName: "Pat Nguyen",
    label: "Roof",
    openedAt: OPENED,
  }, NOW, { enabled: true });
  assert.equal(afterCancel.ok, false);
  const restored = setEnrollmentStatus(cancelled, tenantA, ready.state.enrollments.find((row) => row.tenantId === tenantA && row.packageId === "lead-follow-up")?.id || "", "active");
  const missing = openEstimate(connect(restored, tenantB, "estimate_feed"), tenantA, ready.enrollmentId);
  if (!missing.ok) throw new Error(missing.reason);
  let current = missing.state;
  current = tickEstimates(current, tenantA, NOW, { enabled: true }).state;
  current = tickEstimates(current, tenantA, NOW, { enabled: true }).state;
  assert.match(estimateStep(current, "day-2", tenantA)?.lastError || "", /Missing connection: Estimate feed/);
  assert.equal(estimateStep(current, "day-5", tenantA)?.status, "needs_human");
  assert.equal(estimateStep(current, "close-out", tenantA)?.status, "needs_human");
  assert.doesNotMatch(estimateStep(current, "day-2", tenantA)?.output || "", /Connected \(test\)/);
});
