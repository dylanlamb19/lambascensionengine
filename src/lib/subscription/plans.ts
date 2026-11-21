import type { TestPlanId } from "../packages/plans.ts";
import type { ScaffoldPlanId } from "../packages/types.ts";

/**
 * Test-mode plan catalog for the billing scaffold.
 * Seat and client limits are recorded caps. They are not a charge.
 */
export type ScaffoldPlan = {
  id: ScaffoldPlanId;
  name: string;
  seatLimit: number;
  clientLimit: number | null;
  testPlanId: TestPlanId;
  billingMode: "test";
  summary: string;
};

export const SCAFFOLD_PLANS: Record<ScaffoldPlanId, ScaffoldPlan> = {
  starter: {
    id: "starter",
    name: "Starter",
    seatLimit: 2,
    clientLimit: 3,
    testPlanId: "test_trial",
    billingMode: "test",
    summary: "Two people and three clients. Recorded at $0.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    seatLimit: 8,
    clientLimit: 25,
    testPlanId: "test_operator",
    billingMode: "test",
    summary: "Eight people and 25 clients. Recorded at $0.",
  },
  agency: {
    id: "agency",
    name: "Agency",
    seatLimit: 25,
    clientLimit: null,
    testPlanId: "test_agency",
    billingMode: "test",
    summary: "Twenty-five people. No client cap. Recorded at $0.",
  },
};

export function isScaffoldPlanId(value: string): value is ScaffoldPlanId {
  return value === "starter" || value === "pro" || value === "agency";
}

export function listScaffoldPlans(): ScaffoldPlan[] {
  return [SCAFFOLD_PLANS.starter, SCAFFOLD_PLANS.pro, SCAFFOLD_PLANS.agency];
}

export function scaffoldPlan(id: ScaffoldPlanId): ScaffoldPlan {
  return SCAFFOLD_PLANS[id];
}
