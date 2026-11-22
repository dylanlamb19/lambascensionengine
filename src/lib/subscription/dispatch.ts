import { clearSessionCookie, newId } from "../account/crypto.ts";
import {
  changeMemberRole,
  guardSession,
  removeMember,
  replaceUserSession,
  sessionById,
  type FlowResult,
} from "../account/flow.ts";
import type { AccountBundle, AccountSession } from "../account/types.ts";
import type { AccountAction } from "../account/rbac.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import { usageFor } from "../packages/usage.ts";
import {
  completeCheckoutSession,
  createCheckoutSession,
  createPortalSession,
  handleScaffoldWebhook,
  hmacSignatureVerifier,
  SCAFFOLD_TEST_SECRET,
  subscriptionFor,
} from "./billing.ts";
import { closeWorkspace, exportWorkspace, restoreWorkspace } from "./lifecycle.ts";
import { listScaffoldPlans, scaffoldPlan } from "./plans.ts";
import { acceptSeat, inviteSeat, seatLimitFor, seatsInUse, transferOwnership } from "./team.ts";

export type LayerFlags = {
  billing: boolean;
  team: boolean;
  lifecycle: boolean;
  entitlements?: boolean;
  wizard?: boolean;
  operator?: boolean;
};

export type LayerCall = {
  method: string;
  path: string;
  now: string;
  sessionId?: string | null;
  csrfToken?: string | null;
  signature?: string | null;
  body?: Record<string, unknown> | null;
  flags: LayerFlags;
};

const BILLING_PATHS = new Set([
  "/api/account/billing/scaffold",
  "/api/account/billing/checkout",
  "/api/account/billing/checkout/complete",
  "/api/account/billing/portal",
  "/api/account/billing/webhook",
]);

const TEAM_PATHS = new Set([
  "/api/account/team",
  "/api/account/team/invite",
  "/api/account/team/accept",
  "/api/account/team/role",
  "/api/account/team/remove",
  "/api/account/team/transfer",
  "/api/account/team/switch",
]);

const LIFE_PATHS = new Set([
  "/api/account/workspace/export",
  "/api/account/workspace/close",
  "/api/account/workspace/restore",
]);

function reply(result: FlowResult): FlowResult {
  return result;
}

function fail(bundle: AccountBundle, status: number, reason: string): FlowResult {
  return { bundle, status, body: { ok: false, reason }, headers: {} };
}

function closed(bundle: AccountBundle, reason: string): FlowResult {
  return fail(bundle, 404, reason);
}

function isReply(value: { session: AccountSession } | FlowResult): value is FlowResult {
  return "status" in value;
}

function authed(bundle: AccountBundle, call: LayerCall, action: AccountAction, csrf: boolean): { session: AccountSession } | FlowResult {
  const session = sessionById(bundle, call.sessionId);
  const guarded = guardSession(bundle, session, {
    csrfToken: call.csrfToken || "",
    claimedTenant: call.body?.tenantId,
    action,
    csrf,
  });
  if (isReply(guarded)) return guarded;
  return { session: guarded.session };
}

export function tryLayerRoute(bundle: AccountBundle, call: LayerCall): FlowResult | null {
  const path = call.path;
  const method = call.method.toUpperCase();
  if (!BILLING_PATHS.has(path) && !TEAM_PATHS.has(path) && !LIFE_PATHS.has(path)) return null;
  if (BILLING_PATHS.has(path) && !call.flags.billing) return closed(bundle, "Billing is off.");
  if (TEAM_PATHS.has(path) && !call.flags.team) return closed(bundle, "Team seats are off.");
  if (LIFE_PATHS.has(path) && !call.flags.lifecycle) return closed(bundle, "Workspace export and closing are off.");
  if (method !== "GET" && method !== "POST") return fail(bundle, 405, "That request is not available.");

  if (path === "/api/account/billing/webhook") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const raw = typeof call.body?.raw === "string" ? call.body.raw : JSON.stringify(call.body || {});
    const result = handleScaffoldWebhook(bundle.fulfillment, raw, call.signature || "", hmacSignatureVerifier, SCAFFOLD_TEST_SECRET, call.now);
    if (!result.ok) return fail(bundle, 400, result.reason);
    return reply({
      bundle: { ...bundle, fulfillment: result.state },
      status: 200,
      body: { ok: true, duplicate: result.duplicate === true },
      headers: {},
    });
  }

  const body = call.body || {};
  if (path === "/api/account/billing/scaffold") {
    if (method !== "GET") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "billing:read", false);
    if (isReply(gate)) return gate;
    return readScaffold(bundle, gate.session, call.now);
  }
  if (path === "/api/account/billing/checkout") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "billing:write", true);
    if (isReply(gate)) return gate;
    const opened = createCheckoutSession(bundle.fulfillment, gate.session.tenantId, String(body.planId || ""), call.now);
    if (!opened.ok || !opened.session || !("planId" in opened.session)) return fail(bundle, 400, opened.ok ? "That checkout was not recorded." : opened.reason);
    return reply({
      bundle: { ...bundle, fulfillment: opened.state },
      status: 200,
      body: { ok: true, sessionId: opened.session.id, url: `/billing?session=${opened.session.id}`, amountCents: 0, billingMode: "test" },
      headers: {},
    });
  }
  if (path === "/api/account/billing/checkout/complete") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "billing:write", true);
    if (isReply(gate)) return gate;
    const done = completeCheckoutSession(bundle.fulfillment, gate.session.tenantId, String(body.sessionId || ""), call.now);
    if (!done.ok) return fail(bundle, 400, done.reason);
    const view = scaffoldView(done.state, gate.session.tenantId, call.now);
    return reply({ bundle: { ...bundle, fulfillment: done.state }, status: 200, body: { ok: true, duplicate: done.duplicate === true, billing: view }, headers: {} });
  }
  if (path === "/api/account/billing/portal") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "billing:write", true);
    if (isReply(gate)) return gate;
    const opened = createPortalSession(bundle.fulfillment, gate.session.tenantId, call.now);
    if (!opened.ok || !opened.session || !("url" in opened.session)) return fail(bundle, 400, opened.ok ? "The portal was not recorded." : opened.reason);
    return reply({
      bundle: { ...bundle, fulfillment: opened.state },
      status: 200,
      body: { ok: true, url: opened.session.url, billingMode: "test", amountCents: 0 },
      headers: {},
    });
  }

  if (path === "/api/account/team") {
    if (method !== "GET") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "settings:read", false);
    if (isReply(gate)) return gate;
    return readTeam(bundle, gate.session, call.now);
  }
  if (path === "/api/account/team/invite") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "invite", true);
    if (isReply(gate)) return gate;
    const invited = inviteSeat(bundle, {
      tenantId: gate.session.tenantId,
      actorUserId: gate.session.userId,
      email: String(body.email || ""),
      role: String(body.role || "member"),
      now: call.now,
    }, { entitlements: call.flags.entitlements === true });
    if (!invited.ok) return fail(invited.bundle, 400, invited.reason);
    return reply({
      bundle: invited.bundle,
      status: 200,
      body: { ok: true, inviteId: invited.invite?.id || "", reason: "Invite recorded. Nothing was sent." },
      headers: {},
    });
  }
  if (path === "/api/account/team/accept") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const session = sessionById(bundle, call.sessionId);
    const guarded = guardSession(bundle, session, { csrfToken: call.csrfToken || "", claimedTenant: undefined, action: "settings:read", csrf: true });
    if (isReply(guarded)) return guarded;
    const user = bundle.accounts.users.find((row) => row.id === guarded.session.userId);
    if (!user) return fail(bundle, 401, "Sign in is required.");
    const accepted = acceptSeat(bundle, { userId: user.id, email: user.email, token: String(body.token || ""), now: call.now });
    if (!accepted.ok) return fail(accepted.bundle, 400, accepted.reason);
    return reply({
      bundle: accepted.bundle,
      status: 200,
      body: { ok: true, tenantId: accepted.invite?.tenantId, role: accepted.invite?.role },
      headers: {},
    });
  }
  if (path === "/api/account/team/role") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "members:write", true);
    if (isReply(gate)) return gate;
    return reply(changeMemberRole(bundle, gate.session, { userId: String(body.userId || ""), role: String(body.role || "") }));
  }
  if (path === "/api/account/team/remove") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "members:remove", true);
    if (isReply(gate)) return gate;
    return reply(removeMember(bundle, gate.session, String(body.userId || "")));
  }
  if (path === "/api/account/team/transfer") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "members:write", true);
    if (isReply(gate)) return gate;
    const moved = transferOwnership(bundle.fulfillment, gate.session.tenantId, gate.session.userId, String(body.userId || ""));
    if (!moved.ok) return fail(bundle, 400, moved.reason);
    const dropped: AccountBundle = {
      ...bundle,
      fulfillment: moved.state,
      accounts: {
        ...bundle.accounts,
        sessions: bundle.accounts.sessions.filter((row) => row.userId !== gate.session.userId && row.userId !== String(body.userId || "")),
      },
    };
    return reply(replaceUserSession(dropped, gate.session.userId, gate.session.tenantId, call.now));
  }
  if (path === "/api/account/team/switch") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const session = sessionById(bundle, call.sessionId);
    const guarded = guardSession(bundle, session, { csrfToken: call.csrfToken || "", claimedTenant: undefined, action: "settings:read", csrf: true });
    if (isReply(guarded)) return guarded;
    return reply(replaceUserSession(bundle, guarded.session.userId, String(body.targetTenantId || ""), call.now));
  }

  if (path === "/api/account/workspace/export") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "workspace:export", true);
    if (isReply(gate)) return gate;
    const exported = exportWorkspace(bundle, gate.session.tenantId, call.now);
    if (!exported.ok) return fail(bundle, 404, exported.reason);
    return reply({ bundle, status: 200, body: exported.body, headers: {} });
  }
  if (path === "/api/account/workspace/close") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "workspace:close", true);
    if (isReply(gate)) return gate;
    const closedWorkspace = closeWorkspace(bundle, gate.session.tenantId, call.now, newId());
    if (!closedWorkspace.ok) return fail(closedWorkspace.bundle, 400, closedWorkspace.reason);
    return reply({
      bundle: closedWorkspace.bundle,
      status: 200,
      body: { ok: true, restoreUntil: closedWorkspace.restoreUntil },
      headers: { "Set-Cookie": clearSessionCookie() },
    });
  }
  if (path === "/api/account/workspace/restore") {
    if (method !== "POST") return fail(bundle, 405, "That request is not available.");
    const gate = authed(bundle, call, "workspace:restore", true);
    if (isReply(gate)) return gate;
    const restored = restoreWorkspace(bundle, gate.session.tenantId, call.now);
    if (!restored.ok) return fail(restored.bundle, 400, restored.reason);
    return reply({ bundle: restored.bundle, status: 200, body: { ok: true }, headers: {} });
  }
  return null;
}

function scaffoldView(state: AccountBundle["fulfillment"], tenantId: string, now: string) {
  const workspace = workspaceFor(state, tenantId);
  const sub = subscriptionFor(state, tenantId);
  const plan = sub ? scaffoldPlan(sub.planId) : null;
  const usage = usageFor(state, tenantId);
  return {
    planId: sub?.planId || null,
    planName: plan?.name || null,
    status: sub?.status || null,
    seatLimit: plan?.seatLimit ?? null,
    seatsUsed: seatsInUse(state, tenantId, now),
    clientLimit: plan?.clientLimit ?? null,
    clients: state.clients.filter((row) => row.tenantId === tenantId).length,
    enrollments: usage.enrollments,
    pipelineRuns: usage.pipelineRuns,
    graceUntil: sub?.graceUntil || null,
    amountCents: 0 as const,
    billingMode: "test" as const,
    closedAt: workspace?.closedAt || null,
  };
}

function readScaffold(bundle: AccountBundle, session: AccountSession, now: string): FlowResult {
  return reply({
    bundle,
    status: 200,
    body: {
      ok: true,
      csrfToken: session.csrfToken,
      billing: scaffoldView(bundle.fulfillment, session.tenantId, now),
      plans: listScaffoldPlans().map((plan) => ({
        id: plan.id,
        name: plan.name,
        seatLimit: plan.seatLimit,
        clientLimit: plan.clientLimit,
        summary: plan.summary,
        amountCents: 0,
      })),
    },
    headers: {},
  });
}

function readTeam(bundle: AccountBundle, session: AccountSession, now: string): FlowResult {
  const members = (bundle.fulfillment.memberships || [])
    .filter((row) => row.tenantId === session.tenantId)
    .map((row) => ({ userId: row.userId, email: row.email, role: row.role }));
  const invites = (bundle.fulfillment.seatInvites || [])
    .filter((row) => row.tenantId === session.tenantId)
    .map((row) => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt, used: Boolean(row.usedAt) }));
  return reply({
    bundle,
    status: 200,
    body: {
      ok: true,
      csrfToken: session.csrfToken,
      role: session.role,
      members,
      invites,
      seats: { used: seatsInUse(bundle.fulfillment, session.tenantId, now), limit: seatLimitFor(bundle.fulfillment, session.tenantId) },
    },
    headers: {},
  });
}
