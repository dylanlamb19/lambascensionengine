import { guardSession, requireSessionCsrf, sessionById, type FlowResult } from "../account/flow.ts";
import type { AccountAction } from "../account/rbac.ts";
import type { AccountBundle, AccountSession } from "../account/types.ts";
import type { AccountCall, AccountReply } from "../account/routes.ts";
import { recordTestPlan } from "../entitlements/checkout.ts";
import { limitBanners, planRank, readingsFor } from "../entitlements/meter.ts";
import { listEntitlements } from "../entitlements/plans.ts";
import { resolveEntitledPlan } from "../entitlements/resolve.ts";
import {
  addWizardClient,
  chooseWizardPackages,
  chooseWizardPlan,
  confirmWizardBranding,
  ensureWizard,
  finishWizard,
  importWizardLeads,
  skipWizardStep,
  wizardView,
  WIZARD_STEPS,
} from "../onboarding/wizard.ts";
import {
  isPlatformOperator,
  killTenantPipelines,
  listOperatorTenants,
  operatorTenantList,
  resumeTenant,
  suspendTenant,
  viewOperatorTenant,
} from "../operator/console.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { WizardStepId } from "../packages/types.ts";
import type { LayerFlags } from "../subscription/dispatch.ts";
import { subscriptionFor } from "../subscription/billing.ts";

type ProductCall = AccountCall & { flags: LayerFlags };

function reply(result: FlowResult): AccountReply {
  return result;
}

function fail(bundle: AccountBundle, status: number, reason: string): AccountReply {
  return { bundle, status, body: { ok: false, reason }, headers: {} };
}

function isReply(value: { session: AccountSession } | AccountReply): value is AccountReply {
  return "status" in value;
}

function authed(bundle: AccountBundle, call: ProductCall, action: AccountAction, csrf: boolean): { session: AccountSession } | AccountReply {
  const session = sessionById(bundle, call.sessionId);
  const guarded = guardSession(bundle, session, {
    csrfToken: call.csrfToken || "",
    claimedTenant: call.body?.tenantId,
    action,
    csrf,
  });
  if ("status" in guarded) return guarded;
  return { session: guarded.session };
}

function isWizardStep(value: string): value is WizardStepId {
  return (WIZARD_STEPS as readonly string[]).includes(value);
}

function targetTenant(call: ProductCall): string {
  const query = new URLSearchParams((call.path || "").split("?")[1] || "");
  const fromQuery = query.get("tenantId") || "";
  const fromBody = typeof call.body?.tenantId === "string" ? call.body.tenantId : "";
  return fromBody || fromQuery;
}

function planPayload(bundle: AccountBundle, tenantId: string, now: string) {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  const plan = resolveEntitledPlan(bundle.fulfillment, tenantId);
  const sub = subscriptionFor(bundle.fulfillment, tenantId);
  const meters = readingsFor(bundle.fulfillment, tenantId, now, plan);
  return {
    planId: plan?.id || null,
    planName: plan?.name || null,
    status: sub?.status || workspace?.subscriptionStatus || null,
    trialEndsAt: sub?.trialEndsAt || null,
    trialDays: plan?.trialDays ?? 14,
    amountCents: 0 as const,
    billingMode: "test" as const,
    suspended: workspace?.operatorSuspended === true,
    meters,
    banners: limitBanners(plan, meters),
    plans: listEntitlements().map((row) => ({
      id: row.id,
      name: row.name,
      summary: `${row.limits.teamSeats} seats. Recorded at $0.`,
      limits: row.limits,
      packages: row.packages,
      amountCents: 0 as const,
    })),
  };
}

export function tryOperatorRoute(bundle: AccountBundle, call: ProductCall): AccountReply | null {
  const path = (call.path || "").split("?")[0];
  if (path !== "/api/account/operator" && !path.startsWith("/api/account/operator/")) return null;
  if (call.flags.operator !== true) return fail(bundle, 404, "The operator console is off.");
  const method = call.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return fail(bundle, 405, "That request is not available.");
  const session = sessionById(bundle, call.sessionId);
  if (!session) return fail(bundle, 401, "Sign in is required.");
  if (method === "POST" && !requireSessionCsrf(session, call.csrfToken || "")) {
    return fail(bundle, 403, "The form token is missing or expired.");
  }
  if (!isPlatformOperator(bundle, session.userId)) {
    return fail(bundle, 403, "This console is for the Lasengine owner.");
  }
  const beforeTenant = session.tenantId;
  if (path === "/api/account/operator" && method === "GET") {
    const next = listOperatorTenants(bundle, session.userId, call.now);
    return reply({
      bundle: next,
      status: 200,
      body: {
        ok: true,
        mode: "read_only",
        impersonation: false,
        sessionTenantId: beforeTenant,
        tenants: operatorTenantList(next, call.now),
      },
      headers: {},
    });
  }
  const tenantId = targetTenant(call);
  if (!tenantId) return fail(bundle, 400, "Choose a workspace.");
  if (path === "/api/account/operator/tenant" && method === "GET") {
    const viewed = viewOperatorTenant(bundle, session.userId, tenantId, call.now);
    if (!viewed.ok) return fail(viewed.bundle, 404, viewed.reason);
    return reply({
      bundle: viewed.bundle,
      status: 200,
      body: {
        ok: true,
        mode: "read_only",
        impersonation: false,
        sessionTenantId: viewed.bundle.accounts.sessions.find((row) => row.id === session.id)?.tenantId || beforeTenant,
        tenant: viewed.tenant,
      },
      headers: {},
    });
  }
  if (method !== "POST") return fail(bundle, 405, "That request is not available.");
  const action = path === "/api/account/operator/suspend"
    ? suspendTenant
    : path === "/api/account/operator/resume"
      ? resumeTenant
      : path === "/api/account/operator/kill"
        ? killTenantPipelines
        : null;
  if (!action) return fail(bundle, 404, "That page is not available.");
  const done = action(bundle, session.userId, tenantId, call.now);
  if (!done.ok) return fail(done.bundle, 404, done.reason);
  const still = done.bundle.accounts.sessions.find((row) => row.id === session.id);
  return reply({
    bundle: done.bundle,
    status: 200,
    body: {
      ok: true,
      mode: "read_only",
      impersonation: false,
      sessionTenantId: still?.tenantId || beforeTenant,
      tenant: operatorTenantList(done.bundle, call.now).find((row) => row.tenantId === tenantId) || null,
    },
    headers: {},
  });
}

export function tryMarketerProductRoute(bundle: AccountBundle, call: ProductCall): AccountReply | null {
  const path = (call.path || "").split("?")[0];
  const planPath = path === "/api/account/plan" || path === "/api/account/plan/change";
  const wizardPath = path === "/api/account/onboarding/wizard";
  if (!planPath && !wizardPath) return null;
  if (planPath && call.flags.entitlements !== true) return fail(bundle, 404, "Plan entitlements are off.");
  if (wizardPath && call.flags.wizard !== true) return fail(bundle, 404, "Onboarding is off.");
  const method = call.method.toUpperCase();
  const body = call.body || {};
  if (path === "/api/account/plan" && method === "GET") {
    const gate = authed(bundle, call, "billing:read", false);
    if (isReply(gate)) return gate;
    return reply({ bundle, status: 200, body: { ok: true, csrfToken: gate.session.csrfToken, plan: planPayload(bundle, gate.session.tenantId, call.now) }, headers: {} });
  }
  if (path === "/api/account/plan/change" && method === "POST") {
    const gate = authed(bundle, call, "billing:write", true);
    if (isReply(gate)) return gate;
    const current = resolveEntitledPlan(bundle.fulfillment, gate.session.tenantId);
    const changed = recordTestPlan(bundle.fulfillment, gate.session.tenantId, String(body.planId || ""), call.now);
    if (!changed.ok) return fail(bundle, 400, changed.reason);
    const next = { ...bundle, fulfillment: changed.state };
    const after = resolveEntitledPlan(next.fulfillment, gate.session.tenantId);
    const direction = current && after ? (planRank(after.id) === planRank(current.id) ? "same" : planRank(after.id) > planRank(current.id) ? "upgrade" : "downgrade") : "upgrade";
    return reply({
      bundle: next,
      status: 200,
      body: { ok: true, direction, amountCents: 0, billingMode: "test", plan: planPayload(next, gate.session.tenantId, call.now) },
      headers: {},
    });
  }
  if (path === "/api/account/onboarding/wizard" && method === "GET") {
    const gate = authed(bundle, call, "settings:read", false);
    if (isReply(gate)) return gate;
    const opened = ensureWizard(bundle.fulfillment, gate.session.tenantId, call.now);
    if (!opened.ok) return fail(bundle, 404, opened.reason);
    const next = { ...bundle, fulfillment: opened.state };
    return reply({
      bundle: next,
      status: 200,
      body: { ok: true, csrfToken: gate.session.csrfToken, wizard: wizardView(next.fulfillment, gate.session.tenantId, call.now, call.flags.entitlements === true) },
      headers: {},
    });
  }
  if (path === "/api/account/onboarding/wizard" && method === "POST") {
    const gate = authed(bundle, call, "settings:write", true);
    if (isReply(gate)) return gate;
    const step = String(body.step || "");
    if (!isWizardStep(step)) return fail(bundle, 400, "That step is not part of the wizard.");
    const ensured = ensureWizard(bundle.fulfillment, gate.session.tenantId, call.now);
    if (!ensured.ok) return fail(bundle, 404, ensured.reason);
    const tenantId = gate.session.tenantId;
    const entitled = call.flags.entitlements === true;
    let result;
    if (body.skip === true) result = skipWizardStep(ensured.state, tenantId, step, call.now);
    else if (step === "branding") {
      result = confirmWizardBranding(ensured.state, tenantId, {
        name: String(body.name || ""),
        senderDisplayName: String(body.senderDisplayName || ""),
        primary: String(body.primary || ""),
        accent: String(body.accent || ""),
        timezone: String(body.timezone || ""),
      }, call.now);
    } else if (step === "plan") result = chooseWizardPlan(ensured.state, tenantId, String(body.planId || ""), call.now);
    else if (step === "client") result = addWizardClient(ensured.state, tenantId, String(body.name || ""), call.now, entitled);
    else if (step === "packages") {
      const packageIds = Array.isArray(body.packageIds) ? body.packageIds.filter((id): id is string => typeof id === "string") : [];
      result = chooseWizardPackages(ensured.state, tenantId, { clientId: String(body.clientId || ""), packageIds }, call.now, entitled);
    } else if (step === "leads") result = importWizardLeads(ensured.state, tenantId, String(body.clientId || ""), String(body.csv || ""), call.now);
    else result = finishWizard(ensured.state, tenantId, call.now);
    if (!result.ok) return fail({ ...bundle, fulfillment: result.state }, 400, result.reason);
    const next = { ...bundle, fulfillment: result.state };
    return reply({
      bundle: next,
      status: 200,
      body: {
        ok: true,
        amountCents: 0,
        billingMode: "test",
        wizard: wizardView(next.fulfillment, tenantId, call.now, entitled),
      },
      headers: {},
    });
  }
  return fail(bundle, 405, "That request is not available.");
}
