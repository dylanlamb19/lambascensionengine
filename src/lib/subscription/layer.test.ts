import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { FLAGS } from "../flags.ts";
import { canSend } from "../mail/guard.ts";
import { sendMail } from "../mail/send.ts";
import { addClient } from "../packages/runner.ts";
import { assertPipelineRunAllowed } from "../packages/usage.ts";
import { hashPassword } from "../account/crypto.ts";
import { dispatchAccountRoute, type AccountCall, type AccountReply } from "../account/routes.ts";
import { emptyBundle, type AccountBundle, type AccountSession } from "../account/types.ts";
import { deliverTransactional } from "../transactional/send.ts";
import {
  canonicalWebhookBody,
  handleScaffoldWebhook,
  SCAFFOLD_TEST_SECRET,
  signScaffoldPayload,
  type ScaffoldWebhookEvent,
  type SignatureVerifier,
} from "./billing.ts";

const NOW = "2026-11-21T18:00:00.000Z";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ON = { billing: true, team: true, lifecycle: true };

const LAYER_PATHS: [string, string, string][] = [
  ["GET", "/api/account/billing/scaffold", "Billing is off."],
  ["POST", "/api/account/billing/checkout", "Billing is off."],
  ["POST", "/api/account/billing/checkout/complete", "Billing is off."],
  ["POST", "/api/account/billing/portal", "Billing is off."],
  ["POST", "/api/account/billing/webhook", "Billing is off."],
  ["GET", "/api/account/team", "Team seats are off."],
  ["POST", "/api/account/team/invite", "Team seats are off."],
  ["POST", "/api/account/team/accept", "Team seats are off."],
  ["POST", "/api/account/team/role", "Team seats are off."],
  ["POST", "/api/account/team/remove", "Team seats are off."],
  ["POST", "/api/account/team/transfer", "Team seats are off."],
  ["POST", "/api/account/team/switch", "Team seats are off."],
  ["POST", "/api/account/workspace/export", "Workspace export and closing are off."],
  ["POST", "/api/account/workspace/close", "Workspace export and closing are off."],
  ["POST", "/api/account/workspace/restore", "Workspace export and closing are off."],
];

function call(bundle: AccountBundle, input: Partial<AccountCall> & Pick<AccountCall, "method" | "path">): AccountReply {
  return dispatchAccountRoute(bundle, {
    now: NOW,
    ip: "203.0.113.10",
    enabled: true,
    flags: ON,
    body: {},
    ...input,
  });
}

function csrf(bundle: AccountBundle, ip = "203.0.113.10") {
  const reply = call(bundle, { method: "GET", path: "/api/account/csrf", ip });
  assert.equal(reply.status, 200);
  return { bundle: reply.bundle, token: String(reply.body.csrfToken) };
}

function codeOf(bundle: AccountBundle, kind: "verify" | "reset" | "invite" = "verify"): string {
  const row = [...(bundle.accounts.transactional || [])].reverse().find((item) => item.kind === kind);
  const found = row?.body.match(/code: ([a-f0-9]{64})/);
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
  assert.equal(signed.bundle.accounts.transactional.at(-1)?.channel, "transactional");
  assert.equal(signed.bundle.accounts.transactional.at(-1)?.mode, "dry_run");
  const second = csrf(signed.bundle, input.ip);
  const verified = call(second.bundle, {
    method: "POST",
    path: "/api/account/verify",
    ip: input.ip,
    csrfToken: second.token,
    body: { email: input.email, token: codeOf(signed.bundle), csrfToken: second.token },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return {
    bundle: verified.bundle,
    sessionId: sessionId(verified),
    csrfToken: String(verified.body.csrfToken),
    tenantId: String(verified.body.tenantId),
    email: input.email.toLowerCase(),
    password,
  };
}

function subscribe(account: ReturnType<typeof register>, planId = "starter") {
  const opened = call(account.bundle, {
    method: "POST",
    path: "/api/account/billing/checkout",
    sessionId: account.sessionId,
    csrfToken: account.csrfToken,
    body: { planId, csrfToken: account.csrfToken },
  });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.amountCents, 0);
  assert.equal(String(opened.body.sessionId).startsWith("cs_test_"), true);
  const done = call(opened.bundle, {
    method: "POST",
    path: "/api/account/billing/checkout/complete",
    sessionId: account.sessionId,
    csrfToken: account.csrfToken,
    body: { sessionId: opened.body.sessionId, csrfToken: account.csrfToken },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { ...account, bundle: done.bundle, billing: done.body.billing as { status: string; planId: string; amountCents: number } };
}

function postEvent(bundle: AccountBundle, event: ScaffoldWebhookEvent, signature?: string) {
  const raw = canonicalWebhookBody(event);
  return call(bundle, {
    method: "POST",
    path: "/api/account/billing/webhook",
    signature: signature ?? signScaffoldPayload(raw, SCAFFOLD_TEST_SECRET),
    body: { raw },
  });
}

test("billing, team, and lifecycle routes stay off with the flags", () => {
  assert.equal(FLAGS.BILLING_SCAFFOLD, false);
  assert.equal(FLAGS.TEAM_SEATS, false);
  assert.equal(FLAGS.WORKSPACE_LIFECYCLE, false);
  const bundle = emptyBundle();
  for (const [method, path, reason] of LAYER_PATHS) {
    const reply = call(bundle, { method, path, flags: { billing: false, team: false, lifecycle: false }, body: { planId: "starter" } });
    assert.equal(reply.status, 404, path);
    assert.equal(reply.body.reason, reason, path);
    assert.equal(reply.bundle, bundle, path);
  }
  const closed = call(bundle, { method: "POST", path: "/api/account/billing/webhook", enabled: false, body: { raw: "{}" } });
  assert.equal(closed.status, 404);
  assert.equal(closed.body.reason, "Signup is closed.");
  assert.equal(closed.bundle.fulfillment.webhookReceipts.length, 0);
});

test("transactional mail stays off the outreach sender and the outreach gates still decide", () => {
  const transactional = readFileSync(join(root, "src/lib/transactional/send.ts"), "utf8");
  const accountMail = readFileSync(join(root, "src/lib/account/mail.ts"), "utf8");
  const billing = readFileSync(join(root, "src/lib/subscription/billing.ts"), "utf8");
  const guard = readFileSync(join(root, "src/lib/mail/guard.ts"), "utf8");
  const sender = readFileSync(join(root, "src/lib/mail/send.ts"), "utf8");
  assert.doesNotMatch(transactional, /sendMail|canSend|mail\/guard|mail\/send|maxFirst|suppressed/);
  assert.doesNotMatch(accountMail, /sendMail|live\.server|from ["']@\/lib\/mail/);
  assert.doesNotMatch(billing, /process\.env|api\.stripe\.com|fetch\(/);
  assert.match(billing, /sk_live/);
  assert.match(guard, /export function canSend/);
  assert.match(guard, /Daily send limit reached/);
  assert.match(sender, /export async function sendMail/);
  assert.match(sender, /canSend\(/);
  assert.equal(typeof sendMail, "function");

  const suppressed = canSend({
    prospect: { uid: "p1", name: "North", suppressed: true, stage: "Do Not Contact" },
    gmailConnected: true,
    recipient: "ada@example.com",
    kind: "email",
    method: "MANUAL",
    firstApproved: true,
    sequenceActive: false,
    bounced: false,
    unsubscribed: false,
    usage: { first: 0, followups: 0 },
    caps: { maxFirst: 20, maxFollowups: 50 },
    now: new Date(NOW),
  });
  assert.equal(suppressed.ok, false);
  if (!suppressed.ok) assert.equal(suppressed.code, "DNC");
  const capped = canSend({
    prospect: { uid: "p2", name: "South", stage: "Approved" },
    gmailConnected: true,
    recipient: "ada@example.com",
    kind: "email",
    method: "MANUAL",
    firstApproved: true,
    sequenceActive: false,
    bounced: false,
    unsubscribed: false,
    usage: { first: 20, followups: 0 },
    caps: { maxFirst: 20, maxFollowups: 50 },
    now: new Date(NOW),
  });
  assert.equal(capped.ok, false);
  if (!capped.ok) assert.equal(capped.code, "RATE_LIMIT");

  const delivered = deliverTransactional([], {
    kind: "invite",
    to: "ada@example.com",
    subject: "Join",
    body: "This note was recorded in dry-run mode. Nothing was sent.",
    tenantId: "ws_a",
    at: NOW,
  });
  assert.equal(delivered.message.mode, "dry_run");
  assert.equal(delivered.message.channel, "transactional");
  assert.equal(delivered.log.length, 1);
  assert.equal("gmailMessageId" in delivered.message, false);
});

test("webhook signature failure, live ids, and a repeated notice do not double-apply", () => {
  const ada = subscribe(register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.40" }));
  assert.equal(ada.billing.status, "trialing");
  assert.equal(ada.billing.amountCents, 0);
  assert.equal(ada.bundle.fulfillment.workspaces[0]?.planId, "test_trial");
  const deny: SignatureVerifier = { verify: () => false };
  const rawPaid = canonicalWebhookBody({
    id: "evt_paid_1",
    type: "invoice.paid",
    workspaceId: ada.tenantId,
    planId: "starter",
    livemode: false,
    mode: "test",
  });
  const unsigned = handleScaffoldWebhook(ada.bundle.fulfillment, rawPaid, "not-a-signature", deny, SCAFFOLD_TEST_SECRET, NOW);
  assert.equal(unsigned.ok, false);
  assert.equal(unsigned.state, ada.bundle.fulfillment);
  const liveSecret = handleScaffoldWebhook(ada.bundle.fulfillment, rawPaid, "ab", { verify: () => true }, "whsec_live_secret", NOW);
  assert.equal(liveSecret.ok, false);
  assert.match(liveSecret.ok ? "" : liveSecret.reason, /live/);
  assert.equal(liveSecret.state, ada.bundle.fulfillment);

  const bad = postEvent(ada.bundle, {
    id: "evt_paid_1",
    type: "invoice.paid",
    workspaceId: ada.tenantId,
    planId: "starter",
  }, "0000");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, "The signature does not match.");
  assert.equal(bad.bundle, ada.bundle);

  const live = postEvent(ada.bundle, {
    id: "evt_live_1",
    type: "invoice.paid",
    workspaceId: ada.tenantId,
    planId: "sk_live_123",
    livemode: true,
    mode: "live",
  });
  assert.equal(live.status, 400);
  assert.match(String(live.body.reason), /live/i);
  assert.equal(live.bundle.fulfillment.scaffoldSubscriptions[0]?.status, "trialing");

  const refusedPlan = call(ada.bundle, {
    method: "POST",
    path: "/api/account/billing/checkout",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "price_live_999", csrfToken: ada.csrfToken },
  });
  assert.equal(refusedPlan.status, 400);
  assert.equal(ada.bundle.fulfillment.checkoutSessions.length, refusedPlan.bundle.fulfillment.checkoutSessions.length);

  const paid = postEvent(ada.bundle, { id: "evt_paid_1", type: "invoice.paid", workspaceId: ada.tenantId, planId: "starter" });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.bundle.fulfillment.scaffoldSubscriptions[0]?.status, "active");
  const failed = postEvent(paid.bundle, { id: "evt_fail_1", type: "invoice.payment_failed", workspaceId: ada.tenantId });
  assert.equal(failed.status, 200);
  const grace = failed.bundle.fulfillment.scaffoldSubscriptions[0]?.graceUntil;
  assert.equal(grace, new Date(Date.parse(NOW) + 7 * 24 * 60 * 60 * 1000).toISOString());
  const again = postEvent(failed.bundle, { id: "evt_fail_1", type: "invoice.payment_failed", workspaceId: ada.tenantId });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.bundle.fulfillment.webhookReceipts.filter((row) => row.id === "evt_fail_1").length, 1);
  assert.equal(again.bundle.fulfillment.scaffoldSubscriptions[0]?.graceUntil, grace);
  assert.equal(again.bundle.fulfillment.scaffoldSubscriptions[0]?.status, "past_due");

  const during = addClient(again.bundle.fulfillment, ada.tenantId, "North Roofing", NOW);
  assert.equal(during.ok, true);
  const afterGrace = new Date(Date.parse(grace || NOW) + 1000).toISOString();
  const blocked = addClient(during.ok ? during.state : again.bundle.fulfillment, ada.tenantId, "South Roofing", afterGrace);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.reason, /grace period/);
  const runs = assertPipelineRunAllowed(during.ok ? during.state : again.bundle.fulfillment, ada.tenantId, 0, afterGrace);
  assert.equal(runs.ok, false);

  const canceled = postEvent(again.bundle, { id: "evt_cancel_1", type: "customer.subscription.deleted", workspaceId: ada.tenantId });
  assert.equal(canceled.status, 200);
  assert.equal(canceled.bundle.fulfillment.scaffoldSubscriptions[0]?.status, "canceled");
  assert.equal(canceled.bundle.fulfillment.workspaces[0]?.subscriptionStatus, "canceled");
  const revived = postEvent(canceled.bundle, { id: "evt_paid_2", type: "invoice.paid", workspaceId: ada.tenantId });
  assert.equal(revived.status, 400);
  assert.equal(revived.bundle.fulfillment.scaffoldSubscriptions[0]?.status, "canceled");
});

test("seat caps, invite expiry, and a used invite stay inside one workspace", () => {
  const ada = subscribe(register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.50" }));
  const bo = register(ada.bundle, { email: "bo@example.com", workspaceName: "Bo Studio", ip: "198.51.100.50" });
  const invited = call(bo.bundle, {
    method: "POST",
    path: "/api/account/team/invite",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { email: "bo@example.com", role: "member", csrfToken: ada.csrfToken },
  });
  assert.equal(invited.status, 200, JSON.stringify(invited.body));
  assert.equal(invited.body.reason, "Invite recorded. Nothing was sent.");
  const code = codeOf(invited.bundle, "invite");
  assert.equal(JSON.stringify(invited.body).includes(code), false);
  assert.equal(invited.bundle.accounts.transactional.at(-1)?.kind, "invite");
  assert.equal(invited.bundle.accounts.transactional.at(-1)?.mode, "dry_run");
  const second = call(invited.bundle, {
    method: "POST",
    path: "/api/account/team/invite",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { email: "cee@example.com", role: "admin", csrfToken: ada.csrfToken },
  });
  assert.equal(second.status, 400);
  assert.match(String(second.body.reason), /2 people/);
  assert.equal(second.bundle.fulfillment.seatInvites.length, 1);

  const expiredAt = new Date(Date.parse(NOW) + 8 * 24 * 60 * 60 * 1000).toISOString();
  const expired = call(invited.bundle, {
    method: "POST",
    path: "/api/account/team/accept",
    now: expiredAt,
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { token: code, csrfToken: bo.csrfToken },
  });
  assert.equal(expired.status, 400);
  assert.match(String(expired.body.reason), /expired/);
  assert.equal(expired.bundle.fulfillment.seatInvites[0]?.usedAt, null);

  const accepted = call(invited.bundle, {
    method: "POST",
    path: "/api/account/team/accept",
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { token: code, csrfToken: bo.csrfToken },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.tenantId, ada.tenantId);
  const reused = call(accepted.bundle, {
    method: "POST",
    path: "/api/account/team/accept",
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { token: code, csrfToken: bo.csrfToken },
  });
  assert.equal(reused.status, 400);
  assert.match(String(reused.body.reason), /already used/);
  assert.equal(reused.bundle.fulfillment.memberships.filter((row) => row.tenantId === ada.tenantId && row.userId === reused.bundle.accounts.users[1]?.id).length, 1);

  const full = call(reused.bundle, {
    method: "POST",
    path: "/api/account/team/invite",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { email: "cee@example.com", role: "member", csrfToken: ada.csrfToken },
  });
  assert.equal(full.status, 400);
  const promoted = call(reused.bundle, {
    method: "POST",
    path: "/api/account/team/role",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { userId: reused.bundle.accounts.users[1]?.id, role: "admin", csrfToken: ada.csrfToken },
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.bundle.accounts.sessions.some((row) => row.userId === reused.bundle.accounts.users[1]?.id), false);
  const transferred = call(promoted.bundle, {
    method: "POST",
    path: "/api/account/team/transfer",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { userId: promoted.bundle.accounts.users[1]?.id, csrfToken: ada.csrfToken },
  });
  assert.equal(transferred.status, 200, JSON.stringify(transferred.body));
  assert.equal(transferred.bundle.fulfillment.workspaces.find((row) => row.id === ada.tenantId)?.ownerUserId, promoted.bundle.accounts.users[1]?.id);
  assert.equal(transferred.body.role, "admin");
  const removeOwner = call(transferred.bundle, {
    method: "POST",
    path: "/api/account/team/remove",
    sessionId: sessionId(transferred),
    csrfToken: String(transferred.body.csrfToken),
    body: { userId: promoted.bundle.accounts.users[1]?.id, csrfToken: transferred.body.csrfToken },
  });
  assert.equal(removeOwner.status, 403);
});

test("a workspace cannot read or change another workspace's subscription, seats, or export", () => {
  const ada = subscribe(register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.60" }));
  const bo = subscribe(register(ada.bundle, { email: "bo@example.com", workspaceName: "Prairie Secret", ip: "198.51.100.60" }), "pro");
  const client = call(bo.bundle, {
    method: "POST",
    path: "/api/account/onboarding/client",
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { name: "Hidden Client", csrfToken: bo.csrfToken },
  });
  assert.equal(client.status, 200);
  const before = JSON.stringify(client.bundle.fulfillment.scaffoldSubscriptions.find((row) => row.tenantId === bo.tenantId));
  const writes = [
    { path: "/api/account/billing/checkout", body: { planId: "agency", tenantId: bo.tenantId } },
    { path: "/api/account/billing/portal", body: { tenantId: bo.tenantId } },
    { path: "/api/account/team/invite", body: { email: "spy@example.com", role: "member", tenantId: bo.tenantId } },
    { path: "/api/account/team/remove", body: { userId: client.bundle.accounts.users[1]?.id, tenantId: bo.tenantId } },
    { path: "/api/account/workspace/export", body: { tenantId: bo.tenantId } },
    { path: "/api/account/workspace/close", body: { tenantId: bo.tenantId } },
  ];
  for (const write of writes) {
    const reply = call(client.bundle, {
      method: "POST",
      path: write.path,
      sessionId: ada.sessionId,
      csrfToken: ada.csrfToken,
      body: { ...write.body, csrfToken: ada.csrfToken },
    });
    assert.equal(reply.status, 403, write.path);
    assert.equal(reply.bundle, client.bundle, write.path);
  }
  const peek = call(client.bundle, { method: "GET", path: `/api/account/billing/scaffold?tenantId=${bo.tenantId}`, sessionId: ada.sessionId });
  assert.equal(peek.status, 403);
  assert.doesNotMatch(JSON.stringify(peek.body), /Prairie|Hidden|pro/);
  const own = call(client.bundle, { method: "GET", path: "/api/account/billing/scaffold", sessionId: ada.sessionId });
  assert.equal(own.status, 200);
  assert.equal((own.body.billing as { planId: string }).planId, "starter");
  assert.doesNotMatch(JSON.stringify(own.body), /Prairie|Hidden/);
  const exported = call(client.bundle, {
    method: "POST",
    path: "/api/account/workspace/export",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { csrfToken: ada.csrfToken },
  });
  assert.equal(exported.status, 200);
  const dumped = JSON.stringify(exported.body);
  assert.doesNotMatch(dumped, /Prairie|Hidden|passwordHash|scrypt\$/);
  assert.match(dumped, /Ada Studio/);
  const forged = postEvent(client.bundle, { id: "evt_foreign", type: "invoice.paid", workspaceId: bo.tenantId, planId: "agency" });
  assert.equal(forged.status, 200);
  assert.equal(JSON.stringify(forged.bundle.fulfillment.scaffoldSubscriptions.find((row) => row.tenantId === ada.tenantId)), JSON.stringify(client.bundle.fulfillment.scaffoldSubscriptions.find((row) => row.tenantId === ada.tenantId)));
  assert.equal(forged.bundle.fulfillment.scaffoldSubscriptions.find((row) => row.tenantId === bo.tenantId)?.planId, "agency");
  assert.equal(before.includes("pro"), true);
});

test("closing a workspace revokes its sessions, stops its pipelines, and restores inside 30 days", () => {
  const ada = subscribe(register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.70" }));
  const bo = register(ada.bundle, { email: "bo@example.com", workspaceName: "Bo Studio", ip: "198.51.100.70" });
  const added = call(bo.bundle, {
    method: "POST",
    path: "/api/account/onboarding/client",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { name: "North Roofing", csrfToken: ada.csrfToken },
  });
  const packed = call(added.bundle, {
    method: "POST",
    path: "/api/account/onboarding/package",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { clientName: "North Roofing", packageId: "lead-follow-up", csrfToken: ada.csrfToken },
  });
  assert.equal(packed.status, 200, JSON.stringify(packed.body));
  const marked: AccountBundle = {
    ...packed.bundle,
    fulfillment: {
      ...packed.bundle.fulfillment,
      workspaces: packed.bundle.fulfillment.workspaces.map((row) => row.id === ada.tenantId ? { ...row, reviewsKillSwitch: true } : row),
    },
  };
  const closed = call(marked, {
    method: "POST",
    path: "/api/account/workspace/close",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { csrfToken: ada.csrfToken },
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const workspace = closed.bundle.fulfillment.workspaces.find((row) => row.id === ada.tenantId);
  assert.equal(workspace?.closedAt, NOW);
  assert.equal(workspace?.leadFollowUpKillSwitch, true);
  assert.equal(workspace?.reviewsKillSwitch, true);
  assert.equal(workspace?.googleAdsKillSwitch, true);
  assert.equal(closed.bundle.fulfillment.enrollments.find((row) => row.tenantId === ada.tenantId)?.killSwitch, true);
  assert.equal(closed.bundle.accounts.sessions.some((row) => row.tenantId === ada.tenantId), false);
  assert.equal(closed.bundle.fulfillment.workspaces.find((row) => row.id === bo.tenantId)?.leadFollowUpKillSwitch, false);
  const stale = call(closed.bundle, { method: "GET", path: "/api/account/settings", sessionId: ada.sessionId });
  assert.equal(stale.status, 401);
  const token = csrf(closed.bundle, "203.0.113.71");
  const logged = call(token.bundle, {
    method: "POST",
    path: "/api/account/login",
    ip: "203.0.113.71",
    csrfToken: token.token,
    body: { email: "ada@example.com", password: ada.password, csrfToken: token.token },
  });
  assert.equal(logged.status, 200, JSON.stringify(logged.body));
  const tooLate = new Date(Date.parse(NOW) + 31 * 24 * 60 * 60 * 1000).toISOString();
  const denied = call(logged.bundle, {
    method: "POST",
    path: "/api/account/workspace/restore",
    now: tooLate,
    sessionId: sessionId(logged),
    csrfToken: String(logged.body.csrfToken),
    body: { csrfToken: logged.body.csrfToken },
  });
  assert.equal(denied.status, 400);
  assert.match(String(denied.body.reason), /30 day/);
  assert.equal(denied.bundle.fulfillment.workspaces.find((row) => row.id === ada.tenantId)?.closedAt, NOW);
  const restored = call(logged.bundle, {
    method: "POST",
    path: "/api/account/workspace/restore",
    sessionId: sessionId(logged),
    csrfToken: String(logged.body.csrfToken),
    body: { csrfToken: logged.body.csrfToken },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const back = restored.bundle.fulfillment.workspaces.find((row) => row.id === ada.tenantId);
  assert.equal(back?.closedAt, null);
  assert.equal(back?.reviewsKillSwitch, true);
  assert.equal(back?.leadFollowUpKillSwitch, false);
  assert.equal(restored.bundle.fulfillment.enrollments.find((row) => row.tenantId === ada.tenantId)?.killSwitch, false);
  const settings = call(restored.bundle, { method: "GET", path: "/api/account/settings", sessionId: sessionId(logged) });
  assert.equal(settings.status, 200);

  const member: AccountSession = {
    id: "member-session",
    userId: "member-user",
    tenantId: ada.tenantId,
    role: "member",
    csrfToken: "member-csrf",
    createdAt: NOW,
    rotatedFrom: null,
  };
  const withMember: AccountBundle = {
    ...restored.bundle,
    accounts: {
      ...restored.bundle.accounts,
      users: [...restored.bundle.accounts.users, { id: member.userId, email: "member@example.com", name: "Member", passwordHash: hashPassword("member-pass-99"), emailVerified: true, createdAt: NOW }],
      sessions: [...restored.bundle.accounts.sessions, member],
    },
    fulfillment: {
      ...restored.bundle.fulfillment,
      memberships: [...restored.bundle.fulfillment.memberships, { tenantId: ada.tenantId, userId: member.userId, email: "member@example.com", role: "member", status: "accepted" }],
    },
  };
  const memberCheckout = call(withMember, {
    method: "POST",
    path: "/api/account/billing/checkout",
    sessionId: member.id,
    csrfToken: member.csrfToken,
    body: { planId: "agency", csrfToken: member.csrfToken },
  });
  assert.equal(memberCheckout.status, 403);
});

test("row security hides the other workspace on every new subscription table", async () => {
  const pg = new PGlite();
  for (const name of ["0015_client_packages.sql", "0016_workspace_connections.sql", "0017_tenant_rls.sql", "0018_lead_follow_up.sql", "0019_lead_gen_ai_visibility.sql", "0020_reviews_appointments.sql", "0021_estimate_google_ads.sql", "0022_meta_office_bundle.sql", "0023_self_serve_signup.sql", "0024_subscription_team.sql"]) {
    await pg.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into marketer_workspaces (id, owner_user_id, name) values ('ws_a', 'a', 'A'), ('ws_b', 'b', 'B');
  `);
  await assert.rejects(() => pg.exec(`insert into scaffold_checkout_sessions (id, workspace_id, plan_id, amount_cents, billing_mode, status) values ('bad', 'ws_a', 'starter', 1, 'test', 'open')`));
  await pg.exec(`
    insert into transactional_mail (id, workspace_id, kind, recipient, mode) values
      ('m-a', 'ws_a', 'invite', 'a@example.com', 'dry_run'),
      ('m-b', 'ws_b', 'invite', 'b@example.com', 'dry_run');
    insert into scaffold_subscriptions (workspace_id, plan_id, status, customer_id, subscription_id, billing_mode) values
      ('ws_a', 'starter', 'trialing', 'cus_test_a', 'sub_test_a', 'test'),
      ('ws_b', 'pro', 'active', 'cus_test_b', 'sub_test_b', 'test');
    insert into scaffold_checkout_sessions (id, workspace_id, plan_id, amount_cents, billing_mode, status) values
      ('cs_a', 'ws_a', 'starter', 0, 'test', 'open'),
      ('cs_b', 'ws_b', 'pro', 0, 'test', 'open');
    insert into scaffold_portal_sessions (id, workspace_id, billing_mode) values ('ps_a', 'ws_a', 'test'), ('ps_b', 'ws_b', 'test');
    insert into scaffold_webhook_receipts (id, workspace_id, type) values ('evt_a', 'ws_a', 'invoice.paid'), ('evt_b', 'ws_b', 'invoice.paid');
    insert into seat_invites (id, workspace_id, email, role, token_hash, expires_at, invited_by_user_id) values
      ('inv_a', 'ws_a', 'a@example.com', 'member', 'hash-a', '2026-12-01T00:00:00Z', 'a'),
      ('inv_b', 'ws_b', 'b@example.com', 'admin', 'hash-b', '2026-12-01T00:00:00Z', 'b');
    insert into workspace_closures (id, workspace_id, closed_at, restore_until) values
      ('c-a', 'ws_a', '2026-11-21T00:00:00Z', '2026-12-21T00:00:00Z'),
      ('c-b', 'ws_b', '2026-11-21T00:00:00Z', '2026-12-21T00:00:00Z');
  `);
  await assert.rejects(() => pg.exec(`insert into transactional_mail (id, workspace_id, kind, recipient, mode) values ('m-live', 'ws_a', 'invite', 'a@example.com', 'live')`));
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
  const plans = await pg.query<{ plan_id: string }>(`select plan_id from scaffold_subscriptions`);
  assert.deepEqual(plans.rows.map((row) => row.plan_id), ["starter"]);
  const mail = await pg.query<{ id: string }>(`select id from transactional_mail`);
  assert.deepEqual(mail.rows.map((row) => row.id), ["m-a"]);
  const invites = await pg.query<{ id: string }>(`select id from seat_invites`);
  assert.deepEqual(invites.rows.map((row) => row.id), ["inv_a"]);
  const receipts = await pg.query<{ id: string }>(`select id from scaffold_webhook_receipts`);
  assert.deepEqual(receipts.rows.map((row) => row.id), ["evt_a"]);
  const closures = await pg.query<{ id: string }>(`select id from workspace_closures`);
  assert.deepEqual(closures.rows.map((row) => row.id), ["c-a"]);
  await assert.rejects(() => pg.exec(`insert into scaffold_subscriptions (workspace_id, plan_id, status, customer_id, subscription_id) values ('ws_b', 'agency', 'active', 'cus_test_x', 'sub_test_x')`));
  await assert.rejects(() => pg.exec(`insert into seat_invites (id, workspace_id, email, role, token_hash, expires_at, invited_by_user_id) values ('inv_x', 'ws_b', 'x@example.com', 'member', 'hash-x', '2026-12-01T00:00:00Z', 'a')`));
  await assert.rejects(() => pg.exec(`insert into workspace_closures (id, workspace_id, closed_at, restore_until) values ('c-x', 'ws_b', '2026-11-21T00:00:00Z', '2026-12-21T00:00:00Z')`));
  await pg.close();
});
