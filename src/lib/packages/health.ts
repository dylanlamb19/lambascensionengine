import type { PackageId } from "./catalog.ts";
import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState } from "./types.ts";

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
};

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
        || (enrollment.packageId === "google-ads" && workspace?.googleAdsKillSwitch === true);
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
  };
}
