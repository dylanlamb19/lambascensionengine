import { getTestPlan, isTestPlanId, type TestPlanId } from "./plans.ts";
import { selectTestPlan, workspaceFor } from "./tenancy.ts";
import type { BillingEvent, FulfillmentState } from "./types.ts";

export type TestWebhook = {
  type: string;
  planId?: string;
};

export type BillingOk = { ok: true; state: FulfillmentState; event: BillingEvent };
export type BillingNo = { ok: false; state: FulfillmentState; reason: string };

/**
 * Test-mode billing. Implementations must not charge, and must not read keys or environment variables.
 */
export interface BillingProvider {
  readonly mode: "test";
  clientLimit(planId: TestPlanId): number | null;
  selectPlan(state: FulfillmentState, tenantId: string, planId: string, now: string, id?: string): BillingOk | BillingNo;
  assertCanAddClient(state: FulfillmentState, tenantId: string, now: string, id?: string): { ok: true; state: FulfillmentState } | BillingNo;
  handleWebhook(state: FulfillmentState, tenantId: string, body: TestWebhook, now: string, id?: string): BillingOk | BillingNo;
}

function event(id: string, tenantId: string, type: string, planId: string | null, now: string): BillingEvent {
  return { id, tenantId, type, planId, amountCents: 0, billingMode: "test", at: now };
}

function append(state: FulfillmentState, row: BillingEvent): FulfillmentState {
  return { ...state, billingEvents: [...(state.billingEvents || []), row] };
}

export const fakeBilling: BillingProvider = {
  mode: "test",
  clientLimit(planId) {
    return getTestPlan(planId).clientLimit;
  },
  selectPlan(state, tenantId, planId, now, id = `bill_${now}`) {
    const selected = selectTestPlan(state, tenantId, planId, now);
    if (!selected.ok) return { ok: false, state, reason: selected.reason };
    const row = event(id, tenantId, "plan_selected", selected.workspace.planId, now);
    return { ok: true, event: row, state: append(selected.state, row) };
  },
  assertCanAddClient(state, tenantId, now, id = `bill_${now}`) {
    const workspace = workspaceFor(state, tenantId);
    if (!workspace || workspace.billingMode !== "test") {
      return { ok: false, state, reason: "Open this marketer's workspace before recording a purchase." };
    }
    const limit = getTestPlan(workspace.planId).clientLimit;
    const owned = state.clients.filter((row) => row.tenantId === tenantId).length;
    if (limit != null && owned >= limit) {
      const row = event(id, tenantId, "client_limit", workspace.planId, now);
      return {
        ok: false,
        state: append(state, row),
        reason: `This test plan records up to ${limit} clients. No charge was attempted.`,
      };
    }
    return { ok: true, state };
  },
  handleWebhook(state, tenantId, body, now, id = `wh_${now}`) {
    if (!workspaceFor(state, tenantId)) return { ok: false, state, reason: "That workspace is not open." };
    if (body.planId && !isTestPlanId(body.planId)) {
      return { ok: false, state, reason: "That plan is not in the test catalog." };
    }
    let next = state;
    let planId: string | null = body.planId || null;
    if (body.planId && isTestPlanId(body.planId)) {
      const selected = selectTestPlan(state, tenantId, body.planId, now);
      if (!selected.ok) return { ok: false, state, reason: selected.reason };
      next = selected.state;
      planId = selected.workspace.planId;
    }
    const row = event(id, tenantId, body.type || "webhook", planId, now);
    return { ok: true, event: row, state: append(next, row) };
  },
};
