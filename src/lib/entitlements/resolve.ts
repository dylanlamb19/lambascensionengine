import type { TestPlanId } from "../packages/plans.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState, ScaffoldPlanId } from "../packages/types.ts";
import { subscriptionFor } from "../subscription/billing.ts";
import { entitlementFor, trialEnded, type PlanEntitlement } from "./plans.ts";

const FROM_TEST: Record<TestPlanId, ScaffoldPlanId> = {
  test_trial: "starter",
  test_operator: "pro",
  test_agency: "agency",
};

/** Scaffold subscription wins. Otherwise a selected test plan maps onto Starter, Pro, or Agency. */
export function resolveEntitledPlan(state: FulfillmentState, tenantId: string): PlanEntitlement | null {
  const sub = subscriptionFor(state, tenantId);
  if (sub && sub.status !== "canceled") return entitlementFor(sub.planId);
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.planStatus === "test_inactive") return null;
  const mapped = FROM_TEST[workspace.planId];
  return mapped ? entitlementFor(mapped) : null;
}

export function trialBlock(state: FulfillmentState, tenantId: string, now: string): string | null {
  const sub = subscriptionFor(state, tenantId);
  if (!sub || sub.status !== "trialing" || !sub.trialEndsAt) return null;
  if (now > sub.trialEndsAt) return trialEnded();
  return null;
}
