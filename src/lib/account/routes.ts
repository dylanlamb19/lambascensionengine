import {
  addFirstClient,
  addFirstPackage,
  changeMemberRole,
  choosePlan,
  completePasswordReset,
  guardSession,
  inviteMember,
  listMembers,
  loginAccount,
  logoutAccount,
  mintCsrf,
  readBilling,
  readClientView,
  readLogo,
  readOnboarding,
  readSettings,
  readShell,
  removeMember,
  requestPasswordReset,
  requestSignup,
  sessionById,
  storeLogo,
  updateBranding,
  updateWorkspaceSettings,
  verifySignup,
} from "./flow.ts";
import type { AccountAction } from "./rbac.ts";
import { tryMarketerProductRoute, tryOperatorRoute } from "../product/routes.ts";
import { tryLayerRoute, type LayerFlags } from "../subscription/dispatch.ts";
import type { AccountBundle, AccountSession } from "./types.ts";
import { emptyBundle } from "./types.ts";

export type AccountCall = {
  method: string;
  path: string;
  now: string;
  ip?: string;
  enabled: boolean;
  sessionId?: string | null;
  csrfToken?: string | null;
  signature?: string | null;
  flags?: Partial<LayerFlags>;
  body?: Record<string, unknown> | null;
};

export type AccountReply = {
  bundle: AccountBundle;
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

const CLOSED = "Signup is closed.";

function closed(bundle: AccountBundle): AccountReply {
  return { bundle, status: 404, body: { ok: false, reason: CLOSED }, headers: {} };
}

function plain(result: { bundle: AccountBundle; status: number; body: Record<string, unknown>; headers: Record<string, string> }): AccountReply {
  return result;
}

function authed(
  bundle: AccountBundle,
  call: AccountCall,
  action: AccountAction,
  csrf: boolean,
): { bundle: AccountBundle; session: AccountSession } | AccountReply {
  const session = sessionById(bundle, call.sessionId);
  const guarded = guardSession(bundle, session, {
    csrfToken: call.csrfToken || "",
    claimedTenant: call.body?.tenantId,
    action,
    csrf,
  });
  if ("status" in guarded) return guarded;
  return { bundle, session: guarded.session };
}

function isReply(value: { bundle: AccountBundle; session: AccountSession } | AccountReply): value is AccountReply {
  return "status" in value;
}

function layerFlags(call: AccountCall): LayerFlags {
  return {
    billing: call.flags?.billing === true,
    team: call.flags?.team === true,
    lifecycle: call.flags?.lifecycle === true,
    entitlements: call.flags?.entitlements === true,
    wizard: call.flags?.wizard === true,
    operator: call.flags?.operator === true,
  };
}

export function dispatchAccountRoute(bundle: AccountBundle, call: AccountCall): AccountReply {
  const flags = layerFlags(call);
  const operator = tryOperatorRoute(bundle, { ...call, flags });
  if (operator) return operator;
  if (!call.enabled) return closed(bundle);
  const [pathOnly, query = ""] = (call.path || "").split("?");
  const path = pathOnly || "";
  const method = call.method.toUpperCase();
  const parsed = call.body || {};
  const queryTenant = new URLSearchParams(query).get("tenantId");
  const body = queryTenant && parsed.tenantId == null ? { ...parsed, tenantId: queryTenant } : parsed;
  const now = call.now;
  const ip = call.ip || "";
  const csrfToken = call.csrfToken || (typeof body.csrfToken === "string" ? body.csrfToken : "");

  if (method === "GET" && path === "/api/account/csrf") return plain(mintCsrf(bundle, now));

  if (method !== "GET" && method !== "POST") {
    return { bundle, status: 405, body: { ok: false, reason: "That request is not available." }, headers: {} };
  }

  if (method === "POST" && path === "/api/account/signup") {
    return plain(requestSignup(bundle, {
      email: String(body.email || ""),
      password: String(body.password || ""),
      name: String(body.name || ""),
      workspaceName: String(body.workspaceName || ""),
      ip,
      now,
      csrfToken,
    }));
  }
  if (method === "POST" && path === "/api/account/verify") {
    return plain(verifySignup(bundle, { email: String(body.email || ""), token: String(body.token || ""), ip, now, csrfToken }));
  }
  if (method === "POST" && path === "/api/account/login") {
    return plain(loginAccount(bundle, { email: String(body.email || ""), password: String(body.password || ""), ip, now, csrfToken }));
  }
  if (method === "POST" && path === "/api/account/reset/request") {
    return plain(requestPasswordReset(bundle, { email: String(body.email || ""), ip, now, csrfToken }));
  }
  if (method === "POST" && path === "/api/account/reset/complete") {
    return plain(completePasswordReset(bundle, {
      email: String(body.email || ""),
      token: String(body.token || ""),
      password: String(body.password || ""),
      now,
      csrfToken,
    }));
  }

  const layered = tryLayerRoute(bundle, {
    method,
    path,
    now,
    sessionId: call.sessionId,
    csrfToken,
    signature: call.signature,
    body,
    flags,
  });
  if (layered) return layered;
  const product = tryMarketerProductRoute(bundle, { ...call, flags, csrfToken, body });
  if (product) return product;

  const map: Record<string, { method: "GET" | "POST"; action: AccountAction }> = {
    "/api/account/settings": { method: method === "POST" ? "POST" : "GET", action: method === "POST" ? "settings:write" : "settings:read" },
    "/api/account/branding": { method: "POST", action: "settings:write" },
    "/api/account/logo": { method: method === "POST" ? "POST" : "GET", action: method === "POST" ? "settings:write" : "settings:read" },
    "/api/account/members": { method: "GET", action: "settings:read" },
    "/api/account/members/role": { method: "POST", action: "members:write" },
    "/api/account/members/remove": { method: "POST", action: "members:remove" },
    "/api/account/billing": { method: "GET", action: "billing:read" },
    "/api/account/billing/plan": { method: "POST", action: "billing:write" },
    "/api/account/invites": { method: "POST", action: "invite" },
    "/api/account/onboarding": { method: "GET", action: "settings:read" },
    "/api/account/onboarding/client": { method: "POST", action: "settings:write" },
    "/api/account/onboarding/package": { method: "POST", action: "settings:write" },
    "/api/account/shell": { method: "GET", action: "settings:read" },
    "/api/account/client-view": { method: "GET", action: "settings:read" },
    "/api/account/logout": { method: "POST", action: "settings:read" },
  };
  const spec = map[path];
  if (!spec || (path !== "/api/account/settings" && path !== "/api/account/logo" && spec.method !== method)) {
    if (spec && spec.method !== method) {
      return { bundle, status: 405, body: { ok: false, reason: "That request is not available." }, headers: {} };
    }
    return { bundle, status: 404, body: { ok: false, reason: "That page is not available." }, headers: {} };
  }
  if ((path === "/api/account/settings" || path === "/api/account/logo") && method !== "GET" && method !== "POST") {
    return { bundle, status: 405, body: { ok: false, reason: "That request is not available." }, headers: {} };
  }

  const gate = authed(bundle, { ...call, csrfToken, body }, spec.action, method !== "GET");
  if (isReply(gate)) return gate;
  const session = gate.session;

  if (path === "/api/account/logout") return plain(logoutAccount(gate.bundle, session));
  if (path === "/api/account/settings" && method === "GET") return plain(readSettings(gate.bundle, session));
  if (path === "/api/account/settings") {
    return plain(updateWorkspaceSettings(gate.bundle, session, {
      name: typeof body.name === "string" ? body.name : undefined,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      now,
    }));
  }
  if (path === "/api/account/branding") {
    return plain(updateBranding(gate.bundle, session, {
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : undefined,
      primary: typeof body.primary === "string" ? body.primary : undefined,
      accent: typeof body.accent === "string" ? body.accent : undefined,
      senderDisplayName: typeof body.senderDisplayName === "string" ? body.senderDisplayName : undefined,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
    }));
  }
  if (path === "/api/account/logo" && method === "GET") return plain(readLogo(gate.bundle, session));
  if (path === "/api/account/logo") {
    return plain(storeLogo(gate.bundle, session, {
      contentType: String(body.contentType || ""),
      dataBase64: String(body.dataBase64 || ""),
      now,
    }));
  }
  if (path === "/api/account/members") return plain(listMembers(gate.bundle, session));
  if (path === "/api/account/members/role") {
    return plain(changeMemberRole(gate.bundle, session, { userId: String(body.userId || ""), role: String(body.role || "") }));
  }
  if (path === "/api/account/members/remove") return plain(removeMember(gate.bundle, session, String(body.userId || "")));
  if (path === "/api/account/billing") return plain(readBilling(gate.bundle, session));
  if (path === "/api/account/billing/plan") return plain(choosePlan(gate.bundle, session, String(body.planId || ""), now));
  if (path === "/api/account/invites") return plain(inviteMember(gate.bundle, session, String(body.email || ""), now));
  if (path === "/api/account/onboarding") return plain(readOnboarding(gate.bundle, session));
  if (path === "/api/account/onboarding/client") return plain(addFirstClient(gate.bundle, session, String(body.name || ""), now));
  if (path === "/api/account/onboarding/package") {
    return plain(addFirstPackage(gate.bundle, session, {
      clientName: String(body.clientName || ""),
      packageId: String(body.packageId || ""),
      now,
    }));
  }
  if (path === "/api/account/shell") return plain(readShell(gate.bundle, session));
  if (path === "/api/account/client-view") return plain(readClientView(gate.bundle, session));
  return { bundle, status: 404, body: { ok: false, reason: "That page is not available." }, headers: {} };
}

export function previewBundle(): AccountBundle {
  return emptyBundle();
}
