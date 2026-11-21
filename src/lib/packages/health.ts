import { PACKAGE_IDS, type PackageId } from "./catalog.ts";
import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState, StepStatus, Workspace } from "./types.ts";

export type SentinelPipelineHealth = "disabled" | "idle" | "healthy" | "degraded" | "stopped";

export type SentinelPackageReport = {
  source: "package-fulfillment";
  tenantId: string;
  enabled: boolean;
  generatedAt: string;
  pipelines: Array<{
    enrollmentId: string;
    clientId: string;
    packageId: PackageId;
    health: SentinelPipelineHealth;
    killSwitch: boolean;
    status: string;
    needsHuman: number;
    failed: number;
    lastFinishedAt: string | null;
    nextRunAt: string | null;
  }>;
  /** Counts per pipeline for this workspace. Calling this does not start or stop anything. */
  summary: SentinelPipelineCounts[];
};

export type SentinelPipelineCounts = {
  packageId: PackageId;
  running: number;
  failed: number;
  needsHuman: number;
  killed: number;
};

function emptyCounts(): Map<PackageId, SentinelPipelineCounts> {
  const map = new Map<PackageId, SentinelPipelineCounts>();
  for (const packageId of PACKAGE_IDS) {
    map.set(packageId, { packageId, running: 0, failed: 0, needsHuman: 0, killed: 0 });
  }
  return map;
}

function tally(map: Map<PackageId, SentinelPipelineCounts>, packageId: string, status: StepStatus) {
  const row = map.get(packageId as PackageId);
  if (!row) return;
  if (status === "running") row.running += 1;
  else if (status === "failed") row.failed += 1;
  else if (status === "needs_human") row.needsHuman += 1;
}

function workspaceKilled(workspace: Workspace, packageId: PackageId): boolean {
  if (packageId === "lead-follow-up") return workspace.leadFollowUpKillSwitch === true;
  if (packageId === "lead-generation") return workspace.leadGenerationKillSwitch === true;
  if (packageId === "ai-visibility") return workspace.aiVisibilityKillSwitch === true;
  if (packageId === "reviews-gbp") return workspace.reviewsKillSwitch === true;
  if (packageId === "appointment-reminders") return workspace.appointmentRemindersKillSwitch === true;
  if (packageId === "estimate-follow-ups") return workspace.estimateFollowUpsKillSwitch === true;
  if (packageId === "google-ads") return workspace.googleAdsKillSwitch === true;
  if (packageId === "meta-ads") return workspace.metaAdsKillSwitch === true;
  if (packageId === "office-automation") return workspace.officeAutomationKillSwitch === true;
  return false;
}

/**
 * Counts of running, failed, needs-human, and killed work per pipeline.
 * Scoped to one workspace. Does not start pipelines and does not disable Sentinel.
 */
export function fulfillmentHealthSummary(state: FulfillmentState, tenantId: string): SentinelPipelineCounts[] {
  const map = emptyCounts();
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return PACKAGE_IDS.map((id) => map.get(id)!);
  const enrollments = state.enrollments.filter((row) => row.tenantId === tenantId);
  for (const step of state.steps) {
    if (step.tenantId === tenantId) tally(map, step.sourcePackageId, step.status);
  }
  for (const step of state.packageRunSteps || []) {
    if (step.tenantId === tenantId) tally(map, step.packageId, step.status);
  }
  for (const step of state.leadSteps || []) {
    if (step.tenantId === tenantId) tally(map, "lead-follow-up", step.status);
  }
  for (const step of state.reviewRequestSteps || []) {
    if (step.tenantId === tenantId) tally(map, "reviews-gbp", step.status);
  }
  for (const step of state.appointmentSteps || []) {
    if (step.tenantId === tenantId) tally(map, "appointment-reminders", step.status);
  }
  for (const step of state.estimateSteps || []) {
    if (step.tenantId === tenantId) tally(map, "estimate-follow-ups", step.status);
  }
  const separate = (clientId: string, packageId: PackageId, exceptId: string) => enrollments.some((row) =>
    row.clientId === clientId && row.id !== exceptId && row.packageId === packageId && row.status !== "cancelled",
  );
  for (const enrollment of enrollments) {
    if (enrollment.status === "cancelled") continue;
    if (enrollment.packageId === "google-meta-ai") {
      if (enrollment.killSwitch) {
        const bundle = map.get("google-meta-ai");
        if (bundle) bundle.killed += 1;
      }
      for (const part of enrollment.includedPackageIds) {
        if (separate(enrollment.clientId, part, enrollment.id)) continue;
        if (enrollment.killSwitch || workspaceKilled(workspace, part)) {
          const row = map.get(part);
          if (row) row.killed += 1;
        }
      }
      continue;
    }
    if (enrollment.killSwitch || workspaceKilled(workspace, enrollment.packageId)) {
      const row = map.get(enrollment.packageId);
      if (row) row.killed += 1;
    }
  }
  return PACKAGE_IDS.map((id) => map.get(id)!);
}

function nextStamp(steps: { nextRunAt: string | null }[]): string | null {
  const due = steps.map((step) => step.nextRunAt).filter((value): value is string => Boolean(value));
  due.sort();
  return due[0] || null;
}

/**
 * Health snapshot for one marketer workspace.
 * Sentinel is not in this recovery branch. This is the report it should read.
 * Calling it does not start pipelines and does not disable anything.
 */
export function sentinelPackageHealth(
  state: FulfillmentState,
  tenantId: string,
  enabled: boolean,
  now: string,
): SentinelPackageReport {
  const workspace = workspaceFor(state, tenantId);
  const enrollments = workspace ? state.enrollments.filter((row) => row.tenantId === tenantId) : [];
  return {
    source: "package-fulfillment",
    tenantId,
    enabled: enabled === true,
    generatedAt: now,
    pipelines: enrollments.map((enrollment) => {
      const steps = state.steps.filter((step) => step.tenantId === tenantId && step.enrollmentId === enrollment.id);
      const leadSteps = (state.leadSteps || []).filter((step) => step.tenantId === tenantId && step.enrollmentId === enrollment.id);
      const packageSteps = (state.packageRunSteps || []).filter((step) => step.tenantId === tenantId && step.enrollmentId === enrollment.id);
      const reviewSteps = (state.reviewRequestSteps || []).filter((step) => step.tenantId === tenantId && step.enrollmentId === enrollment.id);
      const appointmentSteps = (state.appointmentSteps || []).filter((step) => step.tenantId === tenantId && step.enrollmentId === enrollment.id);
      const estimateSteps = (state.estimateSteps || []).filter((step) => step.tenantId === tenantId && step.enrollmentId === enrollment.id);
      const needsHuman = steps.filter((step) => step.status === "needs_human").length
        + leadSteps.filter((step) => step.status === "needs_human").length
        + packageSteps.filter((step) => step.status === "needs_human").length
        + reviewSteps.filter((step) => step.status === "needs_human").length
        + appointmentSteps.filter((step) => step.status === "needs_human").length
        + estimateSteps.filter((step) => step.status === "needs_human").length;
      const failed = steps.filter((step) => step.status === "failed").length
        + leadSteps.filter((step) => step.status === "failed").length
        + packageSteps.filter((step) => step.status === "failed").length
        + reviewSteps.filter((step) => step.status === "failed").length
        + appointmentSteps.filter((step) => step.status === "failed").length
        + estimateSteps.filter((step) => step.status === "failed").length;
      const watched = [...steps, ...leadSteps, ...packageSteps, ...reviewSteps, ...appointmentSteps, ...estimateSteps];
      const finished = watched.map((step) => step.finishedAt).filter((value): value is string => Boolean(value)).sort();
      const workspaceStopped = (enrollment.packageId === "lead-follow-up" && workspace?.leadFollowUpKillSwitch === true)
        || (enrollment.packageId === "lead-generation" && workspace?.leadGenerationKillSwitch === true)
        || (enrollment.packageId === "ai-visibility" && workspace?.aiVisibilityKillSwitch === true)
        || (enrollment.packageId === "reviews-gbp" && workspace?.reviewsKillSwitch === true)
        || (enrollment.packageId === "appointment-reminders" && workspace?.appointmentRemindersKillSwitch === true)
        || (enrollment.packageId === "estimate-follow-ups" && workspace?.estimateFollowUpsKillSwitch === true)
        || (enrollment.packageId === "google-ads" && workspace?.googleAdsKillSwitch === true)
        || (enrollment.packageId === "meta-ads" && workspace?.metaAdsKillSwitch === true)
        || (enrollment.packageId === "office-automation" && workspace?.officeAutomationKillSwitch === true);
      let health: SentinelPipelineHealth = "idle";
      if (!enabled) health = "disabled";
      else if (enrollment.killSwitch || enrollment.status !== "active" || workspaceStopped) health = "stopped";
      else if (failed > 0 || needsHuman > 0) health = "degraded";
      else if (watched.some((step) => step.status === "running" || step.status === "done")) health = "healthy";
      return {
        enrollmentId: enrollment.id,
        clientId: enrollment.clientId,
        packageId: enrollment.packageId,
        health,
        killSwitch: enrollment.killSwitch || workspaceStopped,
        status: enrollment.status,
        needsHuman,
        failed,
        lastFinishedAt: finished.at(-1) || null,
        nextRunAt: nextStamp(watched),
      };
    }),
    summary: fulfillmentHealthSummary(state, tenantId),
  };
}
