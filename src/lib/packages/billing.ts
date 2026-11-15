import { getTestPlan, isTestPlanId, type TestPlanId } from "./plans.ts";
import { selectTestPlan, workspaceFor } from "./tenancy.ts";
import type { BillingEvent, FulfillmentState, SubscriptionLifecycle, TestInvoice } from "./types.ts";

export const SUBSCRIPTION_EDGES: Record<SubscriptionLifecycle, readonly SubscriptionLifecycle[]> = {
  trial: ["active", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled"],
  canceled: [],
};

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
  transitionSubscription(state: FulfillmentState, tenantId: string, to: SubscriptionLifecycle, now: string, id?: string): BillingOk | BillingNo;
  issueInvoice(state: FulfillmentState, tenantId: string, now: string, id?: string): BillingOk | BillingNo;
  payInvoice(state: FulfillmentState, tenantId: string, invoiceId: string, now: string, id?: string): BillingOk | BillingNo;
  checkout(state: FulfillmentState, tenantId: string, planId: string, now: string, id?: string): BillingOk | BillingNo;
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
  transitionSubscription(state, tenantId, to, now, id = `life_${now}`) {
    const workspace = workspaceFor(state, tenantId);
    if (!workspace) return { ok: false, state, reason: "That workspace is not open." };
    const from = workspace.subscriptionStatus || "trial";
    if (!SUBSCRIPTION_EDGES[from].includes(to)) {
      return { ok: false, state, reason: `A test subscription cannot move from ${from} to ${to}.` };
    }
    let next = setLifecycle(state, tenantId, to);
    if (to === "past_due" && !openInvoice(next, tenantId)) {
      next = { ...next, invoices: [...(next.invoices || []), zeroInvoice(`inv_${id}`, tenantId, "open", now)] };
    }
    if (to === "canceled") {
      next = {
        ...next,
        invoices: (next.invoices || []).map((row) =>
          row.tenantId === tenantId && row.status === "open" ? { ...row, status: "void" as const, amountCents: 0 as const } : row,
        ),
      };
    }
    const row = event(id, tenantId, `subscription_${to}`, workspace.planId, now);
    return { ok: true, event: row, state: append(next, row) };
  },
  issueInvoice(state, tenantId, now, id = `inv_${now}`) {
    if (!workspaceFor(state, tenantId)) return { ok: false, state, reason: "That workspace is not open." };
    const invoice = zeroInvoice(id, tenantId, "open", now);
    const row = event(`evt_${id}`, tenantId, "invoice_issued", workspaceFor(state, tenantId)?.planId || null, now);
    return { ok: true, event: row, state: append({ ...state, invoices: [...(state.invoices || []), invoice] }, row) };
  },
  payInvoice(state, tenantId, invoiceId, now, id = `pay_${now}`) {
    const invoice = (state.invoices || []).find((row) => row.id === invoiceId && row.tenantId === tenantId);
    if (!invoice) return { ok: false, state, reason: "That invoice is not in this workspace." };
    if (invoice.amountCents !== 0 || invoice.billingMode !== "test") {
      return { ok: false, state, reason: "Only a zero-amount test invoice can be recorded." };
    }
    if (invoice.status !== "open") return { ok: false, state, reason: "That invoice is not open." };
    let next: FulfillmentState = {
      ...state,
      invoices: state.invoices.map((row) => (row.id === invoiceId && row.tenantId === tenantId ? { ...row, status: "paid" as const, amountCents: 0 as const } : row)),
    };
    const workspace = workspaceFor(next, tenantId);
    if (workspace?.subscriptionStatus === "past_due") next = setLifecycle(next, tenantId, "active");
    const row = event(id, tenantId, "invoice_paid", workspace?.planId || null, now);
    return { ok: true, event: row, state: append(next, row) };
  },
  checkout(state, tenantId, planId, now, id = `chk_${now}`) {
    const workspace = workspaceFor(state, tenantId);
    if (!workspace) return { ok: false, state, reason: "Open this marketer's workspace before checkout." };
    if (workspace.subscriptionStatus === "canceled") {
      return { ok: false, state, reason: "This test subscription is canceled. No charge was attempted." };
    }
    if (!isTestPlanId(planId)) return { ok: false, state, reason: "That plan is not in the test catalog." };
    const selected = this.selectPlan(state, tenantId, planId, now, `${id}-plan`);
    if (!selected.ok) return selected;
    let next = selected.state;
    const current = workspaceFor(next, tenantId);
    if (current?.subscriptionStatus === "trial") {
      const moved = this.transitionSubscription(next, tenantId, "active", now, `${id}-life`);
      if (!moved.ok) return moved;
      next = moved.state;
    }
    const issued = this.issueInvoice(next, tenantId, now, `${id}-inv`);
    if (!issued.ok) return issued;
    const paid = this.payInvoice(issued.state, tenantId, `${id}-inv`, now, `${id}-pay`);
    if (!paid.ok) return paid;
    const row = event(id, tenantId, "checkout", planId, now);
    return { ok: true, event: row, state: append(paid.state, row) };
  },
};

function setLifecycle(state: FulfillmentState, tenantId: string, to: SubscriptionLifecycle): FulfillmentState {
  return {
    ...state,
    workspaces: state.workspaces.map((row) => (row.id === tenantId ? { ...row, subscriptionStatus: to } : row)),
  };
}

function openInvoice(state: FulfillmentState, tenantId: string): TestInvoice | undefined {
  return (state.invoices || []).find((row) => row.tenantId === tenantId && row.status === "open");
}

function zeroInvoice(id: string, tenantId: string, status: TestInvoice["status"], now: string): TestInvoice {
  return { id, tenantId, status, amountCents: 0, billingMode: "test", createdAt: now };
}
