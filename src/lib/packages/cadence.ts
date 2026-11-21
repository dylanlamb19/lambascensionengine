import { FLAGS } from "../flags.ts";
import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState, StepStatus } from "./types.ts";

/** Same budget the Lead Follow-Up cadence uses. A fourth failure needs a person. */
export const CADENCE_MAX_ATTEMPTS = 3;
export const CADENCE_BACKOFF_MS = 60_000;
const LOG_CAP = 30;

export type CadenceLog = { at: string; message: string };

export type CadenceStepBase = {
  id: string;
  tenantId: string;
  stepId: string;
  status: StepStatus;
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  logs: CadenceLog[];
};

export type CadenceOutcome = {
  status: "done" | "needs_human";
  output: string;
  lastError: string | null;
  log: string;
};

export function packagePipelineEnabled(override?: boolean): boolean {
  if (override === false) return false;
  if (override === true) return true;
  return FLAGS.PACKAGE_FULFILLMENT;
}

export function cadenceRetryDelayMs(attempt: number, base = CADENCE_BACKOFF_MS): number {
  return base * 2 ** Math.max(0, attempt - 1);
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function appendCadenceLog<T extends { logs: CadenceLog[] }>(step: T, at: string, message: string): T {
  return { ...step, logs: [...step.logs, { at, message }].slice(-LOG_CAP) };
}

export function predecessorSettled<T extends { stepId: string; status: StepStatus }>(
  steps: T[],
  step: T,
  order: readonly string[],
  inGroup: (row: T) => boolean,
): boolean {
  const index = order.indexOf(step.stepId);
  if (index <= 0) return true;
  const previousId = order[index - 1];
  const previous = steps.find((row) => inGroup(row) && row.stepId === previousId);
  if (!previous) return false;
  return previous.status === "done" || previous.status === "needs_human" || previous.status === "failed";
}

/**
 * One cadence step: pending, then running, then done or needs human.
 * A throw waits 60s, then 120s, then the step and everything after it need a person.
 */
export function advanceCadenceStep<T extends CadenceStepBase>(args: {
  steps: T[];
  step: T;
  order: readonly string[];
  inGroup: (row: T, step: T) => boolean;
  now: string;
  runnable: boolean;
  quietLine: string;
  execute: (step: T) => { outcome: CadenceOutcome; patch?: Partial<T> };
}): { step: T; escalate: boolean } | null {
  if (!args.runnable) return null;
  const { step, now } = args;
  if (step.status === "pending") {
    if (!predecessorSettled(args.steps, step, args.order, (row) => args.inGroup(row, step))) return null;
    if (step.nextRunAt && step.nextRunAt > now) return null;
    return {
      escalate: false,
      step: appendCadenceLog({ ...step, status: "running", startedAt: step.startedAt || now }, now, "Started."),
    };
  }
  if (step.status !== "running") return null;
  try {
    const result = args.execute(step);
    const outcome = result.outcome;
    return {
      escalate: false,
      step: appendCadenceLog(
        {
          ...step,
          ...(result.patch || {}),
          status: outcome.status,
          attempts: step.attempts + 1,
          finishedAt: now,
          nextRunAt: null,
          output: outcome.output,
          lastError: outcome.lastError,
        },
        now,
        outcome.log,
      ),
    };
  } catch (err) {
    const attempts = step.attempts + 1;
    const message = err instanceof Error ? err.message : "Step failed.";
    if (attempts >= CADENCE_MAX_ATTEMPTS) {
      return {
        escalate: true,
        step: appendCadenceLog(
          {
            ...step,
            status: "needs_human",
            attempts,
            finishedAt: now,
            nextRunAt: null,
            lastError: message,
            output: `Failed after retries. Needs a person. ${message} ${args.quietLine}`,
          },
          now,
          message,
        ),
      };
    }
    const delay = cadenceRetryDelayMs(attempts);
    return {
      escalate: false,
      step: appendCadenceLog(
        {
          ...step,
          status: "pending",
          attempts,
          finishedAt: null,
          nextRunAt: addMs(now, delay),
          lastError: message,
        },
        now,
        `Retry ${attempts} of ${CADENCE_MAX_ATTEMPTS - 1} scheduled in ${delay}ms. ${message} ${args.quietLine}`,
      ),
    };
  }
}

export function stopLaterCadenceSteps<T extends CadenceStepBase>(
  steps: T[],
  order: readonly string[],
  failedStepId: string,
  inGroup: (step: T) => boolean,
  now: string,
  reason: string,
): T[] {
  const failedIndex = order.indexOf(failedStepId);
  return steps.map((step) => {
    if (!inGroup(step)) return step;
    const index = order.indexOf(step.stepId);
    if (index <= failedIndex) return step;
    if (step.status === "done" || step.status === "needs_human" || step.status === "failed") return step;
    return appendCadenceLog(
      { ...step, status: "needs_human", finishedAt: now, nextRunAt: null, lastError: reason, output: reason },
      now,
      reason,
    );
  });
}

export type CadenceTickResult<T extends CadenceStepBase> = {
  steps: T[];
  advanced: number;
  blocked: string | null;
  escalations: { groupId: string; stepId: string }[];
  runs: number;
  unchanged: boolean;
};

/**
 * Advance every due step in one workspace. Other workspaces' rows are copied through.
 * Crossing the plan cap records nothing here; the caller writes the $0 notice.
 */
export function tickCadenceSteps<T extends CadenceStepBase>(args: {
  state: FulfillmentState;
  tenantId: string;
  now: string;
  steps: T[];
  order: readonly string[];
  groupId: (step: T) => string;
  inGroup: (row: T, step: T) => boolean;
  prepare: (step: T) => { skip: true } | { skip: false; runnable: boolean };
  execute: (step: T) => { outcome: CadenceOutcome; patch?: Partial<T> };
  quietLine: string;
  stopReason: string;
  runs: number;
  allow: (runs: number) => { ok: true } | { ok: false; reason: string };
}): CadenceTickResult<T> {
  let runs = args.runs;
  let advanced = 0;
  let blocked: string | null = null;
  const escalations: { groupId: string; stepId: string }[] = [];
  const original = args.steps;
  let steps = original.map((step) => {
    if (step.tenantId !== args.tenantId) return step;
    const ready = args.prepare(step);
    if (ready.skip) return step;
    const gate = args.allow(runs);
    if (!gate.ok) {
      blocked = gate.reason;
      return step;
    }
    const next = advanceCadenceStep({
      steps: original,
      step,
      order: args.order,
      inGroup: args.inGroup,
      now: args.now,
      runnable: ready.runnable,
      quietLine: args.quietLine,
      execute: args.execute,
    });
    if (!next) return step;
    runs += 1;
    advanced += 1;
    if (next.escalate) escalations.push({ groupId: args.groupId(step), stepId: step.stepId });
    return next.step;
  });
  if (escalations.length > 0) {
    for (const item of escalations) {
      steps = stopLaterCadenceSteps(steps, args.order, item.stepId, (step) => args.groupId(step) === item.groupId && step.tenantId === args.tenantId, args.now, args.stopReason);
    }
  }
  if (advanced === 0 && !blocked) {
    return { steps: original, advanced: 0, blocked: null, escalations, runs, unchanged: true };
  }
  return { steps, advanced, blocked, escalations, runs, unchanged: false };
}

/** A plan-cap or canceled-subscription block. amountCents is always 0. */
export function withPipelineCapNotice(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  blocked: string | null,
  noticeId: string,
): FulfillmentState {
  if (!blocked) return state;
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return state;
  const blockType = workspace.subscriptionStatus === "canceled" ? "subscription_canceled" : "pipeline_limit";
  if ((state.billingEvents || []).some((row) => row.tenantId === tenantId && row.type === blockType)) return state;
  return {
    ...state,
    billingEvents: [...(state.billingEvents || []), {
      id: noticeId,
      tenantId,
      type: blockType,
      planId: workspace.planId,
      amountCents: 0 as const,
      billingMode: "test" as const,
      at: now,
    }],
  };
}

export function stampWorkspaceKill<T extends { tenantId: string; logs: CadenceLog[] }>(
  steps: T[],
  tenantId: string,
  now: string,
  message: string,
  include: (step: T) => boolean,
): T[] {
  return steps.map((step) => (step.tenantId === tenantId && include(step) ? appendCadenceLog(step, now, message) : step));
}

/** One line of the client → package → step report. */
export function formatStepReportLine(
  indent: string,
  title: string,
  statusLabel: string,
  attempts: number,
  lastError: string | null,
  nextRunAt: string | null,
): string {
  return `${indent}${title} · ${statusLabel} · attempts ${attempts} · last error ${lastError || "—"} · next ${nextRunAt || "—"}`;
}
