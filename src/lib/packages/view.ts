import { formatStepReportLine } from "./cadence.ts";
import { formatMonthly, formatSetup, formatUsd, getPackage } from "./catalog.ts";
import { getTestPlan } from "./plans.ts";
import { listConnections } from "./connections.ts";
import { intakeFor } from "./package-runs.ts";
import { onboardingStep, workspaceFor } from "./tenancy.ts";
import type { DeliverableStatus, EnrollmentStatus, FulfillmentState, LeadStatus, PackageRunId, PaymentRecord, StepStatus } from "./types.ts";

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
  leadGenerationKillSwitch: boolean;
  aiVisibilityKillSwitch: boolean;
  reviewsKillSwitch: boolean;
  appointmentRemindersKillSwitch: boolean;
  estimateFollowUpsKillSwitch: boolean;
  googleAdsKillSwitch: boolean;
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
    leadGenerationKillSwitch: workspace.leadGenerationKillSwitch === true,
    aiVisibilityKillSwitch: workspace.aiVisibilityKillSwitch === true,
    reviewsKillSwitch: workspace.reviewsKillSwitch === true,
    appointmentRemindersKillSwitch: workspace.appointmentRemindersKillSwitch === true,
    estimateFollowUpsKillSwitch: workspace.estimateFollowUpsKillSwitch === true,
    googleAdsKillSwitch: workspace.googleAdsKillSwitch === true,
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

export type PackageRunStepView = {
  id: string;
  title: string;
  status: StepStatus;
  statusLabel: string;
  attempts: number;
  lastError: string | null;
  nextRunAt: string | null;
  output: string;
  draft: string | null;
  logs: { at: string; message: string }[];
};

export type GeneratedLeadView = {
  id: string;
  contactName: string;
  contactEmail: string;
  capturedAt: string;
  followUpLeadId: string | null;
  handoffNote: string;
};

export type PackageRunView = {
  runId: string;
  packageId: PackageRunId;
  packageName: string;
  status: string;
  steps: PackageRunStepView[];
  leads: GeneratedLeadView[];
  metrics: { id: string; periodLabel: string; line: string }[];
  changeNote: { summary: string; ambiguous: boolean; status: string } | null;
  intake: {
    businessName: string;
    phone: string;
    address: string;
    website: string;
    offer: string;
    serviceArea: string;
  } | null;
};

/** Lead Generation and AI Visibility runs on one enrollment. Null when that enrollment is not in this workspace. */
export function packageRunViews(state: FulfillmentState, tenantId: string, enrollmentId: string): PackageRunView[] | null {
  const enrollment = state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId);
  if (!enrollment) return null;
  const owned = state.clients.some((row) => row.id === enrollment.clientId && row.tenantId === tenantId);
  if (!owned) return null;
  const runs = (state.packageRuns || []).filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id);
  if (runs.length === 0) return [];
  const intake = intakeFor(state, tenantId, enrollment.clientId);
  return runs.map((run) => ({
    runId: run.id,
    packageId: run.packageId,
    packageName: getPackage(run.packageId).name,
    status: run.status,
    intake: intake
      ? {
          businessName: intake.businessName,
          phone: intake.phone,
          address: intake.address,
          website: intake.website,
          offer: intake.offer,
          serviceArea: intake.serviceArea,
        }
      : null,
    leads: run.packageId === "lead-generation"
      ? (state.generatedLeads || [])
          .filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id)
          .map((row) => ({
            id: row.id,
            contactName: row.contactName,
            contactEmail: row.contactEmail,
            capturedAt: row.capturedAt,
            followUpLeadId: row.followUpLeadId,
            handoffNote: row.handoffNote,
          }))
      : [],
    metrics: run.packageId === "google-ads"
      ? (state.adsMetrics || [])
          .filter((row) => row.tenantId === tenantId && row.clientId === enrollment.clientId && row.source === "stored")
          .map((row) => ({
            id: row.id,
            periodLabel: row.periodLabel,
            line: `Impressions ${row.impressions ?? "UNKNOWN"} · clicks ${row.clicks ?? "UNKNOWN"} · conversions ${row.conversions ?? "UNKNOWN"} · spend ${row.spendCents == null ? "UNKNOWN" : row.spendCents}`,
          }))
      : [],
    changeNote: run.packageId === "google-ads"
      ? (() => {
          const note = (state.adsChangeNotes || []).find((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id);
          return note ? { summary: note.summary, ambiguous: note.ambiguous, status: note.status } : null;
        })()
      : null,
    steps: (state.packageRunSteps || [])
      .filter((step) => step.tenantId === tenantId && step.runId === run.id)
      .map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
        statusLabel: STEP_STATUS_LABEL[step.status],
        attempts: step.attempts,
        lastError: step.lastError,
        nextRunAt: step.nextRunAt,
        output: step.output,
        draft: step.draft,
        logs: step.logs,
      })),
  }));
}

export type ReviewJobView = {
  jobId: string;
  customerName: string;
  jobLabel: string;
  completedAt: string;
  step: PackageRunStepView & { draftedMessage: string | null };
};

export type ReviewsView = {
  jobs: ReviewJobView[];
  storedReviews: { id: string; reviewerName: string; body: string }[];
};

/** Completed jobs and review requests on one Reviews package. Null when that enrollment is not in this workspace. */
export function reviewsView(state: FulfillmentState, tenantId: string, enrollmentId: string): ReviewsView | null {
  const enrollment = state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId);
  if (!enrollment || enrollment.packageId !== "reviews-gbp") return null;
  const owned = state.clients.some((row) => row.id === enrollment.clientId && row.tenantId === tenantId);
  if (!owned) return null;
  const jobs = (state.completedJobs || []).filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id && row.status === "completed");
  return {
    storedReviews: (state.storedReviews || [])
      .filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id)
      .map((row) => ({ id: row.id, reviewerName: row.reviewerName, body: row.body })),
    jobs: jobs.map((job) => {
      const step = (state.reviewRequestSteps || []).find((row) => row.tenantId === tenantId && row.jobId === job.id);
      return {
        jobId: job.id,
        customerName: job.customerName,
        jobLabel: job.jobLabel,
        completedAt: job.completedAt,
        step: {
          id: step?.id || job.id,
          title: step?.title || "Review request",
          status: step?.status || "pending",
          statusLabel: STEP_STATUS_LABEL[step?.status || "pending"],
          attempts: step?.attempts || 0,
          lastError: step?.lastError || null,
          nextRunAt: step?.nextRunAt || null,
          output: step?.output || "",
          draft: step?.draftedMessage || null,
          draftedMessage: step?.draftedMessage || null,
          logs: step?.logs || [],
        },
      };
    }),
  };
}

export type AppointmentItemView = {
  id: string;
  customerName: string;
  startsAt: string;
  response: string;
  outcome: string;
  status: string;
  lastNote: string;
  steps: PackageRunStepView[];
};

export type EstimateItemView = {
  id: string;
  customerName: string;
  label: string;
  openedAt: string;
  outcome: string;
  status: string;
  lastNote: string;
  steps: PackageRunStepView[];
};

/** Open estimates on one Estimate Follow-Ups package. Null when that enrollment is not in this workspace. */
export function estimateViews(state: FulfillmentState, tenantId: string, enrollmentId: string): EstimateItemView[] | null {
  const enrollment = state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId);
  if (!enrollment || enrollment.packageId !== "estimate-follow-ups") return null;
  const owned = state.clients.some((row) => row.id === enrollment.clientId && row.tenantId === tenantId);
  if (!owned) return null;
  return (state.estimates || [])
    .filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id)
    .map((estimate) => ({
      id: estimate.id,
      customerName: estimate.customerName,
      label: estimate.label,
      openedAt: estimate.openedAt,
      outcome: estimate.outcome,
      status: estimate.status,
      lastNote: estimate.lastNote,
      steps: (state.estimateSteps || [])
        .filter((step) => step.tenantId === tenantId && step.estimateId === estimate.id)
        .map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          statusLabel: STEP_STATUS_LABEL[step.status],
          attempts: step.attempts,
          lastError: step.lastError,
          nextRunAt: step.nextRunAt,
          output: step.output,
          draft: step.draftedMessage,
          logs: step.logs,
        })),
    }));
}

/** Appointments on one Appointment Reminders package. Null when that enrollment is not in this workspace. */
export function appointmentViews(state: FulfillmentState, tenantId: string, enrollmentId: string): AppointmentItemView[] | null {
  const enrollment = state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId);
  if (!enrollment || enrollment.packageId !== "appointment-reminders") return null;
  const owned = state.clients.some((row) => row.id === enrollment.clientId && row.tenantId === tenantId);
  if (!owned) return null;
  return (state.appointments || [])
    .filter((row) => row.tenantId === tenantId && row.enrollmentId === enrollment.id && row.calendar === "booking_calendar")
    .map((appointment) => ({
      id: appointment.id,
      customerName: appointment.customerName,
      startsAt: appointment.startsAt,
      response: appointment.response,
      outcome: appointment.outcome,
      status: appointment.status,
      lastNote: appointment.lastNote,
      steps: (state.appointmentSteps || [])
        .filter((step) => step.tenantId === tenantId && step.appointmentId === appointment.id)
        .map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          statusLabel: STEP_STATUS_LABEL[step.status],
          attempts: step.attempts,
          lastError: step.lastError,
          nextRunAt: step.nextRunAt,
          output: step.output,
          draft: step.draftedMessage,
          logs: step.logs,
        })),
    }));
}

/** Plain-text client → package → step list for one workspace. */
export function formatFulfillmentStepReport(state: FulfillmentState, tenantId: string): string {
  const summary = workspaceSummary(state, tenantId);
  const lines: string[] = [];
  lines.push(`${summary?.name || "Workspace"} · lead follow-up kill switch ${summary?.leadFollowUpKillSwitch ? "on" : "off"} · lead generation kill switch ${summary?.leadGenerationKillSwitch ? "on" : "off"} · ai visibility kill switch ${summary?.aiVisibilityKillSwitch ? "on" : "off"} · reviews kill switch ${summary?.reviewsKillSwitch ? "on" : "off"} · appointment reminders kill switch ${summary?.appointmentRemindersKillSwitch ? "on" : "off"} · estimate follow-ups kill switch ${summary?.estimateFollowUpsKillSwitch ? "on" : "off"} · google ads kill switch ${summary?.googleAdsKillSwitch ? "on" : "off"}`);
  for (const client of clientList(state, tenantId)) {
    lines.push(`Client: ${client.name}`);
    for (const pkg of client.packages) {
      lines.push(`  Package: ${pkg.name} (${pkg.status})`);
      const pipeline = pipelineView(state, tenantId, pkg.enrollmentId);
      for (const step of pipeline?.steps || []) {
        lines.push(formatStepReportLine("    ", step.title, step.statusLabel, step.attempts, step.lastError, step.nextRunAt));
      }
      const leads = leadFollowUpView(state, tenantId, pkg.enrollmentId);
      for (const lead of leads || []) {
        lines.push(`    Lead: ${lead.contactName} · ${lead.status}`);
        for (const step of lead.steps) {
          lines.push(formatStepReportLine("      ", step.title, step.statusLabel, step.attempts, step.lastError, step.nextRunAt));
        }
      }
      for (const run of packageRunViews(state, tenantId, pkg.enrollmentId) || []) {
        lines.push(`    ${run.packageName} run · ${run.status}`);
        for (const step of run.steps) {
          lines.push(formatStepReportLine("      ", step.title, step.statusLabel, step.attempts, step.lastError, step.nextRunAt));
        }
        for (const lead of run.leads) {
          lines.push(`      Captured lead: ${lead.contactName} · ${lead.handoffNote}`);
        }
      }
      const reviews = reviewsView(state, tenantId, pkg.enrollmentId);
      for (const job of reviews?.jobs || []) {
        lines.push(`    Completed job: ${job.customerName} · ${job.jobLabel}`);
        lines.push(formatStepReportLine("      ", job.step.title, job.step.statusLabel, job.step.attempts, job.step.lastError, job.step.nextRunAt));
      }
      for (const estimate of estimateViews(state, tenantId, pkg.enrollmentId) || []) {
        lines.push(`    Estimate: ${estimate.customerName} · ${estimate.label} · ${estimate.outcome}`);
        for (const step of estimate.steps) {
          lines.push(formatStepReportLine("      ", step.title, step.statusLabel, step.attempts, step.lastError, step.nextRunAt));
        }
      }
      for (const appointment of appointmentViews(state, tenantId, pkg.enrollmentId) || []) {
        lines.push(`    Appointment: ${appointment.customerName} · ${appointment.startsAt} · ${appointment.status}`);
        for (const step of appointment.steps) {
          lines.push(formatStepReportLine("      ", step.title, step.statusLabel, step.attempts, step.lastError, step.nextRunAt));
        }
      }
    }
  }
  return lines.join("\n");
}

export { formatSetup };
