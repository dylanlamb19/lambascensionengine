import { quietHoursShift } from "./appointment-reminders.ts";
import {
  appendCadenceLog,
  packagePipelineEnabled,
  stampWorkspaceKill,
  stopLaterCadenceSteps,
  tickCadenceSteps,
  withPipelineCapNotice,
} from "./cadence.ts";
import { listConnections } from "./connections.ts";
import { draftEstimateFollowUp, type EstimateDraftKind } from "./dry-run-sender.ts";
import { clientLabel, enrollmentFor, type PackageFlag } from "./package-runs.ts";
import { addDays, type IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { EstimateOutcome, EstimateStep, EstimateStepId, FulfillmentState, OpenEstimate } from "./types.ts";
import { assertPipelineRunAllowed, usageFor, writeUsage } from "./usage.ts";

/** Same quiet window as appointment reminders: 8:00–21:00 America/Chicago. */
export { quietHoursShift };

const QUIET = "Nothing was sent. Lead Follow-Up was not duplicated. Sales outreach was not used.";
const STOP = `Stopped because an earlier step failed. Needs a person. ${QUIET}`;
const KILL = `Workspace kill switch is on. Estimate follow-ups are stopped. ${QUIET}`;
const MISSING = `Missing connection: Estimate feed. ${QUIET}`;

export const ESTIMATE_STEPS: { id: EstimateStepId; title: string; days: number }[] = [
  { id: "day-2", title: "Day 2 follow-up", days: 2 },
  { id: "day-5", title: "Day 5 follow-up", days: 5 },
  { id: "day-10", title: "Day 10 follow-up", days: 10 },
  { id: "close-out", title: "Close-out draft", days: 14 },
];

const ORDER = ESTIMATE_STEPS.map((step) => step.id);

export type EstimateFlag = PackageFlag;

type IdOpts = EstimateFlag & { ids?: IdFactory; runStep?: (step: EstimateStep) => void };

let estimateSeq = 0;
function defaultIds(): IdFactory {
  return () => `est_${Date.now().toString(36)}_${++estimateSeq}`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function estimatesOf(state: FulfillmentState): OpenEstimate[] {
  return state.estimates || [];
}

function stepsOf(state: FulfillmentState): EstimateStep[] {
  return state.estimateSteps || [];
}

function followUpInstant(openedAt: string, stepId: EstimateStepId, now: string): { at: string; held: boolean } {
  const days = ESTIMATE_STEPS.find((step) => step.id === stepId)?.days ?? 0;
  const raw = addDays(openedAt, days);
  const target = raw > now ? raw : now;
  return quietHoursShift(target);
}

export function estimateFeedLine(state: FulfillmentState, tenantId: string): { connected: boolean; line: string } {
  const row = listConnections(state, tenantId).find((item) => item.kind === "estimate_feed");
  if (row?.status === "stub_connected") {
    return { connected: true, line: `Connected (test): Estimate feed. No estimate feed was read. ${QUIET}` };
  }
  return { connected: false, line: MISSING };
}

function estimateEnrollment(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "estimate-follow-ups" && !enrollment.includedPackageIds.includes("estimate-follow-ups")) return null;
  return enrollment;
}

function activeLeadFollowUp(state: FulfillmentState, tenantId: string, clientId: string) {
  return state.enrollments.find((row) =>
    row.tenantId === tenantId
    && row.clientId === clientId
    && row.packageId === "lead-follow-up"
    && row.status === "active"
    && !row.killSwitch,
  ) || null;
}

export type RecordEstimateInput = {
  enrollmentId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  label: string;
  openedAt: string;
  /** True when the estimate is not clearly open. The cadence then needs a person. */
  ambiguous?: boolean;
};

export type RecordEstimateResult =
  | { ok: true; state: FulfillmentState; estimateId: string; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

/**
 * Record an open estimate and schedule dry-run follow-ups.
 * The same client must already have active Lead Follow-Up in this workspace.
 * Nothing is sent.
 */
export function recordOpenEstimate(
  state: FulfillmentState,
  tenantId: string,
  input: RecordEstimateInput,
  now: string,
  options: IdOpts = {},
): RecordEstimateResult {
  if (!packagePipelineEnabled(options.enabled)) return { ok: false, state, reason: "Package fulfillment is off." };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, state, reason: "Open this marketer's workspace before recording an estimate." };
  }
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. The estimate was not recorded and no charge was attempted." };
  }
  if (workspace.estimateFollowUpsKillSwitch) {
    return { ok: false, state, reason: `Estimate follow-ups are stopped for this workspace. ${QUIET}` };
  }
  const openedAt = (input.openedAt || "").trim();
  if (!openedAt || Number.isNaN(new Date(openedAt).getTime())) {
    return { ok: false, state, reason: "The estimate needs the date it was opened." };
  }
  const customerName = input.customerName.trim().replace(/\s+/g, " ");
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!customerName || !label) return { ok: false, state, reason: "The estimate needs the customer and a label." };
  const enrollment = estimateEnrollment(state, tenantId, input.enrollmentId);
  if (!enrollment) return { ok: false, state, reason: "Record this on an active Estimate Follow-Ups package in this workspace." };
  if (enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This client's estimate pipeline is not running. Nothing was sent." };
  }
  const parent = activeLeadFollowUp(state, tenantId, enrollment.clientId);
  if (!parent) {
    return {
      ok: false,
      state,
      reason: "Estimate Follow-Ups needs active Lead Follow-Up for this same client. A second follow-up sequence was not created.",
    };
  }
  const existing = estimatesOf(state).find((row) =>
    row.tenantId === tenantId
    && row.enrollmentId === enrollment.id
    && normalize(row.customerName) === normalize(customerName)
    && normalize(row.label) === normalize(label)
    && row.openedAt === openedAt,
  );
  if (existing) return { ok: true, state, estimateId: existing.id, created: false };
  const ids = options.ids || defaultIds();
  const ambiguous = input.ambiguous === true;
  const estimate: OpenEstimate = {
    id: ids(),
    tenantId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
    customerName,
    customerEmail: (input.customerEmail || "").trim(),
    customerPhone: (input.customerPhone || "").trim(),
    label,
    openedAt,
    recordedAt: now,
    outcome: ambiguous ? "ambiguous" : "open",
    status: ambiguous ? "needs_human" : "active",
    lastNote: ambiguous ? `The estimate is ambiguous. Needs a person. ${QUIET}` : "",
  };
  const steps: EstimateStep[] = ESTIMATE_STEPS.map((step) => {
    const when = followUpInstant(openedAt, step.id, now);
    const quiet = when.held ? ` Quiet hours. Held until ${when.at}.` : "";
    if (ambiguous) {
      const reason = `The estimate is ambiguous. Needs a person. ${QUIET}`;
      return {
        id: `${estimate.id}:${step.id}`,
        tenantId,
        estimateId: estimate.id,
        enrollmentId: enrollment.id,
        clientId: enrollment.clientId,
        stepId: step.id,
        title: step.title,
        status: "needs_human",
        attempts: 0,
        lastError: reason,
        createdAt: now,
        startedAt: null,
        finishedAt: now,
        nextRunAt: null,
        output: reason,
        draftedMessage: null,
        logs: [{ at: now, message: reason }],
      };
    }
    return {
      id: `${estimate.id}:${step.id}`,
      tenantId,
      estimateId: estimate.id,
      enrollmentId: enrollment.id,
      clientId: enrollment.clientId,
      stepId: step.id,
      title: step.title,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      nextRunAt: when.at,
      output: "",
      draftedMessage: null,
      logs: [{ at: now, message: `Scheduled from the open estimate.${quiet} ${QUIET}` }],
    };
  });
  return {
    ok: true,
    estimateId: estimate.id,
    created: true,
    state: {
      ...state,
      estimates: [...estimatesOf(state), estimate],
      estimateSteps: [...stepsOf(state), ...steps],
    },
  };
}

function stopMessage(outcome: Exclude<EstimateOutcome, "open" | "ambiguous">): string {
  const word = outcome === "won" ? "won" : outcome === "lost" ? "lost" : "replied";
  return `Stopped. The estimate was ${word}. No further drafts were written. ${QUIET}`;
}

const AMBIGUOUS = `The estimate outcome is ambiguous. Needs a person. ${QUIET}`;

function estimateOutcome(state: FulfillmentState, step: EstimateStep) {
  const estimate = estimatesOf(state).find((row) => row.id === step.estimateId && row.tenantId === step.tenantId);
  const feed = estimateFeedLine(state, step.tenantId);
  if (!estimate) {
    return {
      outcome: { status: "needs_human" as const, output: AMBIGUOUS, lastError: AMBIGUOUS, log: AMBIGUOUS },
      patch: { draftedMessage: null as string | null },
    };
  }
  if (estimate.outcome === "ambiguous") {
    return {
      outcome: { status: "needs_human" as const, output: AMBIGUOUS, lastError: AMBIGUOUS, log: AMBIGUOUS },
      patch: { draftedMessage: null as string | null },
    };
  }
  if (estimate.outcome !== "open") {
    const output = stopMessage(estimate.outcome);
    return {
      outcome: { status: "done" as const, output, lastError: null, log: output },
      patch: { draftedMessage: null as string | null },
    };
  }
  if (!feed.connected) {
    return {
      outcome: { status: "needs_human" as const, output: feed.line, lastError: feed.line, log: feed.line },
      patch: { draftedMessage: null as string | null },
    };
  }
  const draft = draftEstimateFollowUp({
    kind: step.stepId as EstimateDraftKind,
    customerName: estimate.customerName,
    customerEmail: estimate.customerEmail,
    customerPhone: estimate.customerPhone,
    clientName: clientLabel(state, step.tenantId, step.clientId),
    label: estimate.label,
  });
  const output = `${draft.logLine} ${feed.line}`;
  return {
    outcome: { status: "done" as const, output, lastError: null, log: output },
    patch: { draftedMessage: draft.body },
  };
}

export function tickEstimates(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: IdOpts = {},
): { state: FulfillmentState; advanced: number } {
  if (!packagePipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  const original = stepsOf(state);
  const tick = tickCadenceSteps({
    state,
    tenantId,
    now,
    steps: original,
    order: ORDER,
    groupId: (step) => step.estimateId,
    inGroup: (row, step) => row.estimateId === step.estimateId,
    prepare: (step) => {
      const estimate = estimatesOf(state).find((row) => row.id === step.estimateId && row.tenantId === tenantId);
      const enrollment = estimate ? enrollmentFor(state, tenantId, estimate.enrollmentId) : null;
      if (!estimate || !enrollment) return { skip: true };
      const parent = activeLeadFollowUp(state, tenantId, estimate.clientId);
      return {
        skip: false,
        runnable: !workspace.estimateFollowUpsKillSwitch
          && !enrollment.killSwitch
          && enrollment.status === "active"
          && estimate.status === "active"
          && estimate.outcome === "open"
          && Boolean(parent),
      };
    },
    execute: (step) => {
      opts.runStep?.(step);
      return estimateOutcome(state, step);
    },
    quietLine: QUIET,
    stopReason: STOP,
    runs: usageFor(state, tenantId).pipelineRuns,
    allow: (runs) => assertPipelineRunAllowed(state, tenantId, runs),
  });
  if (tick.unchanged) return { state, advanced: 0 };
  let steps = tick.steps;
  const freshlyBlocked = steps.filter((step) => {
    if (step.tenantId !== tenantId || step.status !== "needs_human") return false;
    if (!(step.lastError || "").includes("Missing connection: Estimate feed")) return false;
    const before = original.find((row) => row.id === step.id);
    return Boolean(before && before.status !== "needs_human");
  });
  for (const step of freshlyBlocked) {
    steps = stopLaterCadenceSteps(steps, ORDER, step.stepId, (row) => row.estimateId === step.estimateId && row.tenantId === tenantId, now, step.lastError || STOP);
  }
  const blockedIds = new Set([
    ...tick.escalations.map((row) => row.groupId),
    ...freshlyBlocked.map((step) => step.estimateId),
  ]);
  const next = withPipelineCapNotice(
    writeUsage({
      ...state,
      estimateSteps: steps,
      estimates: estimatesOf(state).map((row) => blockedIds.has(row.id) && row.tenantId === tenantId ? { ...row, status: "needs_human" as const } : row),
    }, { ...usageFor(state, tenantId), pipelineRuns: tick.runs }),
    tenantId,
    now,
    tick.blocked,
    `estimate_run_${now}`,
  );
  return { state: next, advanced: tick.advanced };
}

export type EstimateDecision = "won" | "lost" | "replied" | "ambiguous";

export type EstimateDecisionResult =
  | { ok: true; state: FulfillmentState }
  | { ok: false; state: FulfillmentState; reason: string };

/** Stop the cadence when the estimate is won, lost, or replied. Ambiguity needs a person. Nothing is sent. */
export function decideEstimate(
  state: FulfillmentState,
  tenantId: string,
  estimateId: string,
  decision: EstimateDecision,
  now: string,
  options: EstimateFlag = {},
): EstimateDecisionResult {
  if (!packagePipelineEnabled(options.enabled)) return { ok: false, state, reason: "Package fulfillment is off." };
  const estimate = estimatesOf(state).find((row) => row.id === estimateId && row.tenantId === tenantId);
  if (!estimate) return { ok: false, state, reason: "That estimate is not in this workspace." };
  const workspace = workspaceFor(state, tenantId);
  if (workspace?.estimateFollowUpsKillSwitch) {
    return { ok: false, state, reason: `Estimate follow-ups are stopped for this workspace. ${QUIET}` };
  }
  const enrollment = enrollmentFor(state, tenantId, estimate.enrollmentId);
  if (!enrollment || enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This client's estimate pipeline is not running. Nothing was sent." };
  }
  if (!activeLeadFollowUp(state, tenantId, estimate.clientId)) {
    return { ok: false, state, reason: "Estimate Follow-Ups needs active Lead Follow-Up for this same client. Nothing was sent." };
  }
  const ambiguous = decision === "ambiguous";
  const note = ambiguous ? AMBIGUOUS : stopMessage(decision);
  const outcome: EstimateOutcome = decision;
  return {
    ok: true,
    state: {
      ...state,
      estimates: estimatesOf(state).map((row) => row.id === estimate.id
        ? { ...row, outcome, status: ambiguous ? "needs_human" as const : "stopped" as const, lastNote: note }
        : row),
      estimateSteps: stepsOf(state).map((step) => {
        if (step.estimateId !== estimate.id || step.tenantId !== tenantId) return step;
        if (step.status === "done" && step.draftedMessage) return appendCadenceLog(step, now, note);
        if (step.status === "done" || (step.status === "needs_human" && (step.lastError || "").includes("Failed after retries"))) {
          return appendCadenceLog(step, now, note);
        }
        return appendCadenceLog(
          {
            ...step,
            status: ambiguous ? "needs_human" as const : "done" as const,
            finishedAt: now,
            nextRunAt: null,
            lastError: ambiguous ? note : null,
            output: note,
            draftedMessage: null,
          },
          now,
          note,
        );
      }),
    },
  };
}

export function setEstimateFollowUpsKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: EstimateFlag = {},
): FulfillmentState {
  if (!packagePipelineEnabled(options.enabled)) return state;
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.estimateFollowUpsKillSwitch === on) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((row) => row.id === tenantId ? { ...row, estimateFollowUpsKillSwitch: on } : row),
    estimateSteps: on ? stampWorkspaceKill(stepsOf(state), tenantId, now, KILL, () => true) : stepsOf(state),
  };
}
