import { formatMonthly, formatSetup, formatUsd, getPackage } from "./catalog.ts";
import { getTestPlan } from "./plans.ts";
import { listConnections } from "./connections.ts";
import { onboardingStep, workspaceFor } from "./tenancy.ts";
import type { DeliverableStatus, EnrollmentStatus, FulfillmentState, PaymentRecord, StepStatus } from "./types.ts";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "pending",
  running: "running",
  done: "done",
  failed: "failed",
  needs_human: "needs human",
};

export function deliverableStatus(status: StepStatus): DeliverableStatus {
  if (status === "pending") return "not_started";
  if (status === "running") return "in_progress";
  if (status === "done") return "fulfilled";
  return "blocked";
}

export type ClientListRow = {
  id: string;
  name: string;
  packages: { enrollmentId: string; name: string; status: EnrollmentStatus }[];
};

export function clientList(state: FulfillmentState, tenantId: string): ClientListRow[] {
  return state.clients
    .filter((row) => row.tenantId === tenantId)
    .map((client) => ({
      id: client.id,
      name: client.name,
      packages: state.enrollments
        .filter((row) => row.tenantId === tenantId && row.clientId === client.id)
        .map((row) => ({ enrollmentId: row.id, name: getPackage(row.packageId).name, status: row.status })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PackageTab = {
  enrollmentId: string;
  name: string;
  status: EnrollmentStatus;
};

export function packageTabs(state: FulfillmentState, tenantId: string, clientId: string): PackageTab[] {
  const owned = state.clients.some((row) => row.id === clientId && row.tenantId === tenantId);
  if (!owned) return [];
  return state.enrollments
    .filter((row) => row.tenantId === tenantId && row.clientId === clientId)
    .map((row) => ({ enrollmentId: row.id, name: getPackage(row.packageId).name, status: row.status }));
}

export type StepView = {
  id: string;
  title: string;
  group: string;
  status: StepStatus;
  statusLabel: string;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  logs: { at: string; message: string }[];
};

export type PipelineView = {
  enrollmentId: string;
  clientName: string;
  packageName: string;
  status: EnrollmentStatus;
  killSwitch: boolean;
  setupFeeLabel: string;
  monthlyLabel: string;
  setupPayment: PaymentRecord;
  monthlyPayment: PaymentRecord;
  startedOn: string;
  renewsOn: string;
  nextRunAt: string | null;
  steps: StepView[];
  deliverables: { id: string; title: string; status: DeliverableStatus }[];
};

export function pipelineView(state: FulfillmentState, tenantId: string, enrollmentId: string): PipelineView | null {
  const enrollment = state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId);
  if (!enrollment) return null;
  const client = state.clients.find((row) => row.id === enrollment.clientId && row.tenantId === tenantId);
  if (!client) return null;
  const pkg = getPackage(enrollment.packageId);
  const steps = state.steps.filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id);
  const nextTimes = steps.map((step) => step.nextRunAt).filter((value): value is string => Boolean(value)).sort();
  return {
    enrollmentId: enrollment.id,
    clientName: client.name,
    packageName: pkg.name,
    status: enrollment.status,
    killSwitch: enrollment.killSwitch,
    setupFeeLabel: enrollment.setupFeeCents === 0 ? "No setup fee" : formatUsd(enrollment.setupFeeCents),
    monthlyLabel: formatMonthly({ ...pkg, monthlyCents: enrollment.monthlyCents, pricingKind: enrollment.pricingKind }),
    setupPayment: enrollment.setupPayment,
    monthlyPayment: enrollment.monthlyPayment,
    startedOn: enrollment.startedOn,
    renewsOn: enrollment.renewsOn,
    nextRunAt: nextTimes[0] || null,
    steps: steps.map((step) => ({
      id: step.id,
      title: step.title,
      group: step.group,
      status: step.status,
      statusLabel: STEP_STATUS_LABEL[step.status],
      attempts: step.attempts,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      nextRunAt: step.nextRunAt,
      output: step.output,
      logs: step.logs,
    })),
    deliverables: steps.map((step) => ({
      id: step.stepId,
      title: step.title,
      status: deliverableStatus(step.status),
    })),
  };
}

export function workspaceSummary(state: FulfillmentState, tenantId: string): {
  name: string;
  planName: string;
  planStatus: string;
  billingMode: "test";
  onboarding: string;
  clientLimit: number | null;
  connections: { kind: string; label: string; status: "missing" | "stub_connected" }[];
} | null {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return null;
  return {
    name: workspace.name,
    planName: getTestPlan(workspace.planId).name,
    planStatus: workspace.planStatus,
    billingMode: "test",
    onboarding: onboardingStep(workspace),
    clientLimit: getTestPlan(workspace.planId).clientLimit,
    connections: listConnections(state, tenantId).map((row) => ({ kind: row.kind, label: row.label, status: row.status })),
  };
}

export { formatSetup };
