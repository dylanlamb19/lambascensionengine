import {
  packagePipelineEnabled,
  stopLaterCadenceSteps,
} from "./cadence.ts";
import { listConnections } from "./connections.ts";
import { getTestPlan } from "./plans.ts";
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
import type { FulfillmentState, MetaBudgetNote, PackageRunStep } from "./types.ts";

const QUIET = "No Meta API was called. No spend was made.";
const STOP = `Stopped because an earlier step failed. Needs a person. ${QUIET}`;
const MISSING = `Missing connection: Meta. ${QUIET}`;

export const META_ADS_STEPS = [
  { id: "creative-plan", title: "Creative plan", delayDays: 0, delayMonths: 0 },
  { id: "audience-plan", title: "Audience plan", delayDays: 0, delayMonths: 0 },
  { id: "budget-check", title: "Budget cap check", delayDays: 0, delayMonths: 0 },
  { id: "approval", title: "Approval gate", delayDays: 0, delayMonths: 0 },
] as const;

const ORDER = META_ADS_STEPS.map((step) => step.id);

const SECRET_KEYS = ["accessToken", "adAccountId", "appSecret", "apiKey", "pixelId", "systemUserToken"] as const;

function onFile(value: string | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed || "not on file";
}

function notesOf(state: FulfillmentState): MetaBudgetNote[] {
  return state.metaBudgetNotes || [];
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function metaLine(state: FulfillmentState, tenantId: string): { connected: boolean; line: string } {
  const row = listConnections(state, tenantId).find((item) => item.kind === "meta");
  if (row?.status === "stub_connected") {
    return { connected: true, line: `Connected (test): Meta. ${QUIET}` };
  }
  return { connected: false, line: MISSING };
}

function noteFor(state: FulfillmentState, tenantId: string, enrollmentId: string): MetaBudgetNote | null {
  return notesOf(state).find((row) => row.tenantId === tenantId && row.enrollmentId === enrollmentId) || null;
}

function capFor(state: FulfillmentState, tenantId: string): number | null {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return 0;
  return getTestPlan(workspace.planId).adBudgetCapCents;
}

function overCap(proposed: number | null, cap: number | null): boolean {
  if (proposed == null || cap == null) return false;
  return proposed > cap;
}

function budgetReason(note: MetaBudgetNote | null, cap: number | null): { blocked: boolean; line: string } {
  if (!note || note.proposedCents == null) {
    return { blocked: true, line: `A budget proposal is not on file. Needs a person. ${QUIET}` };
  }
  if (note.ambiguous) {
    return { blocked: true, line: `The budget proposal is ambiguous. Needs a person. ${QUIET}` };
  }
  if (overCap(note.proposedCents, cap)) {
    return {
      blocked: true,
      line: `Over the test plan ad budget cap of ${dollars(cap || 0)}. Proposed ${dollars(note.proposedCents)}. Nothing was spent. ${QUIET}`,
    };
  }
  const ceiling = cap == null
    ? "This test plan has no ad budget cap."
    : `Within the test plan ad budget cap of ${dollars(cap)}.`;
  return {
    blocked: false,
    line: `Budget recommendation ${dollars(note.proposedCents)}. ${ceiling} This draft does not set a budget. ${QUIET}`,
  };
}

function metaOutcome(state: FulfillmentState, step: PackageRunStep) {
  const connection = metaLine(state, step.tenantId);
  const client = clientLabel(state, step.tenantId, step.clientId) || "this client";
  const workspace = workspaceLabel(state, step.tenantId);
  if (!connection.connected) {
    return {
      outcome: { status: "needs_human" as const, output: connection.line, lastError: connection.line, log: connection.line },
      patch: { draft: null },
    };
  }
  const intake = intakeFor(state, step.tenantId, step.clientId);
  if (step.stepId === "creative-plan") {
    if (!(intake?.offer || "").trim()) {
      const output = `The offer is not on file, so the creative plan is ambiguous. Needs a person. ${QUIET}`;
      return {
        outcome: { status: "needs_human" as const, output, lastError: output, log: output },
        patch: { draft: null },
      };
    }
    const draft = [
      `Creative plan for ${client} in ${workspace}.`,
      "Existing assets only. No new asset was generated.",
      `Primary text: ${intake?.offer} in ${onFile(intake?.serviceArea)}.`,
      `Headline: ${onFile(intake?.businessName || client)}.`,
      "Variation: a second line from the same stored offer. Nothing was published.",
      QUIET,
    ].join(" ");
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Creative plan drafted from stored intake. ${connection.line}` },
      patch: { draft },
    };
  }
  if (step.stepId === "audience-plan") {
    if (!(intake?.serviceArea || "").trim()) {
      const output = `The service area is not on file, so the audience is ambiguous. Needs a person. ${QUIET}`;
      return {
        outcome: { status: "needs_human" as const, output, lastError: output, log: output },
        patch: { draft: null },
      };
    }
    const draft = [
      `Audience plan for ${client}.`,
      `Location: ${intake?.serviceArea}.`,
      `Interest: ${onFile(intake?.offer)}.`,
      "No custom audience was uploaded. No customer list was read.",
      QUIET,
    ].join(" ");
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Audience plan drafted from stored intake. ${connection.line}` },
      patch: { draft },
    };
  }
  if (step.stepId === "budget-check") {
    const note = noteFor(state, step.tenantId, step.enrollmentId);
    const verdict = budgetReason(note, capFor(state, step.tenantId));
    if (verdict.blocked) {
      return {
        outcome: { status: "needs_human" as const, output: verdict.line, lastError: verdict.line, log: verdict.line },
        patch: { draft: verdict.line },
      };
    }
    return {
      outcome: { status: "done" as const, output: verdict.line, lastError: null, log: `Budget checked against this workspace's test plan. ${verdict.line}` },
      patch: { draft: verdict.line },
    };
  }
  const note = noteFor(state, step.tenantId, step.enrollmentId);
  const verdict = budgetReason(note, capFor(state, step.tenantId));
  const draft = verdict.blocked
    ? `Approval gate for ${client}. ${verdict.line}`
    : `Approval gate for ${client}. ${verdict.line} Needs a person before any campaign change. Nothing was pushed to Meta.`;
  return {
    outcome: {
      status: "needs_human" as const,
      output: draft,
      lastError: "Needs a person to approve this. Nothing was pushed to Meta.",
      log: `Approval gate drafted. Needs a person. ${connection.line}`,
    },
    patch: { draft },
  };
}

const SPEC: PackageRunSpec = {
  packageId: "meta-ads",
  steps: META_ADS_STEPS,
  killField: "metaAdsKillSwitch",
  quietLine: QUIET,
  stopReason: STOP,
  killMessage: `Workspace kill switch is on. Meta Ads drafts are stopped. ${QUIET} Sales outreach was not changed.`,
  noticePrefix: "meta_ads_run",
  outcome: metaOutcome,
};

export function tickMetaAds(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: PackageFlag & { ids?: IdFactory; runStep?: (step: PackageRunStep) => void } = {},
): { state: FulfillmentState; advanced: number } {
  const before = runStepsOf(state);
  const tick = tickPackageRun(state, tenantId, now, SPEC, opts);
  if (tick.advanced === 0 && tick.state === state) return tick;
  const blocked = runStepsOf(tick.state).filter((step) => {
    if (step.tenantId !== tenantId || step.packageId !== "meta-ads" || step.status !== "needs_human") return false;
    const error = step.lastError || "";
    const holds = error.includes("Missing connection: Meta") || error.includes("creative plan is ambiguous");
    if (!holds) return false;
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

export function setMetaAdsKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: PackageFlag = {},
) {
  return setPackageWorkspaceKill(state, tenantId, on, now, SPEC, options);
}

function ownsMeta(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "meta-ads" && !enrollment.includedPackageIds.includes("meta-ads")) return null;
  return enrollment;
}

export type MetaBudgetInput = {
  enrollmentId: string;
  proposedCents?: number | null;
  ambiguous?: boolean;
  accessToken?: unknown;
  adAccountId?: unknown;
  appSecret?: unknown;
  apiKey?: unknown;
  pixelId?: unknown;
  systemUserToken?: unknown;
};

export type MetaBudgetResult =
  | { ok: true; state: FulfillmentState }
  | { ok: false; state: FulfillmentState; reason: string };

function openMetaEnrollment(state: FulfillmentState, tenantId: string, enrollmentId: string, enabled: boolean | undefined) {
  if (!packagePipelineEnabled(enabled)) return { ok: false as const, reason: "Package fulfillment is off." };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") return { ok: false as const, reason: "Open this marketer's workspace first." };
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false as const, reason: "This test subscription is canceled. Nothing was stored and no charge was attempted." };
  }
  if (workspace.metaAdsKillSwitch) return { ok: false as const, reason: `Meta Ads drafts are stopped for this workspace. ${QUIET}` };
  const enrollment = ownsMeta(state, tenantId, enrollmentId);
  if (!enrollment || enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false as const, reason: "This Meta Ads package is not running. Nothing was changed." };
  }
  return { ok: true as const, enrollment, workspace };
}

/** Store a proposed budget. The cap check does not spend and does not call Meta. */
export function saveMetaBudget(
  state: FulfillmentState,
  tenantId: string,
  input: MetaBudgetInput,
  now: string,
  options: PackageFlag = {},
): MetaBudgetResult {
  if (SECRET_KEYS.some((key) => input[key] !== undefined)) {
    return { ok: false, state, reason: `Live Meta credentials are not stored. ${QUIET}` };
  }
  const opened = openMetaEnrollment(state, tenantId, input.enrollmentId, options.enabled);
  if (!opened.ok) return { ok: false, state, reason: opened.reason };
  const ambiguous = input.ambiguous === true;
  const previous = noteFor(state, tenantId, opened.enrollment.id);
  const proposed = input.proposedCents == null
    ? (ambiguous ? previous?.proposedCents ?? null : null)
    : input.proposedCents;
  if (proposed != null && (!Number.isInteger(proposed) || proposed < 0)) {
    return { ok: false, state, reason: "A proposed budget has to be a whole number of cents, or left blank. Nothing was stored." };
  }
  if (!ambiguous && proposed == null) {
    return { ok: false, state, reason: "The budget proposal needs an amount, or it has to be marked ambiguous. Nothing was stored." };
  }
  const note: MetaBudgetNote = {
    tenantId,
    clientId: opened.enrollment.clientId,
    enrollmentId: opened.enrollment.id,
    proposedCents: proposed,
    ambiguous,
    status: "open",
    updatedAt: now,
  };
  const verdict = budgetReason(note, getTestPlan(opened.workspace.planId).adBudgetCapCents);
  const steps = runStepsOf(state).map((step) => {
    if (step.tenantId !== tenantId || step.enrollmentId !== opened.enrollment.id || step.stepId !== "budget-check") return step;
    if ((step.lastError || "").includes("Failed after retries")) return step;
    if (verdict.blocked) {
      return {
        ...step,
        status: "needs_human" as const,
        lastError: verdict.line,
        output: verdict.line,
        draft: verdict.line,
        finishedAt: step.finishedAt || now,
        nextRunAt: null,
        logs: [...step.logs, { at: now, message: verdict.line }].slice(-30),
      };
    }
    if (step.status === "done") {
      return {
        ...step,
        output: verdict.line,
        draft: verdict.line,
        logs: [...step.logs, { at: now, message: verdict.line }].slice(-30),
      };
    }
    return {
      ...step,
      status: "pending" as const,
      lastError: null,
      output: "",
      draft: null,
      finishedAt: null,
      nextRunAt: now,
      logs: [...step.logs, { at: now, message: `Budget proposal stored. ${verdict.line}` }].slice(-30),
    };
  });
  return {
    ok: true,
    state: {
      ...state,
      metaBudgetNotes: [...notesOf(state).filter((row) => !(row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id)), note],
      packageRunSteps: steps,
    },
  };
}

/** A person approved the gate. Meta is not called and nothing is spent. */
export function approveMetaPlan(
  state: FulfillmentState,
  tenantId: string,
  enrollmentId: string,
  now: string,
  options: PackageFlag = {},
): MetaBudgetResult {
  const opened = openMetaEnrollment(state, tenantId, enrollmentId, options.enabled);
  if (!opened.ok) return { ok: false, state, reason: opened.reason };
  const note = noteFor(state, tenantId, opened.enrollment.id);
  const verdict = budgetReason(note, getTestPlan(opened.workspace.planId).adBudgetCapCents);
  if (verdict.blocked) return { ok: false, state, reason: verdict.line };
  const budget = runStepsOf(state).find((row) => row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id && row.stepId === "budget-check");
  if (!budget || budget.status !== "done") {
    return { ok: false, state, reason: `The budget cap check is not clear. Needs a person. ${QUIET}` };
  }
  const step = runStepsOf(state).find((row) => row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id && row.stepId === "approval");
  if (!step || step.status !== "needs_human") {
    return { ok: false, state, reason: "The approval gate is not waiting for a person. Nothing was pushed to Meta." };
  }
  const error = step.lastError || "";
  if (error.includes("Failed after retries") || error.includes("Missing connection") || error.includes("ambiguous") || error.includes("Over the test plan")) {
    return { ok: false, state, reason: `This approval still needs a person. ${QUIET}` };
  }
  const approved = "Approved by a person. Nothing was pushed to Meta. No spend was made. No Meta API was called.";
  const nextNote: MetaBudgetNote = {
    tenantId,
    clientId: opened.enrollment.clientId,
    enrollmentId: opened.enrollment.id,
    proposedCents: note?.proposedCents ?? null,
    ambiguous: false,
    status: "approved",
    updatedAt: now,
  };
  return {
    ok: true,
    state: {
      ...state,
      metaBudgetNotes: [...notesOf(state).filter((row) => !(row.tenantId === tenantId && row.enrollmentId === opened.enrollment.id)), nextNote],
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
