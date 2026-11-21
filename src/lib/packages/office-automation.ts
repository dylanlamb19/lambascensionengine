import {
  packagePipelineEnabled,
  stopLaterCadenceSteps,
} from "./cadence.ts";
import {
  clientLabel,
  enrollmentFor,
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
import type { FulfillmentState, OfficeWorkflow, OfficeWorkflowKind, PackageRunStep } from "./types.ts";

const QUIET = "Nothing was sent. Nothing was charged. No office system was changed.";
const STOP = `Stopped because an earlier step failed. Needs a person. ${QUIET}`;

export const OFFICE_STEPS = [
  { id: "intake", title: "Workflow intake", delayDays: 0, delayMonths: 0 },
  { id: "schedule", title: "Scheduling task", delayDays: 0, delayMonths: 0 },
  { id: "reminder", title: "Reminder task", delayDays: 0, delayMonths: 0 },
  { id: "invoice-reminder", title: "Invoice reminder", delayDays: 0, delayMonths: 0 },
] as const;

const ORDER = OFFICE_STEPS.map((step) => step.id);

const KINDS: readonly OfficeWorkflowKind[] = ["document-collection", "sold-job-handoff", "invoice-reminders"];

const KIND_LABEL: Record<OfficeWorkflowKind, string> = {
  "document-collection": "document collection",
  "sold-job-handoff": "handing a sold job to the office",
  "invoice-reminders": "invoice reminders",
};

function workflowsOf(state: FulfillmentState): OfficeWorkflow[] {
  return state.officeWorkflows || [];
}

function workflowFor(state: FulfillmentState, tenantId: string, enrollmentId: string): OfficeWorkflow | null {
  return workflowsOf(state).find((row) => row.tenantId === tenantId && row.enrollmentId === enrollmentId) || null;
}

function kindLabel(kind: OfficeWorkflowKind | ""): string {
  if (!kind) return "not agreed";
  return KIND_LABEL[kind];
}

export function isOfficeWorkflowKind(value: string): value is OfficeWorkflowKind {
  return (KINDS as readonly string[]).includes(value);
}

function officeOutcome(state: FulfillmentState, step: PackageRunStep) {
  const client = clientLabel(state, step.tenantId, step.clientId) || "this client";
  const workspace = workspaceLabel(state, step.tenantId);
  const workflow = workflowFor(state, step.tenantId, step.enrollmentId);
  const named = Boolean(workflow && workflow.kind && !workflow.ambiguous);
  if (!workflow || !workflow.kind) {
    const output = `The one workflow for ${client} is not agreed. Needs a person. ${QUIET}`;
    return {
      outcome: { status: "needs_human" as const, output, lastError: output, log: output },
      patch: { draft: null },
    };
  }
  if (workflow.ambiguous) {
    const output = `The workflow for ${client} is ambiguous. Needs a person. ${QUIET}`;
    return {
      outcome: { status: "needs_human" as const, output, lastError: output, log: output },
      patch: { draft: workflow.scheduleNote || null },
    };
  }
  if (step.stepId === "intake") {
    const draft = `Intake for ${client} in ${workspace}: one workflow, ${kindLabel(workflow.kind)}. Taken from this workspace's stored agreement. ${QUIET}`;
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Workflow intake recorded. ${QUIET}` },
      patch: { draft },
    };
  }
  if (!named) {
    const output = `Needs a person. ${QUIET}`;
    return {
      outcome: { status: "needs_human" as const, output, lastError: output, log: output },
      patch: { draft: null },
    };
  }
  if (step.stepId === "schedule") {
    const when = workflow.scheduleNote.trim() || "Next business morning.";
    const draft = `Scheduling task for ${client}: ${kindLabel(workflow.kind)}. ${when} Nothing was booked. ${QUIET}`;
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Schedule drafted. Nothing was booked. ${QUIET}` },
      patch: { draft },
    };
  }
  if (step.stepId === "reminder") {
    const draft = `Reminder task for ${client}: ${kindLabel(workflow.kind)}. The note stays in this log. Nothing was sent. ${QUIET}`;
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Reminder drafted. Nothing was sent. ${QUIET}` },
      patch: { draft },
    };
  }
  const invoices = (state.invoices || []).filter((row) => row.tenantId === step.tenantId);
  if (invoices.some((row) => row.amountCents !== 0 || row.billingMode !== "test")) {
    const output = `A non-zero invoice is on file for ${workspace}. This reminder does not charge. ${QUIET}`;
    return {
      outcome: { status: "needs_human" as const, output, lastError: output, log: output },
      patch: { draft: output },
    };
  }
  const open = invoices.filter((row) => row.status === "open" && row.amountCents === 0 && row.billingMode === "test");
  const draft = open.length === 0
    ? `Invoice reminder for ${client}. No open test invoice in ${workspace}. fakeBilling only. Amount $0. Nothing was charged. ${QUIET}`
    : `Invoice reminder for ${client}. fakeBilling test invoice ${open.map((row) => row.id).join(", ")} is open. Amount $0. Nothing was charged. ${QUIET}`;
  return {
    outcome: { status: "done" as const, output: draft, lastError: null, log: `Invoice reminder drafted from fakeBilling. Nothing was charged. ${QUIET}` },
    patch: { draft },
  };
}

const SPEC: PackageRunSpec = {
  packageId: "office-automation",
  steps: OFFICE_STEPS,
  killField: "officeAutomationKillSwitch",
  quietLine: QUIET,
  stopReason: STOP,
  killMessage: `Workspace kill switch is on. Office Automation drafts are stopped. ${QUIET} Sales outreach was not changed.`,
  noticePrefix: "office_automation_run",
  outcome: officeOutcome,
};

export function tickOfficeAutomation(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: PackageFlag & { ids?: IdFactory; runStep?: (step: PackageRunStep) => void } = {},
): { state: FulfillmentState; advanced: number } {
  const before = runStepsOf(state);
  const tick = tickPackageRun(state, tenantId, now, SPEC, opts);
  if (tick.advanced === 0 && tick.state === state) return tick;
  const blocked = runStepsOf(tick.state).filter((step) => {
    if (step.tenantId !== tenantId || step.packageId !== "office-automation" || step.status !== "needs_human") return false;
    const error = step.lastError || "";
    const holds = error.includes("is not agreed") || error.includes("is ambiguous");
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

export function setOfficeAutomationKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: PackageFlag = {},
) {
  return setPackageWorkspaceKill(state, tenantId, on, now, SPEC, options);
}

function ownsOffice(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "office-automation" && !enrollment.includedPackageIds.includes("office-automation")) return null;
  return enrollment;
}

export type OfficeWorkflowInput = {
  enrollmentId: string;
  kind?: string;
  ambiguous?: boolean;
  scheduleNote?: string;
  apiKey?: unknown;
};

export type OfficeWorkflowResult =
  | { ok: true; state: FulfillmentState }
  | { ok: false; state: FulfillmentState; reason: string };

/** Record the one agreed workflow. This does not send, book, or charge. */
export function saveOfficeWorkflow(
  state: FulfillmentState,
  tenantId: string,
  input: OfficeWorkflowInput,
  now: string,
  options: PackageFlag = {},
): OfficeWorkflowResult {
  if (input.apiKey !== undefined) {
    return { ok: false, state, reason: `Office credentials are not stored. ${QUIET}` };
  }
  if (!packagePipelineEnabled(options.enabled)) return { ok: false, state, reason: "Package fulfillment is off." };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") return { ok: false, state, reason: "Open this marketer's workspace first." };
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. Nothing was stored and no charge was attempted." };
  }
  if (workspace.officeAutomationKillSwitch) {
    return { ok: false, state, reason: `Office Automation drafts are stopped for this workspace. ${QUIET}` };
  }
  const enrollment = ownsOffice(state, tenantId, input.enrollmentId);
  if (!enrollment || enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This Office Automation package is not running. Nothing was changed." };
  }
  const existing = workflowFor(state, tenantId, enrollment.id);
  const kindText = (input.kind || existing?.kind || "").trim();
  if (kindText && !isOfficeWorkflowKind(kindText)) {
    return { ok: false, state, reason: "That workflow is not one of the agreed kinds. Nothing was stored." };
  }
  const kind: OfficeWorkflow["kind"] = isOfficeWorkflowKind(kindText) ? kindText : "";
  const workflow: OfficeWorkflow = {
    tenantId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
    kind,
    ambiguous: input.ambiguous === true,
    scheduleNote: (input.scheduleNote || "").trim().replace(/\s+/g, " "),
    updatedAt: now,
  };
  const blocked = !workflow.kind || workflow.ambiguous;
  const reason = !workflow.kind
    ? `The one workflow is not agreed. Needs a person. ${QUIET}`
    : workflow.ambiguous
      ? `The workflow is ambiguous. Needs a person. ${QUIET}`
      : `Workflow stored: ${kindLabel(workflow.kind)}. ${QUIET}`;
  const steps = runStepsOf(state).map((step) => {
    if (step.tenantId !== tenantId || step.enrollmentId !== enrollment.id || step.stepId !== "intake") return step;
    if ((step.lastError || "").includes("Failed after retries")) return step;
    if (blocked) {
      return {
        ...step,
        status: "needs_human" as const,
        lastError: reason,
        output: reason,
        draft: workflow.scheduleNote || null,
        finishedAt: step.finishedAt || now,
        nextRunAt: null,
        logs: [...step.logs, { at: now, message: reason }].slice(-30),
      };
    }
    if (step.status === "needs_human") {
      return {
        ...step,
        status: "pending" as const,
        lastError: null,
        output: "",
        draft: null,
        finishedAt: null,
        nextRunAt: now,
        logs: [...step.logs, { at: now, message: reason }].slice(-30),
      };
    }
    return {
      ...step,
      logs: [...step.logs, { at: now, message: reason }].slice(-30),
    };
  });
  return {
    ok: true,
    state: {
      ...state,
      officeWorkflows: [...workflowsOf(state).filter((row) => !(row.tenantId === tenantId && row.enrollmentId === enrollment.id)), workflow],
      packageRunSteps: steps,
    },
  };
}
