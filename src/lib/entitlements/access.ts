import { getPackage, isPackageId, type PackageId } from "../packages/catalog.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState } from "../packages/types.ts";
import { scaffoldAccessBlock } from "../packages/usage.ts";
import { capReason, liveClientCount, livePipelineCount, occupiedSeats } from "./meter.ts";
import { choosePlanNeeded, upgradeNeeded } from "./plans.ts";
import { resolveEntitledPlan, trialBlock } from "./resolve.ts";

/** Shared preface for a new client, package, seat, or run. Numeric caps are separate. */
export function entitlementPreface(state: FulfillmentState, tenantId: string, now: string): string | null {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") return "Open this marketer's workspace before continuing.";
  const blocked = scaffoldAccessBlock(state, tenantId, now);
  if (blocked) return blocked;
  if (workspace.subscriptionStatus === "canceled") {
    return "This test subscription is canceled. No charge was attempted.";
  }
  const trial = trialBlock(state, tenantId, now);
  if (trial) return trial;
  if (!resolveEntitledPlan(state, tenantId)) return choosePlanNeeded();
  return null;
}

export function packageBlock(state: FulfillmentState, tenantId: string, packageId: string): string | null {
  const plan = resolveEntitledPlan(state, tenantId);
  if (!plan) return choosePlanNeeded();
  if (!isPackageId(packageId) || !plan.packages.includes(packageId as PackageId)) {
    const name = isPackageId(packageId) ? getPackage(packageId).name : "That package";
    return upgradeNeeded(plan.name, `does not include ${name}.`);
  }
  return null;
}

export function clientCapBlock(state: FulfillmentState, tenantId: string): string | null {
  const plan = resolveEntitledPlan(state, tenantId);
  if (!plan) return choosePlanNeeded();
  return capReason(plan, "clientWorkspaces", liveClientCount(state, tenantId));
}

export function pipelineCapBlock(state: FulfillmentState, tenantId: string): string | null {
  const plan = resolveEntitledPlan(state, tenantId);
  if (!plan) return choosePlanNeeded();
  return capReason(plan, "activePipelines", livePipelineCount(state, tenantId));
}

export function seatCapBlock(state: FulfillmentState, tenantId: string, now: string): string | null {
  const plan = resolveEntitledPlan(state, tenantId);
  if (!plan) return choosePlanNeeded();
  return capReason(plan, "teamSeats", occupiedSeats(state, tenantId, now));
}
