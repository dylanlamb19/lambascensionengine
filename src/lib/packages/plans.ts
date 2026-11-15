/**
 * Test-mode plan catalog for a future marketer subscription.
 * These records do not charge anyone and do not reference live payment keys.
 */

export const TEST_PLAN_IDS = ["test_trial", "test_operator", "test_agency"] as const;

export type TestPlanId = (typeof TEST_PLAN_IDS)[number];

export type TestPlan = {
  id: TestPlanId;
  name: string;
  billingMode: "test";
  summary: string;
  /** Null means no scaffold cap. This is not a billed quantity. */
  clientLimit: number | null;
};

export const TEST_PLANS: Record<TestPlanId, TestPlan> = {
  test_trial: {
    id: "test_trial",
    name: "Test trial",
    billingMode: "test",
    summary: "Scaffold plan. No card and no charge.",
    clientLimit: 3,
  },
  test_operator: {
    id: "test_operator",
    name: "Test operator",
    billingMode: "test",
    summary: "Recorded plan for one marketer workspace. No charge.",
    clientLimit: 25,
  },
  test_agency: {
    id: "test_agency",
    name: "Test agency",
    billingMode: "test",
    summary: "Recorded plan for a larger workspace. No charge.",
    clientLimit: null,
  },
};

export function isTestPlanId(value: string): value is TestPlanId {
  return (TEST_PLAN_IDS as readonly string[]).includes(value);
}

export function getTestPlan(id: TestPlanId): TestPlan {
  return TEST_PLANS[id];
}

export function listTestPlans(): TestPlan[] {
  return TEST_PLAN_IDS.map((id) => TEST_PLANS[id]);
}
