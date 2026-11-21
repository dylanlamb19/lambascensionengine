import { fakeBilling } from "../packages/billing.ts";
import { addClient, recordPurchase } from "../packages/runner.ts";
import { confirmWorkspace, startMarketerOnboarding, workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState, MarketerInvite, WorkspaceMembership } from "../packages/types.ts";
import { brandForBundle, colorProblem, logoUrlProblem, onboardingChecklist, planUsageView, senderProblem, timezoneProblem } from "./brand.ts";
import { dummyPasswordHash, hashPassword, mintToken, newId, sessionCookie, sha256, verifyPassword, clearSessionCookie, passwordProblem } from "./crypto.ts";
import { logAccountMail, resetNote, verificationNote } from "./mail.ts";
import { deskRole, homeForUser, roleAllows, type AccountAction } from "./rbac.ts";
import { clientIp, isDisposableEmail, isEmailShape, normalizeEmail, recordAttempt, throttleBlocked, type ThrottleKind } from "./throttle.ts";
import type { AccountBundle, AccountSession, AccountState, DeskRole, LogoContentType } from "./types.ts";

const VERIFY_MS = 30 * 60_000;
const RESET_MS = 30 * 60_000;
const CSRF_MS = 30 * 60_000;
const LOGO_TYPES = new Set<LogoContentType>(["image/png", "image/jpeg", "image/webp"]);

export type FlowResult = {
  bundle: AccountBundle;
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function done(bundle: AccountBundle, status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): FlowResult {
  return { bundle, status, body, headers };
}

function fail(bundle: AccountBundle, status: number, reason: string): FlowResult {
  return done(bundle, status, { ok: false, reason });
}

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function mintCsrf(bundle: AccountBundle, now: string): FlowResult {
  const token = newId() + newId();
  const accounts: AccountState = {
    ...bundle.accounts,
    challenges: [...bundle.accounts.challenges.filter((row) => row.expiresAt > now), { token, expiresAt: plus(now, CSRF_MS) }],
  };
  return done({ ...bundle, accounts }, 200, { ok: true, csrfToken: token });
}

function takeChallenge(accounts: AccountState, token: string, now: string): { accounts: AccountState; ok: boolean } {
  const live = accounts.challenges.filter((row) => row.expiresAt > now);
  const match = live.find((row) => row.token === token);
  if (!match) return { accounts: { ...accounts, challenges: live }, ok: false };
  return { accounts: { ...accounts, challenges: live.filter((row) => row.token !== token) }, ok: true };
}

function requireAnonymousCsrf(bundle: AccountBundle, token: string, now: string): { bundle: AccountBundle } | FlowResult {
  const taken = takeChallenge(bundle.accounts, token, now);
  const next = { ...bundle, accounts: taken.accounts };
  if (!taken.ok) return fail(next, 403, "The form token is missing or expired.");
  return { bundle: next };
}

function isFlow(value: { bundle: AccountBundle } | FlowResult): value is FlowResult {
  return "status" in value;
}

function guardThrottle(bundle: AccountBundle, kind: ThrottleKind, bucket: string, now: string): FlowResult | null {
  if (!throttleBlocked(bundle.accounts, kind, bucket, now)) return null;
  return fail(bundle, 429, "Too many attempts. Try again later.");
}

function mark(bundle: AccountBundle, kind: ThrottleKind, bucket: string, now: string): AccountBundle {
  return { ...bundle, accounts: recordAttempt(bundle.accounts, kind, bucket, now) };
}

export function requestSignup(
  bundle: AccountBundle,
  input: { email: string; password: string; name: string; workspaceName: string; ip: string; now: string; csrfToken: string },
): FlowResult {
  const csrf = requireAnonymousCsrf(bundle, input.csrfToken, input.now);
  if (isFlow(csrf)) return csrf;
  let next = csrf.bundle;
  const ip = clientIp(input.ip);
  const email = normalizeEmail(input.email);
  const blockedIp = guardThrottle(next, "signup:ip", ip, input.now);
  if (blockedIp) return blockedIp;
  next = mark(next, "signup:ip", ip, input.now);
  if (!isEmailShape(email)) return fail(next, 400, "Enter an email address.");
  const blockedEmail = guardThrottle(next, "signup:email", email, input.now);
  if (blockedEmail) return blockedEmail;
  next = mark(next, "signup:email", email, input.now);
  if (isDisposableEmail(email)) return fail(next, 400, "Use a permanent email address.");
  const passwordError = passwordProblem(input.password);
  if (passwordError) return fail(next, 400, passwordError);
  const workspaceName = input.workspaceName.trim().replace(/\s+/g, " ");
  if (!workspaceName || workspaceName.length > 80) return fail(next, 400, "The workspace needs a name.");
  const person = input.name.trim().replace(/\s+/g, " ") || workspaceName;
  if (person.length > 80) return fail(next, 400, "That name is too long.");
  if (next.accounts.users.some((row) => row.email === email)) {
    return fail(next, 409, "That email is already registered.");
  }
  const minted = mintToken();
  const note = verificationNote(minted.token, workspaceName);
  const pending = {
    id: newId(),
    email,
    name: person,
    passwordHash: hashPassword(input.password),
    workspaceName,
    tokenHash: minted.hash,
    expiresAt: plus(input.now, VERIFY_MS),
    createdAt: input.now,
  };
  const without = next.accounts.pending.filter((row) => row.email !== email);
  const logged = logAccountMail({ ...next.accounts, pending: [...without, pending] }, { kind: "verify", to: email, ...note, at: input.now });
  return done({ ...next, accounts: logged.accounts }, 200, {
    ok: true,
    reason: "Verification recorded. Nothing was sent.",
  });
}

export function openVerifiedWorkspace(
  bundle: AccountBundle,
  pending: AccountBundle["accounts"]["pending"][number],
  now: string,
  userId = newId(),
): AccountBundle | null {
  const opened = startMarketerOnboarding(bundle.fulfillment, {
    userId,
    workspaceName: pending.workspaceName,
    now,
  });
  if (!opened.ok) return null;
  const membership: WorkspaceMembership = {
    tenantId: opened.workspace.id,
    userId,
    email: pending.email,
    role: "owner",
    status: "accepted",
  };
  const already = (opened.state.memberships || []).some((row) => row.tenantId === membership.tenantId && row.userId === userId);
  const fulfillment: FulfillmentState = {
    ...opened.state,
    memberships: already ? opened.state.memberships : [...(opened.state.memberships || []), membership],
  };
  const user = {
    id: userId,
    email: pending.email,
    name: pending.name,
    passwordHash: pending.passwordHash,
    emailVerified: true,
    createdAt: now,
  };
  return {
    fulfillment,
    accounts: {
      ...bundle.accounts,
      users: [...bundle.accounts.users, user],
      pending: bundle.accounts.pending.filter((row) => row.id !== pending.id),
    },
  };
}

function openSession(bundle: AccountBundle, userId: string, now: string, rotatedFrom: string | null): { bundle: AccountBundle; session: AccountSession } | null {
  const home = homeForUser(bundle.fulfillment, userId);
  if (!home) return null;
  const session: AccountSession = {
    id: newId(),
    userId,
    tenantId: home.tenantId,
    role: home.role,
    csrfToken: newId() + newId(),
    createdAt: now,
    rotatedFrom,
  };
  return {
    session,
    bundle: {
      ...bundle,
      accounts: {
        ...bundle.accounts,
        sessions: [...bundle.accounts.sessions.filter((row) => row.userId !== userId), session],
      },
    },
  };
}

export function verifySignup(bundle: AccountBundle, input: { email: string; token: string; ip: string; now: string; csrfToken: string }): FlowResult {
  const csrf = requireAnonymousCsrf(bundle, input.csrfToken, input.now);
  if (isFlow(csrf)) return csrf;
  let next = csrf.bundle;
  const ip = clientIp(input.ip);
  if (throttleBlocked(next.accounts, "verify:ip", ip, input.now)) return fail(next, 429, "Too many attempts. Try again later.");
  next = mark(next, "verify:ip", ip, input.now);
  const email = normalizeEmail(input.email);
  const pending = next.accounts.pending.find((row) => row.email === email);
  const hash = sha256(text(input.token));
  if (!pending || pending.expiresAt <= input.now || pending.tokenHash !== hash) {
    return fail(next, 400, "That verification code is not valid.");
  }
  const committed = openVerifiedWorkspace(next, pending, input.now);
  if (!committed) return fail(next, 409, "That workspace could not be opened.");
  const user = committed.accounts.users.find((row) => row.email === email);
  if (!user) return fail(next, 409, "That workspace could not be opened.");
  const opened = openSession(committed, user.id, input.now, null);
  if (!opened) return fail(next, 409, "That workspace could not be opened.");
  const checklist = onboardingChecklist(opened.bundle.fulfillment, opened.session.tenantId);
  return done(
    opened.bundle,
    200,
    { ok: true, csrfToken: opened.session.csrfToken, tenantId: opened.session.tenantId, checklist },
    { "Set-Cookie": sessionCookie(opened.session.id) },
  );
}

export function loginAccount(
  bundle: AccountBundle,
  input: { email: string; password: string; ip: string; now: string; csrfToken: string },
): FlowResult {
  const csrf = requireAnonymousCsrf(bundle, input.csrfToken, input.now);
  if (isFlow(csrf)) return csrf;
  let next = csrf.bundle;
  const ip = clientIp(input.ip);
  if (throttleBlocked(next.accounts, "login:ip", ip, input.now)) return fail(next, 429, "Too many attempts. Try again later.");
  next = mark(next, "login:ip", ip, input.now);
  const email = normalizeEmail(input.email);
  const user = next.accounts.users.find((row) => row.email === email);
  const hash = user?.passwordHash || dummyPasswordHash();
  const passwordOk = verifyPassword(input.password, hash);
  if (!user || !passwordOk) return fail(next, 401, "Email or password is wrong.");
  if (!user.emailVerified) return fail(next, 403, "Verify your email before signing in.");
  const previous = next.accounts.sessions.find((row) => row.userId === user.id)?.id || null;
  const opened = openSession(next, user.id, input.now, previous);
  if (!opened) return fail(next, 403, "This account has no workspace.");
  return done(
    opened.bundle,
    200,
    { ok: true, csrfToken: opened.session.csrfToken, tenantId: opened.session.tenantId, role: opened.session.role },
    { "Set-Cookie": sessionCookie(opened.session.id) },
  );
}

export function logoutAccount(bundle: AccountBundle, session: AccountSession): FlowResult {
  return done(
    {
      ...bundle,
      accounts: { ...bundle.accounts, sessions: bundle.accounts.sessions.filter((row) => row.id !== session.id) },
    },
    200,
    { ok: true },
    { "Set-Cookie": clearSessionCookie() },
  );
}

export function requestPasswordReset(
  bundle: AccountBundle,
  input: { email: string; ip: string; now: string; csrfToken: string },
): FlowResult {
  const csrf = requireAnonymousCsrf(bundle, input.csrfToken, input.now);
  if (isFlow(csrf)) return csrf;
  let next = csrf.bundle;
  const ip = clientIp(input.ip);
  const email = normalizeEmail(input.email);
  const quiet = done(next, 200, { ok: true, reason: "If that email is registered, a reset note was recorded. Nothing was sent." });
  if (throttleBlocked(next.accounts, "reset:ip", ip, input.now)) return fail(next, 429, "Too many attempts. Try again later.");
  next = mark(next, "reset:ip", ip, input.now);
  if (!isEmailShape(email)) return done(next, 200, quiet.body);
  if (throttleBlocked(next.accounts, "reset:email", email, input.now)) return fail(next, 429, "Too many attempts. Try again later.");
  next = mark(next, "reset:email", email, input.now);
  const user = next.accounts.users.find((row) => row.email === email && row.emailVerified);
  if (!user) return done(next, 200, quiet.body);
  const minted = mintToken();
  const note = resetNote(minted.token);
  const resets = next.accounts.resets.filter((row) => row.email !== email || row.usedAt);
  const logged = logAccountMail(
    { ...next.accounts, resets: [...resets, { id: newId(), email, tokenHash: minted.hash, expiresAt: plus(input.now, RESET_MS), usedAt: null }] },
    { kind: "reset", to: email, ...note, at: input.now },
  );
  return done({ ...next, accounts: logged.accounts }, 200, quiet.body);
}

export function completePasswordReset(
  bundle: AccountBundle,
  input: { email: string; token: string; password: string; now: string; csrfToken: string },
): FlowResult {
  const csrf = requireAnonymousCsrf(bundle, input.csrfToken, input.now);
  if (isFlow(csrf)) return csrf;
  const next = csrf.bundle;
  const email = normalizeEmail(input.email);
  const passwordError = passwordProblem(input.password);
  if (passwordError) return fail(next, 400, passwordError);
  const hash = sha256(text(input.token));
  const reset = next.accounts.resets.find((row) => row.email === email && !row.usedAt && row.expiresAt > input.now && row.tokenHash === hash);
  if (!reset) return fail(next, 400, "That reset code is not valid.");
  const user = next.accounts.users.find((row) => row.email === email);
  if (!user) return fail(next, 400, "That reset code is not valid.");
  const accounts: AccountState = {
    ...next.accounts,
    users: next.accounts.users.map((row) => (row.id === user.id ? { ...row, passwordHash: hashPassword(input.password) } : row)),
    resets: next.accounts.resets.map((row) => (row.id === reset.id ? { ...row, usedAt: input.now } : row)),
    sessions: next.accounts.sessions.filter((row) => row.userId !== user.id),
  };
  const opened = openSession({ ...next, accounts }, user.id, input.now, null);
  if (!opened) return fail({ ...next, accounts }, 200, "Password updated.");
  return done(
    opened.bundle,
    200,
    { ok: true, csrfToken: opened.session.csrfToken, tenantId: opened.session.tenantId },
    { "Set-Cookie": sessionCookie(opened.session.id) },
  );
}

export function sessionById(bundle: AccountBundle, sessionId: string | null | undefined): AccountSession | null {
  if (!sessionId) return null;
  const session = bundle.accounts.sessions.find((row) => row.id === sessionId);
  if (!session) return null;
  if (deskRole(bundle.fulfillment, session.userId, session.tenantId) !== session.role && session.role !== "owner") {
    const live = deskRole(bundle.fulfillment, session.userId, session.tenantId);
    if (!live) return null;
  }
  if (!deskRole(bundle.fulfillment, session.userId, session.tenantId)) return null;
  return session;
}

export function requireSessionCsrf(session: AccountSession, token: string): boolean {
  return Boolean(token) && token === session.csrfToken;
}

function foreignTenant(session: AccountSession, claimed: unknown): boolean {
  return typeof claimed === "string" && claimed.trim() !== "" && claimed !== session.tenantId;
}

export function guardSession(
  bundle: AccountBundle,
  session: AccountSession | null,
  input: { csrfToken: string; claimedTenant: unknown; action: AccountAction; csrf?: boolean },
): FlowResult | { session: AccountSession } {
  if (!session) return fail(bundle, 401, "Sign in is required.");
  if (foreignTenant(session, input.claimedTenant)) return fail(bundle, 403, "That workspace is not yours.");
  if (input.csrf !== false && !requireSessionCsrf(session, input.csrfToken)) {
    return fail(bundle, 403, "The form token is missing or expired.");
  }
  const role = deskRole(bundle.fulfillment, session.userId, session.tenantId);
  if (!role || !roleAllows(role, input.action)) return fail(bundle, 403, "You cannot change that.");
  return { session };
}

function asGuard(value: FlowResult | { session: AccountSession }): value is FlowResult {
  return "status" in value;
}

export function readSettings(bundle: AccountBundle, session: AccountSession): FlowResult {
  const brand = brandForBundle(bundle, session.tenantId);
  const checklist = onboardingChecklist(bundle.fulfillment, session.tenantId);
  const billing = planUsageView(bundle.fulfillment, session.tenantId);
  const members = (bundle.fulfillment.memberships || [])
    .filter((row) => row.tenantId === session.tenantId)
    .map((row) => ({ userId: row.userId, email: row.email, role: row.role }));
  return done(bundle, 200, {
    ok: true,
    tenantId: session.tenantId,
    role: session.role,
    brand,
    checklist,
    billing,
    members,
  });
}

export function updateWorkspaceSettings(
  bundle: AccountBundle,
  session: AccountSession,
  input: { name?: string; timezone?: string; now: string },
): FlowResult {
  let fulfillment = bundle.fulfillment;
  if (typeof input.name === "string") {
    const named = confirmWorkspace(fulfillment, session.tenantId, input.name, input.now);
    if (!named.ok) return fail(bundle, 400, named.reason);
    fulfillment = named.state;
  }
  if (typeof input.timezone === "string") {
    const problem = timezoneProblem(input.timezone.trim());
    if (problem) return fail(bundle, 400, problem);
    fulfillment = {
      ...fulfillment,
      workspaces: fulfillment.workspaces.map((row) => (row.id === session.tenantId ? { ...row, timezone: input.timezone?.trim() } : row)),
    };
  }
  const next = { ...bundle, fulfillment };
  return done(next, 200, { ok: true, brand: brandForBundle(next, session.tenantId) });
}

export function updateBranding(
  bundle: AccountBundle,
  session: AccountSession,
  input: { logoUrl?: string; primary?: string; accent?: string; senderDisplayName?: string; timezone?: string },
): FlowResult {
  const workspace = workspaceFor(bundle.fulfillment, session.tenantId);
  if (!workspace) return fail(bundle, 404, "That workspace is not open.");
  const patch: Partial<typeof workspace> = {};
  if (typeof input.logoUrl === "string") {
    const problem = logoUrlProblem(input.logoUrl.trim());
    if (problem) return fail(bundle, 400, problem);
    patch.logoUrl = input.logoUrl.trim();
  }
  if (typeof input.primary === "string") {
    const problem = colorProblem(input.primary.trim());
    if (problem) return fail(bundle, 400, problem);
    patch.brandPrimary = input.primary.trim();
  }
  if (typeof input.accent === "string") {
    const problem = colorProblem(input.accent.trim());
    if (problem) return fail(bundle, 400, problem);
    patch.brandAccent = input.accent.trim();
  }
  if (typeof input.senderDisplayName === "string") {
    const problem = senderProblem(input.senderDisplayName);
    if (problem) return fail(bundle, 400, problem);
    patch.senderDisplayName = input.senderDisplayName.trim();
  }
  if (typeof input.timezone === "string") {
    const problem = timezoneProblem(input.timezone.trim());
    if (problem) return fail(bundle, 400, problem);
    patch.timezone = input.timezone.trim();
  }
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    workspaces: bundle.fulfillment.workspaces.map((row) => (row.id === session.tenantId ? { ...row, ...patch } : row)),
  };
  const next = { ...bundle, fulfillment };
  return done(next, 200, { ok: true, brand: brandForBundle(next, session.tenantId), checklist: onboardingChecklist(fulfillment, session.tenantId) });
}

export function storeLogo(
  bundle: AccountBundle,
  session: AccountSession,
  input: { contentType: string; dataBase64: string; now: string },
): FlowResult {
  if (!LOGO_TYPES.has(input.contentType as LogoContentType)) return fail(bundle, 400, "Use a PNG, JPEG, or WebP logo.");
  const data = input.dataBase64.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data) || data.length === 0 || data.length > 48_000) {
    return fail(bundle, 400, "That logo is empty or too large.");
  }
  const compact = data.replace(/\s+/g, "");
  const logos = [
    ...bundle.accounts.logos.filter((row) => row.tenantId !== session.tenantId),
    { tenantId: session.tenantId, contentType: input.contentType as LogoContentType, dataBase64: compact, updatedAt: input.now },
  ];
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    workspaces: bundle.fulfillment.workspaces.map((row) => (row.id === session.tenantId ? { ...row, logoUrl: "" } : row)),
  };
  const next: AccountBundle = { fulfillment, accounts: { ...bundle.accounts, logos } };
  return done(next, 200, { ok: true, logoStored: true, contentType: input.contentType });
}

export function readLogo(bundle: AccountBundle, session: AccountSession): FlowResult {
  const logo = bundle.accounts.logos.find((row) => row.tenantId === session.tenantId);
  if (!logo) return done(bundle, 200, { ok: true, logo: null });
  return done(bundle, 200, { ok: true, logo: { contentType: logo.contentType, dataBase64: logo.dataBase64 } });
}

export function readBilling(bundle: AccountBundle, session: AccountSession): FlowResult {
  const billing = planUsageView(bundle.fulfillment, session.tenantId);
  if (!billing) return fail(bundle, 404, "That workspace is not open.");
  return done(bundle, 200, { ok: true, billing });
}

export function choosePlan(bundle: AccountBundle, session: AccountSession, planId: string, now: string): FlowResult {
  const checked = fakeBilling.checkout(bundle.fulfillment, session.tenantId, planId, now, `signup-${session.tenantId}-${planId}`);
  if (!checked.ok) return fail(bundle, 400, checked.reason);
  if (checked.event.amountCents !== 0) return fail(bundle, 400, "Only a zero-amount test plan can be recorded.");
  if (checked.state.invoices.some((row) => row.tenantId === session.tenantId && row.amountCents !== 0)) {
    return fail(bundle, 400, "Only a zero-amount test plan can be recorded.");
  }
  const next = { ...bundle, fulfillment: checked.state };
  return done(next, 200, { ok: true, billing: planUsageView(next.fulfillment, session.tenantId), checklist: onboardingChecklist(next.fulfillment, session.tenantId) });
}

export function listMembers(bundle: AccountBundle, session: AccountSession): FlowResult {
  const members = (bundle.fulfillment.memberships || [])
    .filter((row) => row.tenantId === session.tenantId)
    .map((row) => ({ userId: row.userId, email: row.email, role: row.role }));
  return done(bundle, 200, { ok: true, members });
}

function dropSessions(bundle: AccountBundle, userId: string): AccountBundle {
  return { ...bundle, accounts: { ...bundle.accounts, sessions: bundle.accounts.sessions.filter((row) => row.userId !== userId) } };
}

export function changeMemberRole(
  bundle: AccountBundle,
  session: AccountSession,
  input: { userId: string; role: string },
): FlowResult {
  const role = input.role;
  if (role !== "admin" && role !== "member") return fail(bundle, 400, "Choose admin or member.");
  const membership = (bundle.fulfillment.memberships || []).find((row) => row.tenantId === session.tenantId && row.userId === input.userId);
  if (!membership) return fail(bundle, 404, "That person is not in this workspace.");
  if (membership.role === "owner" || membership.userId === workspaceFor(bundle.fulfillment, session.tenantId)?.ownerUserId) {
    return fail(bundle, 403, "The owner cannot be changed.");
  }
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    memberships: bundle.fulfillment.memberships.map((row) =>
      row.tenantId === session.tenantId && row.userId === input.userId ? { ...row, role: role as DeskRole } : row,
    ),
  };
  const next = dropSessions({ ...bundle, fulfillment }, input.userId);
  return done(next, 200, { ok: true });
}

export function removeMember(bundle: AccountBundle, session: AccountSession, userId: string): FlowResult {
  const workspace = workspaceFor(bundle.fulfillment, session.tenantId);
  const membership = (bundle.fulfillment.memberships || []).find((row) => row.tenantId === session.tenantId && row.userId === userId);
  if (!membership) return fail(bundle, 404, "That person is not in this workspace.");
  if (membership.role === "owner" || userId === workspace?.ownerUserId) return fail(bundle, 403, "The owner cannot be removed.");
  const actor = deskRole(bundle.fulfillment, session.userId, session.tenantId);
  if (actor === "admin" && membership.role === "admin") return fail(bundle, 403, "You cannot change that.");
  if (actor !== "owner" && actor !== "admin") return fail(bundle, 403, "You cannot change that.");
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    memberships: bundle.fulfillment.memberships.filter((row) => !(row.tenantId === session.tenantId && row.userId === userId)),
  };
  return done(dropSessions({ ...bundle, fulfillment }, userId), 200, { ok: true });
}

export function inviteMember(bundle: AccountBundle, session: AccountSession, emailRaw: string, now: string): FlowResult {
  const email = normalizeEmail(emailRaw);
  if (!isEmailShape(email)) return fail(bundle, 400, "Enter an email address.");
  const existing = (bundle.fulfillment.invites || []).find((row) => row.tenantId === session.tenantId && row.email === email && row.status === "pending");
  if (existing) return done(bundle, 200, { ok: true, inviteId: existing.id });
  const invite: MarketerInvite = {
    id: newId(),
    tenantId: session.tenantId,
    email,
    status: "pending",
    invitedByUserId: session.userId,
    createdAt: now,
  };
  const fulfillment: FulfillmentState = { ...bundle.fulfillment, invites: [...(bundle.fulfillment.invites || []), invite] };
  return done({ ...bundle, fulfillment }, 200, { ok: true, inviteId: invite.id });
}

export function readOnboarding(bundle: AccountBundle, session: AccountSession): FlowResult {
  const checklist = onboardingChecklist(bundle.fulfillment, session.tenantId);
  return done(bundle, 200, { ok: true, checklist, brand: brandForBundle(bundle, session.tenantId) });
}

export function addFirstClient(bundle: AccountBundle, session: AccountSession, name: string, now: string): FlowResult {
  const added = addClient(bundle.fulfillment, session.tenantId, name, now);
  if (!added.ok) return fail({ ...bundle, fulfillment: added.state }, 400, added.reason);
  const next = { ...bundle, fulfillment: added.state };
  return done(next, 200, { ok: true, checklist: onboardingChecklist(next.fulfillment, session.tenantId) });
}

export function addFirstPackage(
  bundle: AccountBundle,
  session: AccountSession,
  input: { clientName: string; packageId: string; now: string },
): FlowResult {
  const recorded = recordPurchase(bundle.fulfillment, session.tenantId, {
    clientName: input.clientName,
    packageId: input.packageId as never,
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, input.now);
  if (!recorded.ok) return fail({ ...bundle, fulfillment: recorded.state }, 400, recorded.reason);
  const next = { ...bundle, fulfillment: recorded.state };
  return done(next, 200, { ok: true, checklist: onboardingChecklist(next.fulfillment, session.tenantId) });
}

export function readShell(bundle: AccountBundle, session: AccountSession): FlowResult {
  const brand = brandForBundle(bundle, session.tenantId);
  if (!brand) return fail(bundle, 404, "That workspace is not open.");
  return done(bundle, 200, {
    ok: true,
    tenantId: brand.tenantId,
    senderDisplayName: brand.senderDisplayName,
    primary: brand.primary,
    accent: brand.accent,
    timezone: brand.timezone,
  });
}

export function readClientView(bundle: AccountBundle, session: AccountSession): FlowResult {
  const brand = brandForBundle(bundle, session.tenantId);
  const clients = bundle.fulfillment.clients.filter((row) => row.tenantId === session.tenantId).map((row) => ({ id: row.id, name: row.name }));
  return done(bundle, 200, { ok: true, tenantId: session.tenantId, brand, clients });
}
