import {
  packagePipelineEnabled,
  stopLaterCadenceSteps,
} from "./cadence.ts";
import { listConnections } from "./connections.ts";
import {
  clientLabel,
  enrollmentFor,
  intakeFor,
  runStepsOf,
  runsOf,
  setPackageWorkspaceKill,
  tickPackageRun,
  workspaceLabel,
  type PackageFlag,
  type PackageRunSpec,
} from "./package-runs.ts";
import type { IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { AdsChangeNote, AdsMetricSnapshot, FulfillmentState, PackageRunStep } from "./types.ts";

const QUIET = "No Google Ads API was called. No spend was made.";
const STOP = `Stopped because an earlier step failed. Needs a person. ${QUIET}`;
const MISSING = `Missing connection: Google Ads. ${QUIET}`;

export const GOOGLE_ADS_STEPS = [
  { id: "campaign-plan", title: "Campaign plan", delayDays: 0, delayMonths: 0 },
  { id: "change-proposal", title: "Change proposal", delayDays: 0, delayMonths: 0 },
  { id: "weekly-report", title: "Weekly performance report", delayDays: 7, delayMonths: 0 },
] as const;

const ORDER = GOOGLE_ADS_STEPS.map((step) => step.id);

const SECRET_KEYS = ["accessToken", "developerToken", "refreshToken", "apiKey", "customerId", "loginCustomerId"] as const;

function onFile(value: string | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed || "not on file";
}

function metricsOf(state: FulfillmentState): AdsMetricSnapshot[] {
  return state.adsMetrics || [];
}

function notesOf(state: FulfillmentState): AdsChangeNote[] {
  return state.adsChangeNotes || [];
}

export function googleAdsLine(state: FulfillmentState, tenantId: string): { connected: boolean; line: string } {
  const row = listConnections(state, tenantId).find((item) => item.kind === "google_ads");
  if (row?.status === "stub_connected") {
    return { connected: true, line: `Connected (test): Google Ads. ${QUIET}` };
  }
  return { connected: false, line: MISSING };
}

function noteFor(state: FulfillmentState, tenantId: string, enrollmentId: string): AdsChangeNote | null {
  return notesOf(state).find((row) => row.tenantId === tenantId && row.enrollmentId === enrollmentId) || null;
}

function latestMetric(state: FulfillmentState, tenantId: string, clientId: string): AdsMetricSnapshot | null {
  const rows = metricsOf(state).filter((row) => row.tenantId === tenantId && row.clientId === clientId && row.source === "stored");
  rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return rows.at(-1) || null;
}

function countLabel(value: number | null, name: string): string {
  if (value == null) return `${name}: UNKNOWN.`;
  return `${name}: ${value}.`;
}

function spendLabel(cents: number | null): string {
  if (cents == null) return "Spend: UNKNOWN.";
  const dollars = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `Stored spend: ${dollars}. This figure was not charged.`;
}

function planDraft(state: FulfillmentState, step: PackageRunStep): string {
  const intake = intakeFor(state, step.tenantId, step.clientId);
  const client = clientLabel(state, step.tenantId, step.clientId) || "this client";
  const offer = (intake?.offer || "").trim();
  const area = onFile(intake?.serviceArea);
  const business = onFile(intake?.businessName || client);
  return [
    `Campaign plan for ${client}.`,
    `Keywords: ${offer} ${area}; ${offer} near me; ${business} ${offer}.`,
    `Ad group: ${offer}.`,
    `Ad copy draft: Headline: ${offer}. Headline: ${business}. Description: ${client} serves ${area}.`,
    "Negative keywords: free, jobs, careers, diy, wholesale.",
    "Budget recommendation: a person sets the test budget. This draft does not set one. Spend is UNKNOWN.",
    "Taken from this workspace's stored intake.",
    QUIET,
  ].join(" ");
}

function googleAdsOutcome(state: FulfillmentState, step: PackageRunStep) {
  const connection = googleAdsLine(state, step.tenantId);
  const client = clientLabel(state, step.tenantId, step.clientId) || "this client";
  if (!connection.connected) {
    return {
      outcome: { status: "needs_human" as const, output: connection.line, lastError: connection.line, log: connection.line },
      patch: { draft: null },
    };
  }
  if (step.stepId === "campaign-plan") {
    const intake = intakeFor(state, step.tenantId, step.clientId);
    if (!(intake?.offer || "").trim()) {
      const output = `The offer is not on file, so the campaign plan is ambiguous. Needs a person. ${QUIET}`;
      return {
        outcome: { status: "needs_human" as const, output, lastError: output, log: output },
        patch: { draft: null },
      };
    }
    const draft = planDraft(state, step);
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Campaign plan drafted from stored intake. ${connection.line}` },
      patch: { draft },
    };
  }
  if (step.stepId === "change-proposal") {
    const note = noteFor(state, step.tenantId, step.enrollmentId);
    if (note?.ambiguous) {
      const output = `The change is ambiguous. Needs a person. ${QUIET}`;
      return {
        outcome: { status: "needs_human" as const, output, lastError: output, log: output },
        patch: { draft: note.summary || null },
      };
    }
    const summary = note?.summary.trim()
      || `Add the drafted keywords and negative keywords for ${client}, and leave the budget for a person to set.`;
    const draft = `Change proposal for ${client}: ${summary} Needs a person to approve this before anything changes. Nothing was pushed to Google Ads. ${QUIET}`;
    return {
      outcome: {
        status: "needs_human" as const,
        output: draft,
        lastError: "Needs a person to approve this change. Nothing was pushed to Google Ads.",
        log: `Change proposal drafted. Needs a person. ${connection.line}`,
      },
      patch: { draft },
    };
  }
  const metric = latestMetric(state, step.tenantId, step.clientId);
  const draft = [
    `Weekly performance report for ${client} in ${workspaceLabel(state, step.tenantId)}.`,
    metric ? `Period: ${metric.periodLabel}.` : "Period: not on file.",
    countLabel(metric?.impressions ?? null, "Impressions"),
    countLabel(metric?.clicks ?? null, "Clicks"),
    countLabel(metric?.conversions ?? null, "Conversions"),
    spendLabel(metric?.spendCents ?? null),
    "These figures are stored for this workspace only.",
    `${QUIET} Nothing was emailed.`,
  ].join(" ");
  return {
    outcome: {
      status: "done" as const,
      output: draft,
      lastError: null,
      log: `Weekly report drafted from stored metrics. ${connection.line}`,
    },
    patch: { draft },
  };
}

const SPEC: PackageRunSpec = {
  packageId: "google-ads",
  steps: GOOGLE_ADS_STEPS,
  killField: "googleAdsKillSwitch",
  quietLine: QUIET,
  stopReason: STOP,
  killMessage: `Workspace kill switch is on. Google Ads drafts are stopped. ${QUIET} Sales outreach was not changed.`,
  noticePrefix: "google_ads_run",
  outcome: googleAdsOutcome,
};

export function tickGoogleAds(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: PackageFlag & { ids?: IdFactory; runStep?: (step: PackageRunStep) => void } = {},
): { state: FulfillmentState; advanced: number } {
  const before = runStepsOf(state);
  const tick = tickPackageRun(state, tenantId, now, SPEC, opts);
  if (tick.advanced === 0 && tick.state === state) return tick;
  const blocked = runStepsOf(tick.state).filter((step) => {
    if (step.tenantId !== tenantId || step.packageId !== "google-ads" || step.status !== "needs_human") return false;
    if (!(step.lastError || "").includes("Missing connection: Google Ads") && !(step.lastError || "").includes("campaign plan is ambiguous")) return false;
    const previous = before.find((row) => row.id === step.id);
    return !previous || previous.status !== "needs_human";
  });
  if (blocked.length === 0) return tick;
  let steps = runStepsOf(tick.state);
  for (const step of blocked) {
    steps = stopLaterCadenceSteps(steps, ORDER, step.stepId, (row) => row.runId === step.runId && row.tenantId === tenantId, now, step.lastError || STOP);
  }
  const failed = new Set(blocked.map((step) => step.runId));
  return {
    advanced: tick.advanced,
    state: {
      ...tick.state,
      packageRunSteps: steps,
      packageRuns: runsOf(tick.state).map((run) => failed.has(run.id) && run.tenantId === tenantId ? { ...run, status: "needs_human" as const } : run),
    },
  };
}

export function setGoogleAdsKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: PackageFlag = {},
) {
  return setPackageWorkspaceKill(state, tenantId, on, now, SPEC, options);
}

function ownsGoogleAds(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "google-ads" && !enrollment.includedPackageIds.includes("google-ads")) return null;
  return enrollment;
}

function countable(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) return Number.NaN;
  return value;
}

export type RecordAdsMetricsInput = {
  enrollmentId: string;
  periodLabel: string;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  spendCents?: number | null;
  accessToken?: unknown;
  developerToken?: unknown;
  refreshToken?: unknown;
  apiKey?: unknown;
  customerId?: unknown;
  loginCustomerId?: unknown;
};

export type RecordAdsMetricsResult =
  | { ok: true; state: FulfillmentState; metricId: string }
  | { ok: false; state: FulfillmentState; reason: string };

/** Store figures a person already has. This does not call Google Ads and does not spend. */
export function recordAdsMetrics(
  state: FulfillmentState,
  tenantId: string,
  input: RecordAdsMetricsInput,
  now: string,
  options: PackageFlag & { ids?: IdFactory } = {},
): RecordAdsMetricsResult {
  if (!packagePipelineEnabled(options.enabled)) return { ok: false, state, reason: "Package fulfillment is off." };
  if (SECRET_KEYS.some((key) => input[key] !== undefined)) {
    return { ok: false, state, reason: `Live Google Ads credentials are not stored. ${QUIET}` };
  }
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, state, reason: "Open this marketer's workspace before storing ad figures." };
  }
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. Nothing was stored and no charge was attempted." };
  }
  if (workspace.googleAdsKillSwitch) {
    return { ok: false, state, reason: `Google Ads drafts are stopped for this workspace. ${QUIET}` };
  }
  const enrollment = ownsGoogleAds(state, tenantId, input.enrollmentId);
  if (!enrollment || enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "Store figures on an active Google Ads package in this workspace." };
  }
  const periodLabel = input.periodLabel.trim().replace(/\s+/g, " ");
  if (!periodLabel) return { ok: false, state, reason: "The stored figures need a period label." };
  const impressions = countable(input.impressions);
  const clicks = countable(input.clicks);
  const conversions = countable(input.conversions);
  const spendCents = countable(input.spendCents);
  if ([impressions, clicks, conversions, spendCents].some((value) => Number.isNaN(value))) {
    return { ok: false, state, reason: "Stored figures have to be whole numbers, or left blank. Nothing was stored." };
  }
  const ids = options.ids || (() => `ads_${now.replace(/\W/g, "")}_${metricsOf(state).length + 1}`);
  const metric: AdsMetricSnapshot = {
    id: ids(),
    tenantId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
    periodLabel,
    impressions,
    clicks,
    conversions,
    spendCents,
    recordedAt: now,
    source: "stored",
  };
  return {
    ok: true,
    metricId: metric.id,
    state: { ...state, adsMetrics: [...metricsOf(state), metric] },
  };
}

export type AdsNoteInput = {
  enrollmentId: string;
  summary?: string;
  ambiguous?: boolean;
};

export type AdsNoteResult =
  | { ok: true; state: FulfillmentState }
  | { ok: false; state: FulfillmentState; reason: string };

function openAdsEnrollment(state: FulfillmentState, tenantId: string, enrollmentId: string, enabled: boolean | undefined) {
  if (!packagePipelineEnabled(enabled)) return { ok: false as const, reason: "Package fulfillment is off." };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") return { ok: false as const, reason: "Open this marketer's workspace first." };
  if (workspace.googleAdsKillSwitch) return { ok: false as const, reason: `Google Ads drafts are stopped for this workspace. ${QUIET}` };
  const enrollment = ownsGoogleAds(state, tenantId, enrollmentId);
  if (!enrollment || enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false as const, reason: "This Google Ads package is not running. Nothing was changed." };
  }
  return { ok: true as const, enrollment };
}

/** Mark the change unclear, or replace the proposal text. Approval stays closed while it is ambiguous. */
export function saveAdsChangeNote(
  state: FulfillmentState,
  tenantId: string,
  input: AdsNoteInput,
  now: string,
  options: PackageFlag = {},
): AdsNoteResult {
  const opened = openAdsEnrollment(state, tenantId, input.enrollmentId, options.enabled);
  if (!opened.ok) return { ok: false, state, reason: opened.reason };
  const summary = (input.summary || "").trim().replace(/\s+/g, " ");
  const ambiguous = input.ambiguous === true;
  const note: AdsChangeNote = {
    tenantId,
    clientId: opened.enrollment.clientId,
    enrollmentId: opened.enrollment.id,
    summary,
    ambiguous,
    status: "open",
    updatedAt: now,
  };
  const reason = ambiguous
    ? `The change is ambiguous. Needs a person. ${QUIET}`
    : "Needs a person to approve this change. Nothing was pushed to Google Ads.";
  const steps = runStepsOf(state).map((step) => {
    if (step.tenantId !== tenantId || step.enrollmentId !== opened.enrollment.id || step.stepId !== "change-proposal") return step;
    if (step.status !== "needs_human" && step.status !== "pending") return step;
    if ((step.lastError || "").includes("Failed after retries")) return step;
    const draft = summary
      ? `Change proposal for ${clientLabel(state, tenantId, opened.enrollment.clientId) || "this client"}: ${summary} ${reason}`
      : step.draft;
    return {
      ...step,
      status: "needs_human" as const,
      lastError: reason,
      output: draft || reason,
      draft: draft || step.draft,
      finishedAt: step.finishedAt || now,
      nextRunAt: null,
      logs: [...step.logs, { at: now, message: reason }].slice(-30),
    };
  });
  return {
    ok: true,
    state: {
      ...state,
      adsChangeNotes: [...notesOf(state).filter((row) => !(row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id)), note],
      packageRunSteps: steps,
    },
  };
}

/** A person approved the proposal. The account is not changed and nothing is spent. */
export function approveAdsChange(
  state: FulfillmentState,
  tenantId: string,
  enrollmentId: string,
  now: string,
  options: PackageFlag = {},
): AdsNoteResult {
  const opened = openAdsEnrollment(state, tenantId, enrollmentId, options.enabled);
  if (!opened.ok) return { ok: false, state, reason: opened.reason };
  const note = noteFor(state, tenantId, opened.enrollment.id);
  if (note?.ambiguous) {
    return { ok: false, state, reason: `The change is ambiguous. Needs a person. ${QUIET}` };
  }
  const step = runStepsOf(state).find((row) => row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id && row.stepId === "change-proposal");
  if (!step || step.status !== "needs_human") {
    return { ok: false, state, reason: "The change proposal is not waiting for a person. Nothing was pushed to Google Ads." };
  }
  if ((step.lastError || "").includes("Failed after retries") || (step.lastError || "").includes("ambiguous") || (step.lastError || "").includes("Missing connection")) {
    return { ok: false, state, reason: `This proposal still needs a person. ${QUIET}` };
  }
  const approved = "Approved by a person. Nothing was pushed to Google Ads. No spend was made. No Google Ads API was called.";
  const nextNote: AdsChangeNote = {
    tenantId,
    clientId: opened.enrollment.clientId,
    enrollmentId: opened.enrollment.id,
    summary: note?.summary || "",
    ambiguous: false,
    status: "approved",
    updatedAt: now,
  };
  return {
    ok: true,
    state: {
      ...state,
      adsChangeNotes: [...notesOf(state).filter((row) => !(row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id)), nextNote],
      packageRunSteps: runStepsOf(state).map((row) => row.id === step.id
        ? {
            ...row,
            status: "done" as const,
            lastError: null,
            finishedAt: now,
            nextRunAt: null,
            output: `${row.draft || row.output} ${approved}`,
            logs: [...row.logs, { at: now, message: approved }].slice(-30),
          }
        : row),
    },
  };
}
