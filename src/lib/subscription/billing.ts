import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { selectTestPlan, workspaceFor } from "../packages/tenancy.ts";
import type {
  BillingEvent,
  CheckoutSessionRecord,
  FulfillmentState,
  PortalSessionRecord,
  ScaffoldPlanId,
  ScaffoldStatus,
  ScaffoldSubscription,
  SubscriptionLifecycle,
} from "../packages/types.ts";
import { isScaffoldPlanId, scaffoldPlan } from "./plans.ts";

export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Local verifier secret. Not a payment key, and not read from the environment. */
export const SCAFFOLD_TEST_SECRET = "scaffold-test-only";

export type ScaffoldEventType =
  | "checkout.session.completed"
  | "invoice.paid"
  | "invoice.payment_failed"
  | "customer.subscription.deleted";

export type ScaffoldWebhookEvent = {
  id: string;
  type: ScaffoldEventType;
  workspaceId: string;
  planId?: string | null;
  livemode?: boolean;
  mode?: string;
};

export type SignatureVerifier = {
  verify(payload: string, signature: string, secret: string): boolean;
};

export type BillingResult =
  | { ok: true; state: FulfillmentState; duplicate?: boolean; session?: CheckoutSessionRecord | PortalSessionRecord }
  | { ok: false; state: FulfillmentState; reason: string };

const EVENT_TYPES = new Set<ScaffoldEventType>([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
]);

export function looksLive(value: string): boolean {
  const text = value.toLowerCase();
  if (text.includes("sk_live") || text.includes("pk_live") || text.includes("rk_live") || text.includes("whsec_live")) return true;
  if (text.includes("price_live") || text.includes("prod_live") || text.includes("cs_live") || text.includes("sub_live") || text.includes("cus_live")) return true;
  return false;
}

export function canonicalWebhookBody(event: ScaffoldWebhookEvent): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    workspaceId: event.workspaceId,
    planId: event.planId ?? null,
    livemode: event.livemode === true,
    mode: event.mode || "test",
  });
}

export function signScaffoldPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export const hmacSignatureVerifier: SignatureVerifier = {
  verify(payload, signature, secret) {
    if (!payload || !signature || !secret) return false;
    if (looksLive(secret) || looksLive(signature)) return false;
    const expected = signScaffoldPayload(payload, secret);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  },
};

function testId(prefix: "cs_test" | "ps_test" | "cus_test" | "sub_test"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function refuseLiveText(value: string): string | null {
  if (looksLive(value)) return "That value is a live payment id. It was refused.";
  if (/"livemode"\s*:\s*true/.test(value)) return "Live mode was refused. Nothing was charged.";
  if (/"mode"\s*:\s*"live"/.test(value)) return "Live mode was refused. Nothing was charged.";
  return null;
}

function notice(id: string, tenantId: string, type: string, planId: string | null, now: string): BillingEvent {
  return { id, tenantId, type, planId, amountCents: 0, billingMode: "test", at: now };
}

function withNotice(state: FulfillmentState, row: BillingEvent): FulfillmentState {
  return { ...state, billingEvents: [...(state.billingEvents || []), row] };
}

function mappedLifecycle(status: ScaffoldStatus): SubscriptionLifecycle {
  if (status === "trialing") return "trial";
  return status;
}

function putSubscription(state: FulfillmentState, row: ScaffoldSubscription, lifecycle: SubscriptionLifecycle): FulfillmentState {
  const rest = (state.scaffoldSubscriptions || []).filter((item) => item.tenantId !== row.tenantId);
  return {
    ...state,
    scaffoldSubscriptions: [...rest, row],
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === row.tenantId
        ? {
            ...workspace,
            subscriptionStatus: lifecycle,
            planStatus: lifecycle === "active" ? "test_active" : lifecycle === "trial" ? "test_trial" : workspace.planStatus,
            billingMode: "test",
          }
        : workspace,
    ),
  };
}

export function subscriptionFor(state: FulfillmentState, tenantId: string): ScaffoldSubscription | null {
  return (state.scaffoldSubscriptions || []).find((row) => row.tenantId === tenantId) || null;
}

export function createCheckoutSession(state: FulfillmentState, tenantId: string, planId: string, now: string): BillingResult {
  if (looksLive(planId) || !isScaffoldPlanId(planId)) {
    return { ok: false, state, reason: looksLive(planId) ? "That value is a live payment id. It was refused." : "That plan is not in the test catalog." };
  }
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") return { ok: false, state, reason: "Open this marketer's workspace before checkout." };
  if (workspace.closedAt) return { ok: false, state, reason: "This workspace is closed. Nothing was charged." };
  const current = subscriptionFor(state, tenantId);
  if (current?.status === "canceled" || workspace.subscriptionStatus === "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. No charge was attempted." };
  }
  const session: CheckoutSessionRecord = {
    id: testId("cs_test"),
    tenantId,
    planId,
    amountCents: 0,
    billingMode: "test",
    status: "open",
    createdAt: now,
  };
  if (!session.id.startsWith("cs_test_") || looksLive(session.id)) {
    return { ok: false, state, reason: "That value is a live payment id. It was refused." };
  }
  return {
    ok: true,
    session,
    state: { ...state, checkoutSessions: [...(state.checkoutSessions || []), session] },
  };
}

export function createPortalSession(state: FulfillmentState, tenantId: string, now: string): BillingResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, state, reason: "That workspace is not open." };
  if (!subscriptionFor(state, tenantId)) return { ok: false, state, reason: "Choose a test plan before opening the portal." };
  const session: PortalSessionRecord = {
    id: testId("ps_test"),
    tenantId,
    url: "",
    billingMode: "test",
    createdAt: now,
  };
  session.url = `/billing?portal=${session.id}`;
  if (looksLive(session.id) || looksLive(session.url)) return { ok: false, state, reason: "That value is a live payment id. It was refused." };
  return {
    ok: true,
    session,
    state: { ...state, portalSessions: [...(state.portalSessions || []), session] },
  };
}

export function handleScaffoldWebhook(
  state: FulfillmentState,
  rawBody: string,
  signature: string,
  verifier: SignatureVerifier,
  secret: string,
  now: string,
): BillingResult {
  const live = refuseLiveText(rawBody) || (looksLive(secret) ? "That value is a live payment id. It was refused." : null);
  if (live) return { ok: false, state, reason: live };
  if (!verifier.verify(rawBody, signature, secret)) {
    return { ok: false, state, reason: "The signature does not match." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return { ok: false, state, reason: "That notice could not be read." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, state, reason: "That notice could not be read." };
  }
  const body = parsed as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const type = typeof body.type === "string" ? body.type : "";
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const planRaw = typeof body.planId === "string" ? body.planId : "";
  if (!id || looksLive(id) || looksLive(workspaceId) || (planRaw && looksLive(planRaw))) {
    return { ok: false, state, reason: "That value is a live payment id. It was refused." };
  }
  if (!EVENT_TYPES.has(type as ScaffoldEventType)) return { ok: false, state, reason: "That notice is not one this scaffold records." };
  if (body.livemode === true || body.mode === "live") return { ok: false, state, reason: "Live mode was refused. Nothing was charged." };
  const workspace = workspaceFor(state, workspaceId);
  if (!workspace || workspace.billingMode !== "test") return { ok: false, state, reason: "That workspace is not open." };
  if (workspace.closedAt) return { ok: false, state, reason: "This workspace is closed. Nothing was charged." };
  if ((state.webhookReceipts || []).some((row) => row.tenantId === workspaceId && row.id === id)) {
    return { ok: true, state, duplicate: true };
  }
  const applied = applyEvent(state, {
    id,
    type: type as ScaffoldEventType,
    workspaceId,
    planId: planRaw || null,
    livemode: false,
    mode: "test",
  }, now);
  if (!applied.ok) return applied;
  return {
    ok: true,
    state: {
      ...applied.state,
      webhookReceipts: [...(applied.state.webhookReceipts || []), { id, tenantId: workspaceId, type, at: now }],
    },
  };
}

function applyEvent(state: FulfillmentState, event: ScaffoldWebhookEvent, now: string): BillingResult {
  if (event.type === "checkout.session.completed") return applyCheckout(state, event, now);
  if (event.type === "invoice.paid") return applyStatus(state, event.workspaceId, "active", null, now, event.id, event.planId || null);
  if (event.type === "invoice.payment_failed") return applyStatus(state, event.workspaceId, "past_due", plus(now, GRACE_MS), now, event.id, event.planId || null);
  return applyStatus(state, event.workspaceId, "canceled", null, now, event.id, event.planId || null);
}

function applyCheckout(state: FulfillmentState, event: ScaffoldWebhookEvent, now: string): BillingResult {
  const planId = event.planId || "";
  if (!isScaffoldPlanId(planId)) return { ok: false, state, reason: "That plan is not in the test catalog." };
  const plan = scaffoldPlan(planId);
  const selected = selectTestPlan(state, event.workspaceId, plan.testPlanId, now);
  if (!selected.ok) return { ok: false, state, reason: selected.reason };
  const prior = subscriptionFor(selected.state, event.workspaceId);
  if (prior?.status === "canceled") return { ok: false, state, reason: "This test subscription is canceled. No charge was attempted." };
  const status: ScaffoldStatus = prior?.status === "active" || prior?.status === "past_due" ? prior.status : "trialing";
  const row: ScaffoldSubscription = {
    tenantId: event.workspaceId,
    planId,
    status,
    customerId: prior?.customerId || testId("cus_test"),
    subscriptionId: prior?.subscriptionId || testId("sub_test"),
    graceUntil: status === "past_due" ? prior?.graceUntil || null : null,
    billingMode: "test",
    updatedAt: now,
  };
  if (looksLive(row.customerId) || looksLive(row.subscriptionId)) {
    return { ok: false, state, reason: "That value is a live payment id. It was refused." };
  }
  let next = putSubscription(selected.state, row, mappedLifecycle(status));
  next = {
    ...next,
    checkoutSessions: (next.checkoutSessions || []).map((session) =>
      session.tenantId === event.workspaceId && session.planId === planId && session.status === "open"
        ? { ...session, status: "complete" as const, amountCents: 0 as const }
        : session,
    ),
  };
  return { ok: true, state: withNotice(next, notice(`evt_${event.id}`, event.workspaceId, "checkout.session.completed", plan.testPlanId, now)) };
}

function applyStatus(
  state: FulfillmentState,
  tenantId: string,
  status: ScaffoldStatus,
  graceUntil: string | null,
  now: string,
  eventId: string,
  planRaw: string | null,
): BillingResult {
  const current = subscriptionFor(state, tenantId);
  if (!current) return { ok: false, state, reason: "Choose a test plan before recording that notice." };
  if (current.status === "canceled" && status !== "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. No charge was attempted." };
  }
  let planId = current.planId;
  let next = state;
  if (planRaw) {
    if (!isScaffoldPlanId(planRaw)) return { ok: false, state, reason: "That plan is not in the test catalog." };
    planId = planRaw;
    const selected = selectTestPlan(state, tenantId, scaffoldPlan(planId).testPlanId, now);
    if (!selected.ok) return { ok: false, state, reason: selected.reason };
    next = selected.state;
  }
  const row: ScaffoldSubscription = {
    ...current,
    planId,
    status,
    graceUntil: status === "past_due" ? graceUntil : null,
    billingMode: "test",
    updatedAt: now,
  };
  const saved = putSubscription(next, row, mappedLifecycle(status));
  return { ok: true, state: withNotice(saved, notice(`evt_${eventId}`, tenantId, status === "canceled" ? "customer.subscription.deleted" : status === "past_due" ? "invoice.payment_failed" : "invoice.paid", scaffoldPlan(planId).testPlanId, now)) };
}

export function completeCheckoutSession(state: FulfillmentState, tenantId: string, sessionId: string, now: string, verifier: SignatureVerifier = hmacSignatureVerifier, secret = SCAFFOLD_TEST_SECRET): BillingResult {
  const session = (state.checkoutSessions || []).find((row) => row.id === sessionId && row.tenantId === tenantId);
  if (!session) return { ok: false, state, reason: "That checkout session is not in this workspace." };
  if (session.amountCents !== 0 || session.billingMode !== "test") return { ok: false, state, reason: "Only a zero-amount test checkout can be recorded." };
  const event: ScaffoldWebhookEvent = {
    id: `evt_test_${session.id}`,
    type: "checkout.session.completed",
    workspaceId: tenantId,
    planId: session.planId,
    livemode: false,
    mode: "test",
  };
  const raw = canonicalWebhookBody(event);
  return handleScaffoldWebhook(state, raw, signScaffoldPayload(raw, secret), verifier, secret, now);
}
