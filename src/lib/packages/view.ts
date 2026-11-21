import { formatMonthly, formatSetup, formatUsd, getPackage } from "./catalog.ts";
import { getTestPlan } from "./plans.ts";
import { listConnections } from "./connections.ts";
import { onboardingStep, workspaceFor } from "./tenancy.ts";
import type { DeliverableStatus, EnrollmentStatus, FulfillmentState, LeadStatus, PaymentRecord, StepStatus } from "./types.ts";

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
  lastError: string | null;
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
      lastError: step.status === "failed" || step.status === "needs_human" ? step.output || null : null,
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
  leadFollowUpKillSwitch: boolean;
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
    leadFollowUpKillSwitch: workspace.leadFollowUpKillSwitch === true,
    clientLimit: getTestPlan(workspace.planId).clientLimit,
    connections: listConnections(state, tenantId).map((row) => ({ kind: row.kind, label: row.label, status: row.status })),
  };
}

export type LeadStepView = {
  id: string;
  title: string;
  status: StepStatus;
  statusLabel: string;
  attempts: number;
  lastError: string | null;
  nextRunAt: string | null;
  output: string;
  draftedMessage: string | null;
  logs: { at: string; message: string }[];
};

export type LeadView = {
  id: string;
  contactName: string;
  contactEmail: string;
  status: LeadStatus;
  repliedAt: string | null;
  capturedAt: string;
  steps: LeadStepView[];
};

/** Leads on one Lead Follow-Up enrollment. Null when that enrollment is not in this workspace. */
export function leadFollowUpView(state: FulfillmentState, tenantId: string, enrollmentId: string): LeadView[] | null {
  const enrollment = state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId);
  if (!enrollment || enrollment.packageId !== "lead-follow-up") return null;
  const owned = state.clients.some((row) => row.id === enrollment.clientId && row.tenantId === tenantId);
  if (!owned) return null;
  return (state.leads || [])
    .filter((lead) => lead.tenantId === tenantId && lead.enrollmentId === enrollment.id)
    .map((lead) => ({
      id: lead.id,
      contactName: lead.contactName,
      contactEmail: lead.contactEmail,
      status: lead.status,
      repliedAt: lead.repliedAt,
      capturedAt: lead.capturedAt,
      steps: (state.leadSteps || [])
        .filter((step) => step.tenantId === tenantId && step.leadId === lead.id)
        .map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          statusLabel: STEP_STATUS_LABEL[step.status],
          attempts: step.attempts,
          lastError: step.lastError,
          nextRunAt: step.nextRunAt,
          output: step.output,
          draftedMessage: step.draftedMessage,
          logs: step.logs,
        })),
    }));
}

/** Plain-text client → package → step list for one workspace. */
export function formatFulfillmentStepReport(state: FulfillmentState, tenantId: string): string {
  const summary = workspaceSummary(state, tenantId);
  const lines: string[] = [];
  lines.push(`${summary?.name || "Workspace"} · lead follow-up kill switch ${summary?.leadFollowUpKillSwitch ? "on" : "off"}`);
  for (const client of clientList(state, tenantId)) {
    lines.push(`Client: ${client.name}`);
    for (const pkg of client.packages) {
      lines.push(`  Package: ${pkg.name} (${pkg.status})`);
      const pipeline = pipelineView(state, tenantId, pkg.enrollmentId);
      for (const step of pipeline?.steps || []) {
        lines.push(`    ${step.title} · ${step.statusLabel} · attempts ${step.attempts} · last error ${step.lastError || "—"} · next ${step.nextRunAt || "—"}`);
      }
      const leads = leadFollowUpView(state, tenantId, pkg.enrollmentId);
      for (const lead of leads || []) {
        lines.push(`    Lead: ${lead.contactName} · ${lead.status}`);
        for (const step of lead.steps) {
          lines.push(`      ${step.title} · ${step.statusLabel} · attempts ${step.attempts} · last error ${step.lastError || "—"} · next ${step.nextRunAt || "—"}`);
        }
      }
    }
  }
  return lines.join("\n");
}

export { formatSetup };
