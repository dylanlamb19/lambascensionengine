import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { hashPassword } from "../account/crypto.ts";
import { dispatchAccountRoute, type AccountCall, type AccountReply } from "../account/routes.ts";
import { emptyBundle, type AccountBundle, type AccountSession } from "../account/types.ts";
import { canSend } from "../mail/guard.ts";
import { sendMail } from "../mail/send.ts";
import { FLAGS } from "../flags.ts";
import { addClient, addMonthsIso, recordPurchase, tickFulfillment } from "../packages/runner.ts";
import { replaceTenant, selectTestPlan, sliceTenant, startMarketerOnboarding } from "../packages/tenancy.ts";
import { EMPTY_FULFILLMENT } from "../packages/types.ts";
import { assertPipelineRunAllowed } from "../packages/usage.ts";
import { inviteSeat } from "../subscription/team.ts";
import { handleScaffoldWebhook, SCAFFOLD_TEST_SECRET, signScaffoldPayload, canonicalWebhookBody } from "../subscription/billing.ts";
import { meterLevel, monthlyRunsOf, readingsFor, writeMeter } from "./meter.ts";
import { capReason } from "./meter.ts";
import { entitlementFor } from "./plans.ts";
import { recordTestPlan } from "./checkout.ts";
import { parseLeadCsv } from "../onboarding/csv.ts";
import { grantPlatformOperator } from "../operator/console.ts";

const NOW = "2026-11-21T18:00:00.000Z";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ON = { billing: true, team: true, lifecycle: true, entitlements: true, wizard: true, operator: true };

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
  const reply = call(bundle, { method: "GET", path: "/api/account/csrf", ip, flags: { billing: true, team: true, lifecycle: true } });
  assert.equal(reply.status, 200);
  return { bundle: reply.bundle, token: String(reply.body.csrfToken) };
}

function codeOf(bundle: AccountBundle, kind: "verify" | "reset" | "invite" = "verify"): string {
  const row = [...(bundle.accounts.transactional || [])].reverse().find((item) => item.kind === kind);
  const found = row?.body.match(/code: ([a-f0-9]{64})/);
  assert.ok(found);
  return found[1];
}

function sessionId(reply: AccountReply): string {
  const header = reply.headers["Set-Cookie"] || "";
  const raw = header.split(";")[0]?.split("=").slice(1).join("=") || "";
  return decodeURIComponent(raw);
}

function register(bundle: AccountBundle, input: { email: string; workspaceName: string; ip: string }) {
  const first = csrf(bundle, input.ip);
  const signed = call(first.bundle, {
    method: "POST",
    path: "/api/account/signup",
    ip: input.ip,
    csrfToken: first.token,
    flags: { billing: true, team: true, lifecycle: true },
    body: { email: input.email, password: "correct-horse-9", name: "Ada", workspaceName: input.workspaceName, csrfToken: first.token },
  });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const second = csrf(signed.bundle, input.ip);
  const verified = call(second.bundle, {
    method: "POST",
    path: "/api/account/verify",
    ip: input.ip,
    csrfToken: second.token,
    flags: { billing: true, team: true, lifecycle: true },
    body: { email: input.email, token: codeOf(signed.bundle), csrfToken: second.token },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return {
    bundle: verified.bundle,
    sessionId: sessionId(verified),
    csrfToken: String(verified.body.csrfToken),
    tenantId: String(verified.body.tenantId),
    userId: verified.bundle.accounts.users.find((row) => row.email === input.email.toLowerCase())?.id || "",
    email: input.email.toLowerCase(),
  };
}

function starterWorkspace() {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!opened.ok) throw new Error("open");
  const chosen = selectTestPlan(opened.state, opened.workspace.id, "test_trial", NOW);
  if (!chosen.ok) throw new Error(chosen.reason);
  return { state: chosen.state, tenantId: opened.workspace.id };
}

test("plan entitlements, the wizard, and the operator console stay off", () => {
  assert.equal(FLAGS.PLAN_ENTITLEMENTS, false);
  assert.equal(FLAGS.ONBOARDING_WIZARD, false);
  assert.equal(FLAGS.OPERATOR_CONSOLE, false);
  const bundle = emptyBundle();
  const paths: [string, string, string][] = [
    ["GET", "/api/account/plan", "Plan entitlements are off."],
    ["POST", "/api/account/plan/change", "Plan entitlements are off."],
    ["GET", "/api/account/onboarding/wizard", "Onboarding is off."],
    ["POST", "/api/account/onboarding/wizard", "Onboarding is off."],
    ["GET", "/api/account/operator", "The operator console is off."],
    ["POST", "/api/account/operator/suspend", "The operator console is off."],
  ];
  for (const [method, path, reason] of paths) {
    const reply = call(bundle, { method, path, flags: { billing: true, team: true, lifecycle: true, entitlements: false, wizard: false, operator: false } });
    assert.equal(reply.status, 404, path);
    assert.equal(reply.body.reason, reason, path);
    assert.equal(reply.bundle, bundle, path);
  }
});

test("meter levels warn at 80 percent and stop at 100 percent", () => {
  assert.equal(meterLevel(3, 5), "ok");
  assert.equal(meterLevel(4, 5), "warning");
  assert.equal(meterLevel(5, 5), "blocked");
  assert.equal(meterLevel(32, 40), "warning");
  assert.equal(meterLevel(31, 40), "ok");
  assert.equal(meterLevel(1000, null), "ok");
  assert.equal(capReason(entitlementFor("agency"), "clientWorkspaces", 1000), null);
  assert.equal(capReason(entitlementFor("agency"), "monthlyRuns", 1000), null);
  assert.match(capReason(entitlementFor("starter"), "teamSeats", 2) || "", /Upgrade needed/);
  assert.equal(entitlementFor("starter").limits.clientWorkspaces, 3);
  assert.equal(entitlementFor("starter").limits.teamSeats, 2);
  assert.equal(entitlementFor("pro").limits.activePipelines, 40);
  assert.equal(entitlementFor("agency").packages.includes("google-meta-ai"), true);
  assert.equal(entitlementFor("starter").packages.includes("google-ads"), false);
  assert.equal(entitlementFor("starter").amountCents, 0);
});

test("entitlements block a purchase, a new client, a pipeline start, and a seat invite", () => {
  const { state, tenantId } = starterWorkspace();
  const blockedPackage = recordPurchase(state, tenantId, {
    clientName: "North Roofing",
    packageId: "google-ads",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, undefined, { entitlements: true });
  assert.equal(blockedPackage.ok, false);
  if (!blockedPackage.ok) assert.match(blockedPackage.reason, /Upgrade needed/);
  assert.match(blockedPackage.ok ? "" : blockedPackage.reason, /Google Advertising/);
  assert.equal(blockedPackage.state.clients.length, 0);

  let current = state;
  const packages = ["lead-follow-up", "reviews-gbp", "appointment-reminders"] as const;
  for (const packageId of packages) {
    const bought = recordPurchase(current, tenantId, {
      clientName: "North Roofing",
      packageId,
      setupPayment: "unrecorded",
      monthlyPayment: "unrecorded",
    }, NOW, undefined, { entitlements: true });
    assert.equal(bought.ok, true, packageId);
    if (bought.ok) current = bought.state;
  }
  for (const packageId of ["lead-follow-up", "reviews-gbp"] as const) {
    const bought = recordPurchase(current, tenantId, {
      clientName: "East Roofing",
      packageId,
      setupPayment: "unrecorded",
      monthlyPayment: "unrecorded",
    }, NOW, undefined, { entitlements: true });
    assert.equal(bought.ok, true, packageId);
    if (bought.ok) current = bought.state;
  }
  const reading = readingsFor(current, tenantId, NOW, entitlementFor("starter")).find((row) => row.key === "activePipelines");
  assert.equal(reading?.used, 5);
  assert.equal(reading?.level, "blocked");
  const stopped = recordPurchase(current, tenantId, {
    clientName: "East Roofing",
    packageId: "appointment-reminders",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, undefined, { entitlements: true });
  assert.equal(stopped.ok, false);
  if (!stopped.ok) assert.match(stopped.reason, /Upgrade needed/);
  assert.match(stopped.ok ? "" : stopped.reason, /active package pipelines/);

  const clients = starterWorkspace();
  let clientState = clients.state;
  for (const name of ["North Roofing", "East Roofing", "South Roofing"]) {
    const added = addClient(clientState, clients.tenantId, name, NOW, undefined, { entitlements: true });
    assert.equal(added.ok, true, name);
    if (added.ok) clientState = added.state;
  }
  const fourth = addClient(clientState, clients.tenantId, "West Roofing", NOW, undefined, { entitlements: true });
  assert.equal(fourth.ok, false);
  if (!fourth.ok) assert.match(fourth.reason, /Upgrade needed/);
  assert.equal(fourth.state.clients.filter((row) => row.tenantId === clients.tenantId).length, 3);

  const off = recordPurchase(state, tenantId, {
    clientName: "North Roofing",
    packageId: "google-ads",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW);
  assert.equal(off.ok, true);
  if (off.ok) assert.equal(off.state.usageMeters.length, 0);

  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.40" });
  const subscribed = call(ada.bundle, {
    method: "POST",
    path: "/api/account/billing/checkout",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "starter", csrfToken: ada.csrfToken },
  });
  const done = call(subscribed.bundle, {
    method: "POST",
    path: "/api/account/billing/checkout/complete",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { sessionId: subscribed.body.sessionId, csrfToken: ada.csrfToken },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const first = inviteSeat(done.bundle, {
    tenantId: ada.tenantId,
    actorUserId: ada.userId,
    email: "bo@example.com",
    role: "member",
    now: NOW,
  }, { entitlements: true });
  assert.equal(first.ok, true, first.ok ? "" : first.reason);
  const second = inviteSeat(first.ok ? first.bundle : done.bundle, {
    tenantId: ada.tenantId,
    actorUserId: ada.userId,
    email: "cee@example.com",
    role: "member",
    now: NOW,
  }, { entitlements: true });
  assert.equal(second.ok, false);
  if (!second.ok) assert.match(second.reason, /Upgrade needed/);
  assert.match(second.ok ? "" : second.reason, /team seats/);
});

test("monthly fulfillment runs roll into the next period without moving the other workspace", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!opened.ok) throw new Error("a");
  const other = startMarketerOnboarding(opened.state, { userId: "marketer-b", workspaceName: "B", now: NOW });
  if (!other.ok) throw new Error("b");
  const chosenA = selectTestPlan(other.state, opened.workspace.id, "test_trial", NOW);
  if (!chosenA.ok) throw new Error(chosenA.reason);
  const chosenB = selectTestPlan(chosenA.state, other.workspace.id, "test_trial", NOW);
  if (!chosenB.ok) throw new Error(chosenB.reason);
  const boughtA = recordPurchase(chosenB.state, opened.workspace.id, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, undefined, { entitlements: true });
  if (!boughtA.ok) throw new Error(boughtA.reason);
  const boughtB = recordPurchase(boughtA.state, other.workspace.id, {
    clientName: "South Plumbing",
    packageId: "lead-follow-up",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, undefined, { entitlements: true });
  if (!boughtB.ok) throw new Error(boughtB.reason);
  const primed = writeMeter(boughtB.state, opened.workspace.id, NOW, 39);
  const first = tickFulfillment(primed, opened.workspace.id, NOW, { enabled: true, entitlements: true });
  assert.equal(first.advanced, 1);
  assert.equal(monthlyRunsOf(first.state, opened.workspace.id, NOW), 40);
  const blocked = tickFulfillment(first.state, opened.workspace.id, NOW, { enabled: true, entitlements: true });
  assert.equal(blocked.advanced, 0);
  assert.equal(monthlyRunsOf(blocked.state, opened.workspace.id, NOW), 40);
  const direct = assertPipelineRunAllowed(blocked.state, opened.workspace.id, blocked.state.usage.find((row) => row.tenantId === opened.workspace.id)?.pipelineRuns || 0, NOW, true);
  assert.equal(direct.ok, false);
  if (!direct.ok) assert.match(direct.reason, /Upgrade needed/);
  const neighbor = tickFulfillment(blocked.state, other.workspace.id, NOW, { enabled: true, entitlements: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(monthlyRunsOf(neighbor.state, opened.workspace.id, NOW), 40);
  const later = addMonthsIso(NOW, 1);
  const rolled = tickFulfillment(neighbor.state, opened.workspace.id, later, { enabled: true, entitlements: true });
  assert.ok(rolled.advanced > 0);
  assert.equal(monthlyRunsOf(rolled.state, opened.workspace.id, NOW), 40);
  assert.ok(monthlyRunsOf(rolled.state, opened.workspace.id, later) > 0);
  assert.notEqual(monthlyRunsOf(rolled.state, opened.workspace.id, later), monthlyRunsOf(rolled.state, other.workspace.id, later));
  const sliced = sliceTenant(rolled.state, opened.workspace.id);
  assert.equal(sliced.usageMeters.every((row) => row.tenantId === opened.workspace.id), true);
  const smuggled = replaceTenant(EMPTY_FULFILLMENT, opened.workspace.id, {
    ...sliced,
    usageMeters: [...sliced.usageMeters, { ...sliced.usageMeters[0], tenantId: other.workspace.id, monthlyRuns: 99 }],
  });
  assert.equal(smuggled.usageMeters.every((row) => row.tenantId === opened.workspace.id), true);
});

test("a 14-day scaffold trial stops new work after it ends and a zero-amount activation clears it", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!opened.ok) throw new Error("open");
  const recorded = recordTestPlan(opened.state, opened.workspace.id, "starter", NOW);
  if (!recorded.ok) throw new Error(recorded.reason);
  assert.equal(recorded.amountCents, 0);
  const trialEnds = recorded.state.scaffoldSubscriptions[0]?.trialEndsAt || "";
  assert.equal(trialEnds, new Date(Date.parse(NOW) + 14 * 24 * 60 * 60 * 1000).toISOString());
  const during = recordPurchase(recorded.state, opened.workspace.id, {
    clientName: "North Roofing",
    packageId: "lead-follow-up",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, undefined, { entitlements: true });
  assert.equal(during.ok, true);
  const later = new Date(Date.parse(trialEnds) + 1000).toISOString();
  const expired = recordPurchase(during.ok ? during.state : recorded.state, opened.workspace.id, {
    clientName: "East Roofing",
    packageId: "reviews-gbp",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, later, undefined, { entitlements: true });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.match(expired.reason, /14-day trial/);
  assert.match(expired.ok ? "" : expired.reason, /Upgrade needed/);
  const event = {
    id: "evt_paid_trial",
    type: "invoice.paid" as const,
    workspaceId: opened.workspace.id,
    planId: "starter",
    livemode: false,
    mode: "test",
  };
  const raw = canonicalWebhookBody(event);
  const paid = handleScaffoldWebhook(during.ok ? during.state : recorded.state, raw, signScaffoldPayload(raw, SCAFFOLD_TEST_SECRET), { verify: (payload, signature, secret) => signature === signScaffoldPayload(payload, secret) }, SCAFFOLD_TEST_SECRET, later);
  if (!paid.ok) throw new Error(paid.reason);
  assert.equal(paid.state.scaffoldSubscriptions[0]?.status, "active");
  assert.equal(paid.state.billingEvents.every((row) => row.amountCents === 0), true);
  const after = recordPurchase(paid.state, opened.workspace.id, {
    clientName: "East Roofing",
    packageId: "reviews-gbp",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, later, undefined, { entitlements: true });
  assert.equal(after.ok, true, after.ok ? "" : after.reason);
});

test("the wizard saves each step and resumes, and a CSV import stays in that workspace", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.80" });
  const bo = register(ada.bundle, { email: "bo@example.com", workspaceName: "Bo Studio", ip: "198.51.100.80" });
  const first = call(bo.bundle, { method: "GET", path: "/api/account/onboarding/wizard", sessionId: ada.sessionId });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const wizard = first.body.wizard as { step: string };
  assert.equal(wizard.step, "branding");
  const saved = call(first.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: {
      step: "branding",
      name: "Ada Studio",
      senderDisplayName: "Ada",
      primary: "#1f6f5b",
      accent: "#c4a574",
      timezone: "America/Chicago",
      csrfToken: ada.csrfToken,
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((saved.body.wizard as { step: string }).step, "plan");
  const resumed = call(saved.bundle, { method: "GET", path: "/api/account/onboarding/wizard", sessionId: ada.sessionId });
  assert.equal((resumed.body.wizard as { step: string; completed: string[] }).step, "plan");
  assert.deepEqual((resumed.body.wizard as { completed: string[] }).completed, ["branding"]);
  const skipped = call(resumed.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { step: "client", skip: true, csrfToken: ada.csrfToken },
  });
  assert.equal(skipped.status, 400);
  assert.equal((skipped.body.wizard as { step?: string } | undefined)?.step, undefined);
  assert.equal(skipped.bundle.fulfillment.wizardProgress.find((row) => row.tenantId === ada.tenantId)?.step, "plan");
  const planned = call(resumed.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { step: "plan", planId: "starter", csrfToken: ada.csrfToken },
  });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.amountCents, 0);
  assert.equal((planned.body.wizard as { step: string }).step, "client");
  const client = call(planned.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { step: "client", name: "North Roofing", csrfToken: ada.csrfToken },
  });
  assert.equal(client.status, 200, JSON.stringify(client.body));
  const clientId = (client.body.wizard as { clients: { id: string }[] }).clients[0]?.id || "";
  const packed = call(client.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { step: "packages", clientId, packageIds: ["lead-follow-up"], csrfToken: ada.csrfToken },
  });
  assert.equal(packed.status, 200, JSON.stringify(packed.body));
  const bad = call(packed.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { step: "leads", clientId, csv: "email\nnot-an-email", csrfToken: ada.csrfToken },
  });
  assert.equal(bad.status, 400);
  assert.match(String(bad.body.reason), /name and email|email address/);
  assert.equal(bad.bundle.fulfillment.importedLeads.filter((row) => row.tenantId === ada.tenantId).length, 0);
  assert.equal(bad.bundle.fulfillment.wizardProgress.find((row) => row.tenantId === ada.tenantId)?.step, "leads");
  const foreign = parseLeadCsv("name,email,workspace\nAvery,avery@example.com,ws_other", ada.tenantId);
  assert.equal(foreign.ok, false);
  const formula = parseLeadCsv("name,email\n=cmd,avery@example.com", ada.tenantId);
  assert.equal(formula.ok, false);
  const imported = call(bad.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: {
      step: "leads",
      clientId,
      csv: "name,email,phone,source\nAvery Cole,avery@example.com,555-0100,website",
      csrfToken: ada.csrfToken,
    },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  const leads = imported.bundle.fulfillment.importedLeads.filter((row) => row.tenantId === ada.tenantId);
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.mode, "dry_run");
  assert.equal(imported.bundle.fulfillment.importedLeads.some((row) => row.tenantId === bo.tenantId), false);
  assert.equal(imported.bundle.fulfillment.leads.length, 0);
  const hidden = call(imported.bundle, {
    method: "POST",
    path: "/api/account/onboarding/wizard",
    sessionId: bo.sessionId,
    csrfToken: bo.csrfToken,
    body: { step: "leads", clientId, csv: "name,email\nHidden,hidden@example.com", csrfToken: bo.csrfToken },
  });
  assert.notEqual(hidden.status, 200);
  assert.equal(hidden.bundle.fulfillment.importedLeads.filter((row) => row.tenantId === ada.tenantId).length, 1);
  const next = imported.body.wizard as { step: string; queued: { packageName: string; tab?: string }[]; tab: string };
  assert.equal(next.step, "next");
  assert.equal(next.tab, "Client Package Fulfillment");
  assert.equal(next.queued[0]?.packageName, "Lead Follow-Up");
  const again = call(imported.bundle, { method: "GET", path: "/api/account/onboarding/wizard", sessionId: ada.sessionId });
  assert.equal((again.body.wizard as { step: string; skipped: string[] }).step, "next");
});

test("tenant users cannot open the operator console, and an operator action is audited without impersonation", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.90" });
  const bo = register(ada.bundle, { email: "bo@example.com", workspaceName: "Bo Studio", ip: "198.51.100.90" });
  const denied = call(bo.bundle, { method: "GET", path: "/api/account/operator", sessionId: ada.sessionId });
  assert.equal(denied.status, 403);
  assert.match(String(denied.body.reason), /Lasengine owner/);
  assert.equal(denied.bundle.accounts.operatorAudit.length, 0);
  const member: AccountSession = {
    id: "member-session",
    userId: "member-user",
    tenantId: ada.tenantId,
    role: "member",
    csrfToken: "member-csrf",
    createdAt: NOW,
    rotatedFrom: null,
  };
  const admin: AccountSession = {
    id: "admin-session",
    userId: "admin-user",
    tenantId: ada.tenantId,
    role: "admin",
    csrfToken: "admin-csrf",
    createdAt: NOW,
    rotatedFrom: null,
  };
  const withRoles: AccountBundle = {
    ...bo.bundle,
    accounts: {
      ...bo.bundle.accounts,
      users: [
        ...bo.bundle.accounts.users,
        { id: member.userId, email: "member@example.com", name: "Member", passwordHash: hashPassword("member-pass-99"), emailVerified: true, createdAt: NOW },
        { id: admin.userId, email: "admin@example.com", name: "Admin", passwordHash: hashPassword("admin-pass-99"), emailVerified: true, createdAt: NOW },
      ],
      sessions: [...bo.bundle.accounts.sessions, member, admin],
    },
    fulfillment: {
      ...bo.bundle.fulfillment,
      memberships: [
        ...bo.bundle.fulfillment.memberships,
        { tenantId: ada.tenantId, userId: member.userId, email: "member@example.com", role: "member", status: "accepted" },
        { tenantId: ada.tenantId, userId: admin.userId, email: "admin@example.com", role: "admin", status: "accepted" },
      ],
    },
  };
  for (const session of [member, admin]) {
    const reply = call(withRoles, { method: "GET", path: "/api/account/operator", sessionId: session.id });
    assert.equal(reply.status, 403, session.role);
    assert.equal(reply.bundle.accounts.operatorAudit.length, 0, session.role);
  }
  const granted = grantPlatformOperator(withRoles, ada.userId, NOW);
  if (!granted.ok) throw new Error(granted.reason);
  const listed = call(granted.bundle, { method: "GET", path: "/api/account/operator", sessionId: ada.sessionId });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.impersonation, false);
  assert.equal(listed.body.mode, "read_only");
  assert.equal(listed.body.sessionTenantId, ada.tenantId);
  const names = (listed.body.tenants as { name: string }[]).map((row) => row.name).sort();
  assert.deepEqual(names, ["Ada Studio", "Bo Studio"]);
  assert.equal(listed.bundle.accounts.sessions.find((row) => row.id === ada.sessionId)?.tenantId, ada.tenantId);
  assert.equal(listed.bundle.accounts.operatorAudit.at(-1)?.action, "list_tenants");
  assert.doesNotMatch(JSON.stringify(listed.body), /passwordHash|scrypt\$/);
  const viewed = call(listed.bundle, {
    method: "GET",
    path: `/api/account/operator/tenant?tenantId=${bo.tenantId}`,
    sessionId: ada.sessionId,
  });
  assert.equal(viewed.status, 200, JSON.stringify(viewed.body));
  assert.equal(viewed.body.impersonation, false);
  assert.equal(viewed.bundle.accounts.sessions.find((row) => row.id === ada.sessionId)?.tenantId, ada.tenantId);
  assert.equal((viewed.body.tenant as { tenantId: string }).tenantId, bo.tenantId);
  assert.ok(Array.isArray((viewed.body.tenant as { health: unknown[] }).health));
  const suspended = call(viewed.bundle, {
    method: "POST",
    path: "/api/account/operator/suspend",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { tenantId: bo.tenantId, csrfToken: ada.csrfToken },
  });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
  assert.equal(suspended.bundle.fulfillment.workspaces.find((row) => row.id === bo.tenantId)?.operatorSuspended, true);
  assert.notEqual(suspended.bundle.fulfillment.workspaces.find((row) => row.id === ada.tenantId)?.operatorSuspended, true);
  assert.equal(suspended.bundle.accounts.operatorAudit.some((row) => row.action === "suspend" && row.tenantId === bo.tenantId), true);
  assert.equal(suspended.bundle.accounts.sessions.find((row) => row.id === ada.sessionId)?.tenantId, ada.tenantId);
  const killed = call(suspended.bundle, {
    method: "POST",
    path: "/api/account/operator/kill",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { tenantId: bo.tenantId, csrfToken: ada.csrfToken },
  });
  assert.equal(killed.status, 200, JSON.stringify(killed.body));
  assert.equal(killed.bundle.fulfillment.workspaces.find((row) => row.id === bo.tenantId)?.leadFollowUpKillSwitch, true);
  assert.notEqual(killed.bundle.fulfillment.workspaces.find((row) => row.id === ada.tenantId)?.leadFollowUpKillSwitch, true);
  assert.equal(killed.bundle.accounts.operatorAudit.some((row) => row.action === "kill_pipelines" && row.tenantId === bo.tenantId), true);
});

test("a test-mode upgrade and downgrade stay at zero dollars", () => {
  const ada = register(emptyBundle(), { email: "ada@example.com", workspaceName: "Ada Studio", ip: "203.0.113.100" });
  const upgraded = call(ada.bundle, {
    method: "POST",
    path: "/api/account/plan/change",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "agency", csrfToken: ada.csrfToken },
  });
  assert.equal(upgraded.status, 200, JSON.stringify(upgraded.body));
  assert.equal(upgraded.body.amountCents, 0);
  assert.equal(upgraded.body.billingMode, "test");
  assert.equal(upgraded.body.direction, "upgrade");
  assert.equal((upgraded.body.plan as { planId: string }).planId, "agency");
  let state = upgraded.bundle.fulfillment;
  for (const name of ["North", "East", "South", "West"]) {
    const added = addClient(state, ada.tenantId, name, NOW, undefined, { entitlements: true });
    assert.equal(added.ok, true, name);
    if (added.ok) state = added.state;
  }
  const downgraded = call({ ...upgraded.bundle, fulfillment: state }, {
    method: "POST",
    path: "/api/account/plan/change",
    sessionId: ada.sessionId,
    csrfToken: ada.csrfToken,
    body: { planId: "starter", csrfToken: ada.csrfToken },
  });
  assert.equal(downgraded.status, 200, JSON.stringify(downgraded.body));
  assert.equal(downgraded.body.direction, "downgrade");
  assert.equal(downgraded.body.amountCents, 0);
  assert.equal(downgraded.bundle.fulfillment.clients.filter((row) => row.tenantId === ada.tenantId).length, 4);
  const blocked = addClient(downgraded.bundle.fulfillment, ada.tenantId, "Fifth", NOW, undefined, { entitlements: true });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /Upgrade needed/);
  const banners = (downgraded.body.plan as { banners: { level: string }[] }).banners;
  assert.equal(banners.some((row) => row.level === "blocked"), true);
});

test("entitlement code does not touch outreach gates, and the new tables hide the other workspace", async () => {
  const files = [
    "src/lib/entitlements/access.ts",
    "src/lib/entitlements/meter.ts",
    "src/lib/onboarding/csv.ts",
    "src/lib/onboarding/wizard.ts",
    "src/lib/operator/console.ts",
    "src/lib/product/routes.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /mail\/send|mail\/guard|sendMail|canSend|suppressed/);
  }
  const guard = readFileSync(join(root, "src/lib/mail/guard.ts"), "utf8");
  const sender = readFileSync(join(root, "src/lib/mail/send.ts"), "utf8");
  assert.match(guard, /Daily send limit reached/);
  assert.match(sender, /canSend\(/);
  assert.equal(typeof sendMail, "function");
  assert.equal(typeof canSend, "function");

  const pg = new PGlite();
  for (const name of ["0015_client_packages.sql", "0016_workspace_connections.sql", "0017_tenant_rls.sql", "0018_lead_follow_up.sql", "0019_lead_gen_ai_visibility.sql", "0020_reviews_appointments.sql", "0021_estimate_google_ads.sql", "0022_meta_office_bundle.sql", "0023_self_serve_signup.sql", "0024_subscription_team.sql", "0025_plan_entitlements.sql"]) {
    await pg.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into marketer_workspaces (id, owner_user_id, name) values ('ws_a', 'a', 'A'), ('ws_b', 'b', 'B');
    insert into usage_meters (workspace_id, period_start, period_end, client_workspaces, active_pipelines, team_seats, monthly_runs) values
      ('ws_a', '2026-11-21T00:00:00Z', '2026-12-21T00:00:00Z', 1, 1, 1, 2),
      ('ws_b', '2026-11-21T00:00:00Z', '2026-12-21T00:00:00Z', 4, 4, 4, 9);
    insert into wizard_progress (workspace_id, step) values ('ws_a', 'branding'), ('ws_b', 'plan');
    insert into lead_import_rows (id, workspace_id, client_id, contact_name, contact_email, mode) values
      ('imp_a', 'ws_a', 'c-a', 'Avery', 'avery@example.com', 'dry_run'),
      ('imp_b', 'ws_b', 'c-b', 'Hidden', 'hidden@example.com', 'dry_run');
    insert into operator_audit_log (id, actor_user_id, action, workspace_id) values
      ('aud_a', 'owner', 'list_tenants', null);
  `);
  await assert.rejects(() => pg.exec(`insert into lead_import_rows (id, workspace_id, client_id, contact_name, contact_email, mode) values ('imp_live', 'ws_a', 'c-a', 'Avery', 'avery@example.com', 'live')`));
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
  const meters = await pg.query<{ monthly_runs: number }>(`select monthly_runs from usage_meters`);
  assert.deepEqual(meters.rows.map((row) => row.monthly_runs), [2]);
  const leads = await pg.query<{ id: string }>(`select id from lead_import_rows`);
  assert.deepEqual(leads.rows.map((row) => row.id), ["imp_a"]);
  const audit = await pg.query<{ id: string }>(`select id from operator_audit_log`);
  assert.equal(audit.rows.length, 0);
  await assert.rejects(() => pg.exec(`insert into usage_meters (workspace_id, period_start, period_end) values ('ws_b', '2026-10-21T00:00:00Z', '2026-11-21T00:00:00Z')`));
  await assert.rejects(() => pg.exec(`insert into operator_audit_log (id, actor_user_id, action) values ('aud_b', 'a', 'list_tenants')`));
  await pg.exec(`reset role`);
  await pg.query(`select set_config('app.tenant_id', '', false)`);
  await pg.query(`select set_config('app.platform_operator', 'on', false)`);
  const platform = await pg.query<{ id: string }>(`select id from operator_audit_log`);
  assert.deepEqual(platform.rows.map((row) => row.id), ["aud_a"]);
  await pg.close();
});
