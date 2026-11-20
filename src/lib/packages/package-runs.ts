import type { CadenceOutcome } from "./cadence.ts";
import {
  packagePipelineEnabled,
  stampWorkspaceKill,
  tickCadenceSteps,
  withPipelineCapNotice,
} from "./cadence.ts";
import { addDays, addMonthsIso, type IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type {
  ClientIntake,
  Enrollment,
  FulfillmentState,
  PackageRun,
  PackageRunId,
  PackageRunStep,
} from "./types.ts";
import { assertPipelineRunAllowed, usageFor, writeUsage } from "./usage.ts";

export type PackageStepDef = {
  id: string;
  title: string;
  delayDays: number;
  delayMonths: number;
};

export type PackageRunOutcome = { outcome: CadenceOutcome; patch?: Partial<PackageRunStep> };

export type PackageRunSpec = {
  packageId: PackageRunId;
  steps: readonly PackageStepDef[];
  killField: "leadGenerationKillSwitch" | "aiVisibilityKillSwitch";
  quietLine: string;
  stopReason: string;
  killMessage: string;
  noticePrefix: string;
  outcome: (state: FulfillmentState, step: PackageRunStep) => PackageRunOutcome;
};

export type PackageFlag = { enabled?: boolean };

type TickOpts = PackageFlag & {
  ids?: IdFactory;
  runStep?: (step: PackageRunStep) => void;
};

function defaultIds(prefix: string): IdFactory {
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => `${prefix}_${stamp}_${++n}`;
}

export function intakesOf(state: FulfillmentState): ClientIntake[] {
  return state.intakes || [];
}

export function runsOf(state: FulfillmentState): PackageRun[] {
  return state.packageRuns || [];
}

export function runStepsOf(state: FulfillmentState): PackageRunStep[] {
  return state.packageRunSteps || [];
}

export function intakeFor(state: FulfillmentState, tenantId: string, clientId: string): ClientIntake | null {
  return intakesOf(state).find((row) => row.tenantId === tenantId && row.clientId === clientId) || null;
}

export function clientLabel(state: FulfillmentState, tenantId: string, clientId: string): string {
  return state.clients.find((row) => row.id === clientId && row.tenantId === tenantId)?.name || "";
}

export function workspaceLabel(state: FulfillmentState, tenantId: string): string {
  return workspaceFor(state, tenantId)?.name || "this workspace";
}

export function enrollmentFor(state: FulfillmentState, tenantId: string, enrollmentId: string): Enrollment | null {
  return state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId) || null;
}

function covers(enrollment: Enrollment, packageId: PackageRunId): boolean {
  return enrollment.packageId === packageId || enrollment.includedPackageIds.includes(packageId);
}

function nextAt(now: string, step: PackageStepDef): string {
  if (step.delayMonths > 0) return addMonthsIso(now, step.delayMonths);
  return addDays(now, step.delayDays);
}

export type IntakeInput = {
  clientId: string;
  businessName?: string;
  phone?: string;
  address?: string;
  website?: string;
  offer?: string;
  serviceArea?: string;
};

/** Save the client's stored profile. No site is read. */
export function saveClientIntake(
  state: FulfillmentState,
  tenantId: string,
  input: IntakeInput,
  now: string,
  options: PackageFlag = {},
): { ok: true; state: FulfillmentState } | { ok: false; state: FulfillmentState; reason: string } {
  if (!packagePipelineEnabled(options.enabled)) {
    return { ok: false, state, reason: "Package fulfillment is off." };
  }
  const client = state.clients.find((row) => row.id === input.clientId && row.tenantId === tenantId);
  if (!client) return { ok: false, state, reason: "That client is not in this workspace." };
  const intake: ClientIntake = {
    tenantId,
    clientId: client.id,
    businessName: (input.businessName || "").trim(),
    phone: (input.phone || "").trim(),
    address: (input.address || "").trim(),
    website: (input.website || "").trim(),
    offer: (input.offer || "").trim(),
    serviceArea: (input.serviceArea || "").trim(),
    updatedAt: now,
  };
  const rest = intakesOf(state).filter((row) => !(row.tenantId === tenantId && row.clientId === client.id));
  return { ok: true, state: { ...state, intakes: [...rest, intake] } };
}

function ensureRuns(state: FulfillmentState, tenantId: string, now: string, spec: PackageRunSpec): FulfillmentState {
  const existing = runsOf(state);
  const additions: PackageRun[] = [];
  const steps: PackageRunStep[] = [];
  for (const enrollment of state.enrollments) {
    if (enrollment.tenantId !== tenantId || enrollment.status === "cancelled") continue;
    if (!covers(enrollment, spec.packageId)) continue;
    if (existing.some((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id && row.packageId === spec.packageId)) continue;
    const run: PackageRun = {
      id: `${tenantId}:${spec.packageId}:${enrollment.id}`,
      tenantId,
      clientId: enrollment.clientId,
      enrollmentId: enrollment.id,
      packageId: spec.packageId,
      status: "active",
      openedAt: now,
    };
    additions.push(run);
    for (const step of spec.steps) {
      steps.push({
        id: `${run.id}:${step.id}`,
        tenantId,
        runId: run.id,
        enrollmentId: enrollment.id,
        clientId: enrollment.clientId,
        packageId: spec.packageId,
        stepId: step.id,
        title: step.title,
        status: "pending",
        attempts: 0,
        lastError: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        nextRunAt: nextAt(now, step),
        output: "",
        draft: null,
        logs: [{ at: now, message: "Scheduled." }],
      });
    }
  }
  if (additions.length === 0) return state;
  return {
    ...state,
    packageRuns: [...existing, ...additions],
    packageRunSteps: [...runStepsOf(state), ...steps],
  };
}

/** Open missing runs, then advance due steps for one package in one workspace. */
export function tickPackageRun(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  spec: PackageRunSpec,
  opts: TickOpts = {},
): { state: FulfillmentState; advanced: number } {
  if (!packagePipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  const opened = ensureRuns(state, tenantId, now, spec);
  const order = spec.steps.map((step) => step.id);
  const tick = tickCadenceSteps({
    state: opened,
    tenantId,
    now,
    steps: runStepsOf(opened),
    order,
    groupId: (step) => step.runId,
    inGroup: (row, step) => row.runId === step.runId,
    prepare: (step) => {
      if (step.packageId !== spec.packageId) return { skip: true };
      const run = runsOf(opened).find((row) => row.id === step.runId && row.tenantId === tenantId);
      const enrollment = run ? enrollmentFor(opened, tenantId, run.enrollmentId) : null;
      if (!run || !enrollment) return { skip: true };
      return {
        skip: false,
        runnable: !workspace[spec.killField]
          && !enrollment.killSwitch
          && enrollment.status === "active"
          && run.status === "active",
      };
    },
    execute: (step) => {
      opts.runStep?.(step);
      return spec.outcome(opened, step);
    },
    quietLine: spec.quietLine,
    stopReason: spec.stopReason,
    runs: usageFor(opened, tenantId).pipelineRuns,
    allow: (runs) => assertPipelineRunAllowed(opened, tenantId, runs),
  });
  const openedChanged = opened !== state;
  if (tick.unchanged && !openedChanged) return { state, advanced: 0 };
  let next = opened;
  if (!tick.unchanged) {
    next = writeUsage({ ...opened, packageRunSteps: tick.steps }, { ...usageFor(opened, tenantId), pipelineRuns: tick.runs });
    if (tick.escalations.length > 0) {
      const failed = new Set(tick.escalations.map((row) => row.groupId));
      next = {
        ...next,
        packageRuns: runsOf(next).map((run) => failed.has(run.id) && run.tenantId === tenantId ? { ...run, status: "needs_human" as const } : run),
      };
    }
    next = withPipelineCapNotice(next, tenantId, now, tick.blocked, `${spec.noticePrefix}_${now}`);
  }
  return { state: next, advanced: tick.advanced };
}

export function setPackageWorkspaceKill(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  spec: Pick<PackageRunSpec, "packageId" | "killField" | "killMessage">,
  options: PackageFlag = {},
): FulfillmentState {
  if (!packagePipelineEnabled(options.enabled)) return state;
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace[spec.killField] === on) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((row) => row.id === tenantId ? { ...row, [spec.killField]: on } : row),
    packageRunSteps: on
      ? stampWorkspaceKill(runStepsOf(state), tenantId, now, spec.killMessage, (step) => step.packageId === spec.packageId)
      : runStepsOf(state),
  };
}

export function defaultRunIds(prefix: string): IdFactory {
  return defaultIds(prefix);
}
