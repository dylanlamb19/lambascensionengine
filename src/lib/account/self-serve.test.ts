import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { EMAIL_PASSWORD_SIGN_UP_DISABLED, emailAndPasswordConfig } from "../auth/email-password.ts";
import { FLAGS } from "../flags.ts";
import { workspaceIdForUser, startMarketerOnboarding } from "../packages/tenancy.ts";
import { EMPTY_FULFILLMENT, type Workspace } from "../packages/types.ts";
import { clientFacingBrand, shellBrandStyle } from "./brand.ts";
import { cookieHasSecureFlags, hashPassword } from "./crypto.ts";
import { openVerifiedWorkspace } from "./flow.ts";
import { handleAccountHttp } from "./http.ts";
import { dispatchAccountRoute, type AccountCall, type AccountReply } from "./routes.ts";
import { emptyBundle, type AccountBundle, type AccountSession } from "./types.ts";

const NOW = "2026-11-21T18:00:00.000Z";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function call(bundle: AccountBundle, input: Partial<AccountCall> & Pick<AccountCall, "method" | "path">): AccountReply {
  return dispatchAccountRoute(bundle, {
    now: NOW,
    ip: "203.0.113.10",
    enabled: true,
    body: {},
    ...input,
  });
}

function csrf(bundle: AccountBundle, ip = "203.0.113.10") {
  const reply = call(bundle, { method: "GET", path: "/api/account/csrf", ip });
  assert.equal(reply.status, 200);
  return { bundle: reply.bundle, token: String(reply.body.csrfToken) };
}

function codeOf(bundle: AccountBundle): string {
  const body = bundle.accounts.mail[bundle.accounts.mail.length - 1]?.body || "";
  const found = body.match(/code: ([a-f0-9]{64})/);
  assert.ok(found, "dry-run note should carry a code");
  return found[1];
}

function sessionId(reply: AccountReply): string {
  const header = reply.headers["Set-Cookie"] || "";
  const raw = header.split(";")[0]?.split("=").slice(1).join("=") || "";
  return decodeURIComponent(raw);
}

function register(bundle: AccountBundle, input: { email: string; workspaceName: string; ip: string; password?: string }) {
  const password = input.password || "correct-horse-9";
  const first = csrf(bundle, input.ip);
  const signed = call(first.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: input.ip,
    csrfToken: first.token,
    body: { email: input.email, password, name: "Ada", workspaceName: input.workspaceName, csrfToken: first.token },
  });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.reason, "Verification recorded. Nothing was sent.");
  assert.equal(JSON.stringify(signed.body).includes(codeOf(signed.bundle)), false);
  assert.equal(signed.bundle.accounts.mail.at(-1)?.mode, "dry_run");
  const second = csrf(signed.bundle, input.ip);
  const verified = call(second.bundle, {
    method: "POST",
    path: "/api/account/verify",
    ip: input.ip,
    csrfToken: second.token,
    body: { email: input.email, token: codeOf(signed.bundle), csrfToken: second.token },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const id = sessionId(verified);
  assert.equal(cookieHasSecureFlags(verified.headers["Set-Cookie"] || ""), true);
  return {
    bundle: verified.bundle,
    sessionId: id,
    csrfToken: String(verified.body.csrfToken),
    tenantId: String(verified.body.tenantId),
    email: input.email.toLowerCase(),
    password,
  };
}

test("self-serve signup stays off with the flag and Better Auth registration stays closed", async () => {
  assert.equal(FLAGS.SELF_SERVE_SIGNUP, false);
  assert.equal(EMAIL_PASSWORD_SIGN_UP_DISABLED, true);
  assert.equal(emailAndPasswordConfig.disableSignUp, true);
  const bundle = emptyBundle();
  const closed = call(bundle, { method: "POST", path: "/api/account/signup", enabled: false, body: { email: "a@example.com" } });
  assert.equal(closed.status, 404);
  assert.equal(closed.body.reason, "Signup is closed.");
  assert.equal(closed.bundle, bundle);
  const http = await handleAccountHttp(new Request("http://127.0.0.1/api/account/signup", { method: "POST", body: "{}" }), false, bundle);
  assert.equal(http.response.status, 404);
  assert.equal(http.bundle, bundle);
  const mail = readFileSync(join(root, "src/lib/account/mail.ts"), "utf8");
  const flow = readFileSync(join(root, "src/lib/account/flow.ts"), "utf8");
  assert.match(mail, /dry_run/);
  assert.doesNotMatch(mail, /sendMail|live\.server|from ["']@\/lib\/mail/);
  assert.doesNotMatch(flow, /process\.env|STRIPE|sk_live|sk_test/);
  assert.doesNotMatch(readFileSync(join(root, "src/lib/auth/email-password.ts"), "utf8"), /disableSignUp:\s*false/);
});

test("signup verifies, opens one workspace and owner membership, and rejects bad input", () => {
  const started = csrf(emptyBundle(), "203.0.113.20");
  const missing = call(started.bundle, { method: "POST", path: "/api/account/signup", ip: "203.0.113.20", body: { email: "ada@example.com", password: "correct-horse-9", workspaceName: "Ada Studio" } });
  assert.equal(missing.status, 403);
  assert.equal(missing.bundle.accounts.pending.length, 0);
  const wrong = call(started.bundle, { method: "POST", path: "/api/account/signup", ip: "203.0.113.20", csrfToken: "nope", body: { email: "ada@example.com", password: "correct-horse-9", workspaceName: "Ada Studio" } });
  assert.equal(wrong.status, 403);
  const weak = call(started.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.21",
    csrfToken: csrf(started.bundle, "203.0.113.21").token,
    body: { email: "ada@example.com", password: "short", workspaceName: "Ada Studio", csrfToken: "x" },
  });
  assert.equal(weak.status, 403);
  const fresh = csrf(emptyBundle(), "203.0.113.22");
  const weakPassword = call(fresh.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.22",
    csrfToken: fresh.token,
    body: { email: "ada@example.com", password: "short", workspaceName: "Ada Studio", csrfToken: fresh.token },
  });
  assert.equal(weakPassword.status, 400);
  assert.equal(weakPassword.bundle.accounts.users.length, 0);
  const disposableToken = csrf(weakPassword.bundle, "203.0.113.22");
  const disposable = call(disposableToken.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.22",
    csrfToken: disposableToken.token,
    body: { email: "ada@mailinator.com", password: "correct-horse-9", workspaceName: "Ada Studio", csrfToken: disposableToken.token },
  });
  assert.equal(disposable.status, 400);
  assert.match(String(disposable.body.reason), /permanent email/);
  assert.equal(disposable.bundle.accounts.pending.length, 0);
  const opened = register(disposable.bundle, { email: "Ada@Example.com", workspaceName: "Ada Studio", ip: "203.0.113.23" });
  assert.equal(opened.bundle.accounts.users.length, 1);
  assert.equal(opened.bundle.accounts.users[0]?.emailVerified, true);
  assert.equal(opened.bundle.fulfillment.workspaces.length, 1);
  assert.equal(opened.bundle.fulfillment.workspaces[0]?.ownerUserId, opened.bundle.accounts.users[0]?.id);
  const membership = opened.bundle.fulfillment.memberships.find((row) => row.tenantId === opened.tenantId);
  assert.equal(membership?.role, "owner");
  assert.equal(opened.bundle.accounts.pending.length, 0);
  const againToken = csrf(opened.bundle, "203.0.113.24");
  const duplicate = call(againToken.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.24",
    csrfToken: againToken.token,
    body: { email: "ada@example.com", password: "correct-horse-9", workspaceName: "Other", csrfToken: againToken.token },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.reason, "That email is already registered.");
  assert.equal(duplicate.bundle.accounts.users.length, 1);
  assert.equal(duplicate.bundle.fulfillment.workspaces.length, 1);
  assert.doesNotMatch(JSON.stringify(duplicate.body), /Ada Studio|password/);
  const once = csrf(duplicate.bundle, "203.0.113.25");
  const accepted = call(once.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.25",
    csrfToken: once.token,
    body: { email: "second@example.com", password: "correct-horse-9", workspaceName: "Second", csrfToken: once.token },
  });
  assert.equal(accepted.status, 200);
  const replay = call(accepted.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.26",
    csrfToken: once.token,
    body: { email: "third@example.com", password: "correct-horse-9", workspaceName: "Third", csrfToken: once.token },
  });
  assert.equal(replay.status, 403);
  assert.equal(replay.bundle.accounts.pending.some((row) => row.email === "third@example.com"), false);
});

test("verification failure and a collided workspace leave no partial account", () => {
  const opened = csrf(emptyBundle(), "203.0.113.30");
  const signed = call(opened.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.30",
    csrfToken: opened.token,
    body: { email: "ada@example.com", password: "correct-horse-9", name: "Ada", workspaceName: "Ada Studio", csrfToken: opened.token },
  });
  const token = csrf(signed.bundle, "203.0.113.30");
  const bad = call(token.bundle, {
    method: "POST",
    path: "/api/account/verify",
    ip: "203.0.113.30",
    csrfToken: token.token,
    body: { email: "ada@example.com", token: "0".repeat(64), csrfToken: token.token },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.bundle.accounts.users.length, 0);
  assert.equal(bad.bundle.fulfillment.workspaces.length, 0);
  const pending = signed.bundle.accounts.pending[0];
  assert.ok(pending);
  const expired = { ...signed.bundle, accounts: { ...signed.bundle.accounts, pending: [{ ...pending, expiresAt: "2020-01-01T00:00:00.000Z" }] } };
  const later = csrf(expired, "203.0.113.31");
  const stale = call(later.bundle, {
    method: "POST",
    path: "/api/account/verify",
    ip: "203.0.113.31",
    csrfToken: later.token,
    body: { email: "ada@example.com", token: codeOf(signed.bundle), csrfToken: later.token },
  });
  assert.equal(stale.status, 400);
  assert.equal(stale.bundle.accounts.users.length, 0);
  const userId = "collision-user";
  const tenantId = workspaceIdForUser(userId);
  assert.ok(tenantId);
  const plantedBase = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "someone-else", workspaceName: "Planted", now: NOW });
  assert.equal(plantedBase.ok, true);
  if (!plantedBase.ok || !tenantId) return;
  const planted: Workspace = { ...plantedBase.workspace, id: tenantId, ownerUserId: "someone-else", name: "Planted" };
  const bundle: AccountBundle = {
    accounts: signed.bundle.accounts,
    fulfillment: { ...EMPTY_FULFILLMENT, workspaces: [planted] },
  };
  const blocked = openVerifiedWorkspace(bundle, pending, NOW, userId);
  assert.equal(blocked, null);
  assert.equal(bundle.accounts.users.length, 0);
  assert.equal(bundle.fulfillment.workspaces.length, 1);
  assert.equal(bundle.fulfillment.workspaces[0]?.name, "Planted");
});

test("login rotates the session and password reset invalidates the previous one", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.40" });
  const before = ada.bundle.accounts.users[0]?.passwordHash || "";
  const quietToken = csrf(ada.bundle, "203.0.113.41");
  const unknown = call(quietToken.bundle, {
    method: "POST",
    path: "/api/account/reset/request",
    ip: "203.0.113.41",
    csrfToken: quietToken.token,
    body: { email: "missing@example.com", csrfToken: quietToken.token },
  });
  assert.equal(unknown.status, 200);
  assert.match(String(unknown.body.reason), /If that email is registered/);
  assert.equal(unknown.bundle.accounts.mail.filter((row) => row.kind === "reset").length, 0);
  const resetToken = csrf(unknown.bundle, "203.0.113.41");
  const requested = call(resetToken.bundle, {
    method: "POST",
    path: "/api/account/reset/request",
    ip: "203.0.113.41",
    csrfToken: resetToken.token,
    body: { email: "ada@example.com", csrfToken: resetToken.token },
  });
  assert.equal(requested.status, 200);
  assert.equal(JSON.stringify(requested.body).includes(codeOf(requested.bundle)), false);
  const completeToken = csrf(requested.bundle, "203.0.113.41");
  const completed = call(completeToken.bundle, {
    method: "POST",
    path: "/api/account/reset/complete",
    ip: "203.0.113.41",
    csrfToken: completeToken.token,
    body: { email: "ada@example.com", token: codeOf(requested.bundle), password: "new-horse-99", csrfToken: completeToken.token },
  });
  assert.equal(completed.status, 200);
  assert.equal(cookieHasSecureFlags(completed.headers["Set-Cookie"] || ""), true);
  assert.notEqual(completed.bundle.accounts.users[0]?.passwordHash, before);
  const oldSession = call(completed.bundle, { method: "GET", path: "/api/account/settings", sessionId: ada.sessionId });
  assert.equal(oldSession.status, 401);
  const reusedToken = csrf(completed.bundle, "203.0.113.42");
  const reused = call(reusedToken.bundle, {
    method: "POST",
    path: "/api/account/reset/complete",
    ip: "203.0.113.42",
    csrfToken: reusedToken.token,
    body: { email: "ada@example.com", token: codeOf(requested.bundle), password: "another-horse-1", csrfToken: reusedToken.token },
  });
  assert.equal(reused.status, 400);
  assert.equal(reused.bundle.accounts.users[0]?.passwordHash, completed.bundle.accounts.users[0]?.passwordHash);
  const loginToken = csrf(completed.bundle, "203.0.113.43");
  const badLogin = call(loginToken.bundle, {
    method: "POST",
    path: "/api/account/login",
    ip: "203.0.113.43",
    csrfToken: loginToken.token,
    body: { email: "ada@example.com", password: "correct-horse-9", csrfToken: loginToken.token },
  });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.body.reason, "Email or password is wrong.");
  const goodToken = csrf(badLogin.bundle, "203.0.113.44");
  const first = call(goodToken.bundle, {
    method: "POST",
    path: "/api/account/login",
    ip: "203.0.113.44",
    csrfToken: goodToken.token,
    body: { email: "ada@example.com", password: "new-horse-99", csrfToken: goodToken.token },
  });
  assert.equal(first.status, 200);
  const secondToken = csrf(first.bundle, "203.0.113.45");
  const second = call(secondToken.bundle, {
    method: "POST",
    path: "/api/account/login",
    ip: "203.0.113.45",
    csrfToken: secondToken.token,
    body: { email: "ada@example.com", password: "new-horse-99", csrfToken: secondToken.token },
  });
  assert.equal(second.status, 200);
  assert.notEqual(sessionId(second), sessionId(first));
  const rotatedAway = call(second.bundle, { method: "GET", path: "/api/account/settings", sessionId: sessionId(first) });
  assert.equal(rotatedAway.status, 401);
  const current = call(second.bundle, { method: "GET", path: "/api/account/settings", sessionId: sessionId(second) });
  assert.equal(current.status, 200);
});

test("csrf, rbac, and owner protection hold on settings, billing, and invites", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.50" });
  const member = attach(ada.bundle, ada.tenantId, "member");
  const admin = attach(member.bundle, ada.tenantId, "admin");
  const bundle = admin.bundle;
  const noToken = call(bundle, {
    method: "POST",
    path: "/api/account/branding",
    sessionId: ada.sessionId,
    body: { primary: "#112233", senderDisplayName: "Ada" },
  });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.bundle, bundle);
  const memberWrite = call(bundle, {
    method: "POST",
    path: "/api/account/settings",
    sessionId: member.sessionId,
    csrfToken: member.csrfToken,
    body: { name: "Hijack", csrfToken: member.csrfToken },
  });
  assert.equal(memberWrite.status, 403);
  assert.equal(memberWrite.bundle.fulfillment.workspaces[0]?.name, "Ada Studio");
  const memberBill = call(bundle, {
    method: "POST",
    path: "/api/account/billing/plan",
    sessionId: member.sessionId,
    csrfToken: member.csrfToken,
    body: { planId: "test_agency", csrfToken: member.csrfToken },
  });
  assert.equal(memberBill.status, 403);
  const memberInvite = call(bundle, {
    method: "POST",
    path: "/api/account/invites",
    sessionId: member.sessionId,
    csrfToken: member.csrfToken,
    body: { email: "guest@example.com", csrfToken: member.csrfToken },
  });
  assert.equal(memberInvite.status, 403);
  assert.equal(memberInvite.bundle.fulfillment.invites.length, 0);
  const adminBill = call(bundle, {
    method: "POST",
    path: "/api/account/billing/plan",
    sessionId: admin.sessionId,
    csrfToken: admin.csrfToken,
    body: { planId: "test_agency", csrfToken: admin.csrfToken },
  });
  assert.equal(adminBill.status, 403);
  const adminRole = call(bundle, {
    method: "POST",
    path: "/api/account/members/role",
    sessionId: admin.sessionId,
    csrfToken: admin.csrfToken,
    body: { userId: member.userId, role: "admin", csrfToken: admin.csrfToken },
  });
  assert.equal(adminRole.status, 403);
  const branded = call(bundle, {
    method: "POST",
    path: "/api/account/branding",
    sessionId: admin.sessionId,
    csrfToken: admin.csrfToken,
    body: { primary: "#112233", accent: "#d97706", senderDisplayName: "Ada Desk", timezone: "America/Chicago", csrfToken: admin.csrfToken },
  });
  assert.equal(branded.status, 200);
  assert.equal(branded.bundle.fulfillment.workspaces[0]?.senderDisplayName, "Ada Desk");
  const invited = call(branded.bundle, {
    method: "POST",
    path: "/api/account/invites",
    sessionId: admin.sessionId,
    csrfToken: admin.csrfToken,
    body: { email: "guest@example.com", csrfToken: admin.csrfToken },
  });
  assert.equal(invited.status, 200);
  assert.equal(invited.bundle.fulfillment.invites[0]?.tenantId, ada.tenantId);
  const ownerId = branded.bundle.accounts.users[0]?.id || "";
  const demote = call(invited.bundle, {
    method: "POST",
    path: "/api/account/members/role",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { userId: ownerId, role: "member", csrfToken: ada.csrfToken },
  });
  assert.equal(demote.status, 403);
  assert.equal(demote.body.reason, "The owner cannot be changed.");
  const removeOwner = call(invited.bundle, {
    method: "POST",
    path: "/api/account/members/remove",
    sessionId: admin.sessionId,
    csrfToken: admin.csrfToken,
    body: { userId: ownerId, csrfToken: admin.csrfToken },
  });
  assert.equal(removeOwner.status, 403);
  assert.equal(removeOwner.bundle.fulfillment.memberships.some((row) => row.userId === ownerId), true);
  const promoted = call(invited.bundle, {
    method: "POST",
    path: "/api/account/members/role",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { userId: member.userId, role: "admin", csrfToken: ada.csrfToken },
  });
  assert.equal(promoted.status, 200);
  const memberSession = call(promoted.bundle, { method: "GET", path: "/api/account/settings", sessionId: member.sessionId });
  assert.equal(memberSession.status, 401);
  const planned = call(promoted.bundle, {
    method: "POST",
    path: "/api/account/billing/plan",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "test_operator", csrfToken: ada.csrfToken },
  });
  assert.equal(planned.status, 200);
  const billing = planned.body.billing as { amountCents: number; planId: string };
  assert.equal(billing.amountCents, 0);
  assert.equal(billing.planId, "test_operator");
  assert.equal(planned.bundle.fulfillment.invoices.every((row) => row.amountCents === 0), true);
  const live = call(planned.bundle, {
    method: "POST",
    path: "/api/account/billing/plan",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "price_live", csrfToken: ada.csrfToken },
  });
  assert.equal(live.status, 400);
  assert.equal(live.bundle.fulfillment.workspaces[0]?.planId, "test_operator");
});

test("a user in workspace A cannot read or write workspace B", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.60" });
  const bo = register(ada.bundle, { email: "bo@example.com", workspaceName: "Prairie Secret", ip: "198.51.100.20" });
  const painted = call(bo.bundle, {
    method: "POST",
    path: "/api/account/branding",
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { primary: "#445566", accent: "#998877", senderDisplayName: "Prairie Desk", logoUrl: "https://prairie.example/logo.png", timezone: "America/Denver", csrfToken: bo.csrfToken },
  });
  assert.equal(painted.status, 200);
  const logo = call(painted.bundle, {
    method: "POST",
    path: "/api/account/logo",
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { contentType: "image/png", dataBase64: "QkJCQkI=", csrfToken: bo.csrfToken },
  });
  assert.equal(logo.status, 200);
  const before = JSON.stringify({
    workspace: logo.bundle.fulfillment.workspaces.find((row) => row.id === bo.tenantId),
    clients: logo.bundle.fulfillment.clients.filter((row) => row.tenantId === bo.tenantId),
    invites: logo.bundle.fulfillment.invites.filter((row) => row.tenantId === bo.tenantId),
    invoices: logo.bundle.fulfillment.invoices.filter((row) => row.tenantId === bo.tenantId),
    logo: logo.bundle.accounts.logos.find((row) => row.tenantId === bo.tenantId),
  });
  const writes = [
    { path: "/api/account/settings", body: { name: "Stolen", tenantId: bo.tenantId } },
    { path: "/api/account/branding", body: { primary: "#000000", senderDisplayName: "Stolen", tenantId: bo.tenantId } },
    { path: "/api/account/logo", body: { contentType: "image/png", dataBase64: "QUFBQQ==", tenantId: bo.tenantId } },
    { path: "/api/account/members/role", body: { userId: "nope", role: "member", tenantId: bo.tenantId } },
    { path: "/api/account/members/remove", body: { userId: logo.bundle.accounts.users[1]?.id, tenantId: bo.tenantId } },
    { path: "/api/account/billing/plan", body: { planId: "test_agency", tenantId: bo.tenantId } },
    { path: "/api/account/invites", body: { email: "spy@example.com", tenantId: bo.tenantId } },
    { path: "/api/account/onboarding/client", body: { name: "Hidden", tenantId: bo.tenantId } },
    { path: "/api/account/onboarding/package", body: { clientName: "Hidden", packageId: "lead-follow-up", tenantId: bo.tenantId } },
  ];
  for (const write of writes) {
    const reply = call(logo.bundle, {
      method: "POST",
      path: write.path,
      sessionId: ada.sessionId,
      csrfToken: ada.csrfToken,
      body: { ...write.body, csrfToken: ada.csrfToken },
    });
    assert.equal(reply.status, 403, write.path);
    assert.equal(reply.body.reason, "That workspace is not yours.");
    assert.equal(reply.bundle, logo.bundle, write.path);
  }
  const reads = ["/api/account/settings", "/api/account/billing", "/api/account/members", "/api/account/shell", "/api/account/client-view", "/api/account/logo", "/api/account/onboarding"];
  for (const path of reads) {
    const reply = call(logo.bundle, { method: "GET", path: `${path}?tenantId=${bo.tenantId}`, sessionId: ada.sessionId });
    assert.equal(reply.status, 403, path);
    assert.doesNotMatch(JSON.stringify(reply.body), /Prairie|QkJCQkI|445566/);
  }
  const own = call(logo.bundle, { method: "GET", path: "/api/account/client-view", sessionId: ada.sessionId });
  assert.equal(own.status, 200);
  assert.equal(own.body.tenantId, ada.tenantId);
  assert.doesNotMatch(JSON.stringify(own.body), /Prairie|QkJCQkI|#445566/);
  const shell = shellBrandStyle(logo.bundle.fulfillment, ada.tenantId, true);
  assert.equal(JSON.stringify(shell || {}).includes("445566"), false);
  const faced = clientFacingBrand(logo.bundle.fulfillment, bo.tenantId, true);
  assert.equal(faced?.senderDisplayName, "Prairie Desk");
  assert.equal(clientFacingBrand(logo.bundle.fulfillment, ada.tenantId)?.senderDisplayName, "Ada Studio");
  assert.equal(before, JSON.stringify({
    workspace: logo.bundle.fulfillment.workspaces.find((row) => row.id === bo.tenantId),
    clients: logo.bundle.fulfillment.clients.filter((row) => row.tenantId === bo.tenantId),
    invites: logo.bundle.fulfillment.invites.filter((row) => row.tenantId === bo.tenantId),
    invoices: logo.bundle.fulfillment.invoices.filter((row) => row.tenantId === bo.tenantId),
    logo: logo.bundle.accounts.logos.find((row) => row.tenantId === bo.tenantId),
  }));
  const forged: AccountSession = {
    id: "forged",
    userId: logo.bundle.accounts.users[0]?.id || "",
    tenantId: bo.tenantId,
    role: "owner",
    csrfToken: "forged-csrf",
    createdAt: NOW,
    rotatedFrom: null,
  };
  const forgedBundle: AccountBundle = { ...logo.bundle, accounts: { ...logo.bundle.accounts, sessions: [...logo.bundle.accounts.sessions, forged] } };
  const peek = call(forgedBundle, { method: "GET", path: "/api/account/settings", sessionId: "forged" });
  assert.equal(peek.status, 401);
  assert.doesNotMatch(JSON.stringify(peek.body), /Prairie/);
});

test("onboarding checklist records brand, a client, and a package for that workspace only", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.70" });
  const bo = register(ada.bundle, { email: "bo@example.com", workspaceName: "Bo Studio", ip: "198.51.100.30" });
  const plan = call(bo.bundle, {
    method: "POST",
    path: "/api/account/billing/plan",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "test_trial", csrfToken: ada.csrfToken },
  });
  assert.equal(plan.status, 200);
  const brand = call(plan.bundle, {
    method: "POST",
    path: "/api/account/branding",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { primary: "#1f6f5b", senderDisplayName: "Ada Desk", csrfToken: ada.csrfToken },
  });
  const client = call(brand.bundle, {
    method: "POST",
    path: "/api/account/onboarding/client",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { name: "North Roofing", csrfToken: ada.csrfToken },
  });
  const pack = call(client.bundle, {
    method: "POST",
    path: "/api/account/onboarding/package",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { clientName: "North Roofing", packageId: "lead-follow-up", csrfToken: ada.csrfToken },
  });
  assert.equal(pack.status, 200, JSON.stringify(pack.body));
  const checklist = pack.body.checklist as { brand: boolean; firstClient: boolean; firstPackage: boolean; complete: boolean };
  assert.deepEqual(checklist, { plan: true, brand: true, firstClient: true, firstPackage: true, complete: true });
  assert.equal(pack.bundle.fulfillment.clients.filter((row) => row.tenantId === bo.tenantId).length, 0);
  assert.equal(pack.bundle.fulfillment.enrollments.filter((row) => row.tenantId === bo.tenantId).length, 0);
  const javascriptLogo = call(pack.bundle, {
    method: "POST",
    path: "/api/account/branding",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { logoUrl: "javascript:alert(1)", csrfToken: ada.csrfToken },
  });
  assert.equal(javascriptLogo.status, 400);
});

test("signup and reset routes throttle by address and by email", () => {
  let bundle = emptyBundle();
  for (let i = 0; i < 5; i += 1) {
    const token = csrf(bundle, "203.0.113.80");
    const reply = call(token.bundle, {
      method: "POST",
      path: "/api/account/signup",
      ip: "203.0.113.80",
      csrfToken: token.token,
      body: { email: `person${i}@example.com`, password: "correct-horse-9", workspaceName: `Shop ${i}`, csrfToken: token.token },
    });
    assert.equal(reply.status, 200, String(i));
    bundle = reply.bundle;
  }
  const blockedToken = csrf(bundle, "203.0.113.80");
  const blocked = call(blockedToken.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: "203.0.113.80",
    csrfToken: blockedToken.token,
    body: { email: "person6@example.com", password: "correct-horse-9", workspaceName: "Shop 6", csrfToken: blockedToken.token },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.bundle.accounts.pending.length, 5);
  let resetBundle = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.90" }).bundle;
  for (let i = 0; i < 3; i += 1) {
    const token = csrf(resetBundle, "203.0.113.91");
    const reply = call(token.bundle, {
      method: "POST",
      path: "/api/account/reset/request",
      ip: "203.0.113.91",
      csrfToken: token.token,
      body: { email: "ada@example.com", csrfToken: token.token },
    });
    assert.equal(reply.status, 200);
    resetBundle = reply.bundle;
  }
  const limitedToken = csrf(resetBundle, "203.0.113.91");
  const limited = call(limitedToken.bundle, {
    method: "POST",
    path: "/api/account/reset/request",
    ip: "203.0.113.91",
    csrfToken: limitedToken.token,
    body: { email: "ada@example.com", csrfToken: limitedToken.token },
  });
  assert.equal(limited.status, 429);
});

test("the http route parses a signup request and row security hides the other workspace", async () => {
  const bundle = emptyBundle();
  const bad = await handleAccountHttp(new Request("http://127.0.0.1/api/account/signup", { method: "POST", body: "nope" }), true, bundle);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.bundle, bundle);
  const minted = await handleAccountHttp(new Request("http://127.0.0.1/api/account/csrf"), true, bundle);
  assert.equal(minted.response.status, 200);
  const payload = await minted.response.json() as { csrfToken: string };
  const posted = await handleAccountHttp(new Request("http://127.0.0.1/api/account/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": payload.csrfToken, "x-forwarded-for": "203.0.113.100" },
    body: JSON.stringify({ email: "ada@example.com", password: "correct-horse-9", name: "Ada", workspaceName: "Ada Studio", csrfToken: payload.csrfToken }),
  }), true, minted.bundle);
  assert.equal(posted.response.status, 200);
  assert.equal(posted.bundle.accounts.mail[0]?.mode, "dry_run");
  assert.equal(posted.bundle.accounts.users.length, 0);

  const pg = new PGlite();
  for (const name of ["0015_client_packages.sql", "0016_workspace_connections.sql", "0017_tenant_rls.sql", "0018_lead_follow_up.sql", "0019_lead_gen_ai_visibility.sql", "0020_reviews_appointments.sql", "0021_estimate_google_ads.sql", "0022_meta_office_bundle.sql", "0023_self_serve_signup.sql", "0024_subscription_team.sql"]) {
    await pg.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into marketer_workspaces (id, owner_user_id, name) values ('ws_a', 'a', 'A'), ('ws_b', 'b', 'B');
    insert into workspace_branding (workspace_id, logo_url, brand_primary, brand_accent, sender_display_name, timezone)
      values ('ws_a', 'https://a.example/logo.png', '#112233', '#abcdef', 'A Studio', 'America/Chicago'),
             ('ws_b', 'https://b.example/logo.png', '#445566', '#fedcba', 'B Studio', 'America/Denver');
    insert into workspace_logos (workspace_id, content_type, data_base64) values ('ws_a', 'image/png', 'QUFB'), ('ws_b', 'image/png', 'QkJC');
    insert into account_sessions (id, user_id, workspace_id, csrf_token) values ('s-a', 'a', 'ws_a', 'csrf-a'), ('s-b', 'b', 'ws_b', 'csrf-b');
    insert into workspace_memberships (workspace_id, user_id, email, role) values ('ws_a', 'admin-a', 'admin@example.com', 'admin');
    insert into account_mail_log (id, kind, recipient, mode) values ('m1', 'verify', 'a@example.com', 'dry_run');
  `);
  await pg.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'tenant_reader') then
        create role tenant_reader nologin;
      end if;
    end $$;
    grant select, insert, update, delete on all tables in schema public to tenant_reader;
  `);
  await pg.exec(`set role tenant_reader`);
  await pg.query(`select set_config('app.tenant_id', 'ws_a', false)`);
  const brand = await pg.query<{ sender_display_name: string }>(`select sender_display_name from workspace_branding`);
  assert.deepEqual(brand.rows.map((row) => row.sender_display_name), ["A Studio"]);
  const logos = await pg.query<{ data_base64: string }>(`select data_base64 from workspace_logos`);
  assert.deepEqual(logos.rows.map((row) => row.data_base64), ["QUFB"]);
  const sessions = await pg.query<{ id: string }>(`select id from account_sessions`);
  assert.deepEqual(sessions.rows.map((row) => row.id), ["s-a"]);
  await assert.rejects(() => pg.exec(`insert into workspace_branding (workspace_id, sender_display_name) values ('ws_b', 'Hidden')`));
  await assert.rejects(() => pg.exec(`insert into account_sessions (id, user_id, workspace_id, csrf_token) values ('s-c', 'a', 'ws_b', 'nope')`));
  await pg.close();
});

function attach(bundle: AccountBundle, tenantId: string, role: "member" | "admin") {
  const userId = `${role}-user`;
  const sessionId = `${role}-session`;
  const csrfToken = `${role}-csrf`;
  const session: AccountSession = { id: sessionId, userId, tenantId, role, csrfToken, createdAt: NOW, rotatedFrom: null };
  return {
    userId,
    sessionId,
    csrfToken,
    bundle: {
      ...bundle,
      accounts: {
        ...bundle.accounts,
        users: [...bundle.accounts.users, { id: userId, email: `${role}@example.com`, name: role, passwordHash: hashPassword(`${role}-pass-99`), emailVerified: true, createdAt: NOW }],
        sessions: [...bundle.accounts.sessions, session],
      },
      fulfillment: {
        ...bundle.fulfillment,
        memberships: [...bundle.fulfillment.memberships, { tenantId, userId, email: `${role}@example.com`, role, status: "accepted" as const }],
      },
    },
  };
}
