import type { PackageId } from "./catalog.ts";
import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState, StepRun } from "./types.ts";

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

function nextStamp(steps: StepRun[]): string | null {
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
      const needsHuman = steps.filter((step) => step.status === "needs_human").length;
      const failed = steps.filter((step) => step.status === "failed").length;
      const finished = steps.map((step) => step.finishedAt).filter((value): value is string => Boolean(value)).sort();
      let health: SentinelPipelineHealth = "idle";
      if (!enabled) health = "disabled";
      else if (enrollment.killSwitch || enrollment.status !== "active") health = "stopped";
      else if (failed > 0 || needsHuman > 0) health = "degraded";
      else if (steps.some((step) => step.status === "running" || step.status === "done")) health = "healthy";
      return {
        enrollmentId: enrollment.id,
        clientId: enrollment.clientId,
        packageId: enrollment.packageId,
        health,
        killSwitch: enrollment.killSwitch,
        status: enrollment.status,
        needsHuman,
        failed,
        lastFinishedAt: finished.at(-1) || null,
        nextRunAt: nextStamp(steps),
      };
    }),
  };
}
