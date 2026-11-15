import { getTestPlan } from "./plans.ts";
import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState, TenantUsage } from "./types.ts";

export function usageFor(state: FulfillmentState, tenantId: string): TenantUsage {
  const stored = (state.usage || []).find((row) => row.tenantId === tenantId);
  const enrollments = (state.enrollments || []).filter((row) => row.tenantId === tenantId).length;
  return {
    tenantId,
    pipelineRuns: stored?.pipelineRuns || 0,
    enrollments: Math.max(stored?.enrollments || 0, enrollments),
  };
}

export function writeUsage(state: FulfillmentState, usage: TenantUsage): FulfillmentState {
  const rest = (state.usage || []).filter((row) => row.tenantId !== usage.tenantId);
  return { ...state, usage: [...rest, usage] };
}

export function assertEnrollmentAllowed(state: FulfillmentState, tenantId: string): { ok: true } | { ok: false; reason: string } {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, reason: "Open this marketer's workspace before recording a purchase." };
  }
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, reason: "This test subscription is canceled. No package was added and no charge was attempted." };
  }
  const limit = getTestPlan(workspace.planId).enrollmentLimit;
  const used = usageFor(state, tenantId).enrollments;
  if (limit != null && used >= limit) {
    return { ok: false, reason: `This test plan records up to ${limit} packages. No charge was attempted.` };
  }
  return { ok: true };
}

export function assertPipelineRunAllowed(state: FulfillmentState, tenantId: string, runsSoFar: number): { ok: true } | { ok: false; reason: string } {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, reason: "That workspace is not open." };
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, reason: "This test subscription is canceled. The pipeline did not run and no charge was attempted." };
  }
  const limit = getTestPlan(workspace.planId).pipelineRunLimit;
  if (limit != null && runsSoFar >= limit) {
    return { ok: false, reason: `This test plan allows ${limit} pipeline runs. No charge was attempted.` };
  }
  return { ok: true };
}
