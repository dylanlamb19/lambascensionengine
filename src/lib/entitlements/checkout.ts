import { completeCheckoutSession, createCheckoutSession } from "../subscription/billing.ts";
import type { FulfillmentState } from "../packages/types.ts";

/**
 * Record a Starter, Pro, or Agency change on the test scaffold.
 * The checkout amount stays at 0. This does not call a payment provider.
 */
export function recordTestPlan(
  state: FulfillmentState,
  tenantId: string,
  planId: string,
  now: string,
): { ok: true; state: FulfillmentState; planId: string; amountCents: 0 } | { ok: false; state: FulfillmentState; reason: string } {
  const opened = createCheckoutSession(state, tenantId, planId, now);
  if (!opened.ok || !opened.session || !("planId" in opened.session)) {
    return { ok: false, state, reason: opened.ok ? "That test checkout was not recorded." : opened.reason };
  }
  if (opened.session.amountCents !== 0 || opened.session.billingMode !== "test") {
    return { ok: false, state, reason: "Only a zero-amount test checkout can be recorded." };
  }
  const done = completeCheckoutSession(opened.state, tenantId, opened.session.id, now);
  if (!done.ok) return { ok: false, state, reason: done.reason };
  if (done.state.invoices.some((row) => row.amountCents !== 0) || done.state.billingEvents.some((row) => row.amountCents !== 0)) {
    return { ok: false, state, reason: "Only a zero-amount test checkout can be recorded." };
  }
  return { ok: true, state: done.state, planId: opened.session.planId, amountCents: 0 };
}
