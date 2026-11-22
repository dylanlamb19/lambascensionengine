import { addMonthlyRuns, capReason, monthlyRunsOf } from "../entitlements/meter.ts";
import { choosePlanNeeded, entitlementsOn } from "../entitlements/plans.ts";
import { resolveEntitledPlan, trialBlock } from "../entitlements/resolve.ts";
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

/**
 * Extra block for a scaffold subscription or a closed workspace.
 * Workspaces with no scaffold row keep the previous metering rules.
 */
export function scaffoldAccessBlock(state: FulfillmentState, tenantId: string, now?: string): string | null {
  const workspace = workspaceFor(state, tenantId);
  if (workspace?.closedAt) return "This workspace is closed. Nothing was changed.";
  if (workspace?.operatorSuspended) return "This workspace is suspended. Nothing was changed.";
  const sub = (state.scaffoldSubscriptions || []).find((row) => row.tenantId === tenantId);
  if (!sub) return null;
  if (sub.status === "canceled") return "This test subscription is canceled. No charge was attempted.";
  if (sub.status === "past_due" && sub.graceUntil && now && now > sub.graceUntil) {
    return "The grace period for this test subscription has ended. No charge was attempted.";
  }
  return null;
}

export function assertEnrollmentAllowed(state: FulfillmentState, tenantId: string, now?: string): { ok: true } | { ok: false; reason: string } {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, reason: "Open this marketer's workspace before recording a purchase." };
  }
  const blocked = scaffoldAccessBlock(state, tenantId, now);
  if (blocked) return { ok: false, reason: blocked };
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

export function assertPipelineRunAllowed(state: FulfillmentState, tenantId: string, runsSoFar: number, now?: string, entitlements?: boolean): { ok: true } | { ok: false; reason: string } {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, reason: "That workspace is not open." };
  const blocked = scaffoldAccessBlock(state, tenantId, now);
  if (blocked) return { ok: false, reason: blocked };
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, reason: "This test subscription is canceled. The pipeline did not run and no charge was attempted." };
  }
  if (entitlementsOn(entitlements)) {
    const clock = now || workspace.createdAt;
    const trial = trialBlock(state, tenantId, clock);
    if (trial) return { ok: false, reason: trial };
    const plan = resolveEntitledPlan(state, tenantId);
    if (!plan) return { ok: false, reason: choosePlanNeeded() };
    const storedLifetime = (state.usage || []).find((row) => row.tenantId === tenantId)?.pipelineRuns || 0;
    const projected = monthlyRunsOf(state, tenantId, clock) + Math.max(0, runsSoFar - storedLifetime);
    const reason = capReason(plan, "monthlyRuns", projected);
    if (reason) return { ok: false, reason };
    return { ok: true };
  }
  const limit = getTestPlan(workspace.planId).pipelineRunLimit;
  if (limit != null && runsSoFar >= limit) {
    return { ok: false, reason: `This test plan allows ${limit} pipeline runs. No charge was attempted.` };
  }
  return { ok: true };
}

/** Persist this period's fulfillment runs. A no-op while plan entitlements are off. */
export function finishPipelineRuns(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  advanced: number,
  entitlements?: boolean,
): FulfillmentState {
  if (!entitlementsOn(entitlements) || advanced <= 0) return state;
  return addMonthlyRuns(state, tenantId, now, advanced);
}
