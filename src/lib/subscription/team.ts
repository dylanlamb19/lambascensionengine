import { deliverTransactional } from "../transactional/send.ts";
import type { AccountBundle, DeskRole } from "../account/types.ts";
import { mintToken, sha256 } from "../account/crypto.ts";
import { entitlementPreface, seatCapBlock } from "../entitlements/access.ts";
import { syncMeter } from "../entitlements/meter.ts";
import { entitlementsOn } from "../entitlements/plans.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState, SeatInvite } from "../packages/types.ts";
import { scaffoldAccessBlock } from "../packages/usage.ts";
import { isScaffoldPlanId, scaffoldPlan } from "./plans.ts";
import { subscriptionFor } from "./billing.ts";

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamResult =
  | { ok: true; bundle: AccountBundle; invite?: SeatInvite; token?: string }
  | { ok: false; bundle: AccountBundle; reason: string };

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function seatsInUse(state: FulfillmentState, tenantId: string, now: string): number {
  const members = (state.memberships || []).filter((row) => row.tenantId === tenantId && row.status === "accepted").length;
  const pending = (state.seatInvites || []).filter((row) => row.tenantId === tenantId && !row.usedAt && row.expiresAt > now).length;
  return members + pending;
}

export function seatLimitFor(state: FulfillmentState, tenantId: string): number | null {
  const sub = subscriptionFor(state, tenantId);
  if (!sub || !isScaffoldPlanId(sub.planId)) return null;
  return scaffoldPlan(sub.planId).seatLimit;
}

function inviteNote(token: string, workspaceName: string, role: string): { subject: string; body: string } {
  return {
    subject: `Join ${workspaceName}`,
    body: [
      `You were invited to ${workspaceName} as ${role}.`,
      "This note was recorded in dry-run mode. Nothing was sent.",
      `code: ${token}`,
    ].join("\n"),
  };
}

export function inviteSeat(
  bundle: AccountBundle,
  input: { tenantId: string; actorUserId: string; email: string; role: string; now: string },
  options?: { entitlements?: boolean },
): TeamResult {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, bundle, reason: "Enter an email address." };
  if (input.role !== "admin" && input.role !== "member") return { ok: false, bundle, reason: "Choose admin or member." };
  const workspace = workspaceFor(bundle.fulfillment, input.tenantId);
  if (!workspace) return { ok: false, bundle, reason: "That workspace is not open." };
  const entitled = entitlementsOn(options?.entitlements);
  if (entitled) {
    const preface = entitlementPreface(bundle.fulfillment, input.tenantId, input.now);
    if (preface) return { ok: false, bundle, reason: preface };
  } else {
    const blocked = scaffoldAccessBlock(bundle.fulfillment, input.tenantId, input.now);
    if (blocked) return { ok: false, bundle, reason: blocked };
    const limit = seatLimitFor(bundle.fulfillment, input.tenantId);
    if (limit == null) return { ok: false, bundle, reason: "Choose a test plan before inviting someone." };
  }
  const existing = (bundle.fulfillment.seatInvites || []).find((row) => row.tenantId === input.tenantId && row.email === email && !row.usedAt && row.expiresAt > input.now);
  if (existing) return { ok: true, bundle, invite: existing };
  if (entitled) {
    const cap = seatCapBlock(bundle.fulfillment, input.tenantId, input.now);
    if (cap) return { ok: false, bundle, reason: cap };
  } else {
    const limit = seatLimitFor(bundle.fulfillment, input.tenantId);
    if (limit != null && seatsInUse(bundle.fulfillment, input.tenantId, input.now) >= limit) {
      return { ok: false, bundle, reason: `This test plan records up to ${limit} people. No one was invited.` };
    }
  }
  const already = (bundle.fulfillment.memberships || []).some((row) => row.tenantId === input.tenantId && row.email === email);
  if (already) return { ok: false, bundle, reason: "That person is already in this workspace." };
  const minted = mintToken();
  const invite: SeatInvite = {
    id: minted.hash.slice(0, 24),
    tenantId: input.tenantId,
    email,
    role: input.role,
    tokenHash: minted.hash,
    expiresAt: plus(input.now, INVITE_MS),
    usedAt: null,
    invitedByUserId: input.actorUserId,
    createdAt: input.now,
  };
  const note = inviteNote(minted.token, workspace.name, input.role);
  const delivered = deliverTransactional(bundle.accounts.transactional || [], {
    kind: "invite",
    to: email,
    subject: note.subject,
    body: note.body,
    tenantId: input.tenantId,
    at: input.now,
  });
  let fulfillment: FulfillmentState = { ...bundle.fulfillment, seatInvites: [...(bundle.fulfillment.seatInvites || []), invite] };
  if (entitled) fulfillment = syncMeter(fulfillment, input.tenantId, input.now);
  return {
    ok: true,
    invite,
    bundle: { fulfillment, accounts: { ...bundle.accounts, transactional: delivered.log } },
  };
}

export function acceptSeat(
  bundle: AccountBundle,
  input: { userId: string; email: string; token: string; now: string },
): TeamResult {
  const email = normalizeEmail(input.email);
  const hash = sha256(input.token || "");
  const invite = (bundle.fulfillment.seatInvites || []).find((row) => row.tokenHash === hash);
  if (!invite) return { ok: false, bundle, reason: "That invite is not valid." };
  if (invite.usedAt) return { ok: false, bundle, reason: "That invite was already used." };
  if (invite.expiresAt <= input.now) return { ok: false, bundle, reason: "That invite has expired." };
  if (invite.email !== email) return { ok: false, bundle, reason: "This invite is for a different email." };
  const blocked = scaffoldAccessBlock(bundle.fulfillment, invite.tenantId, input.now);
  if (blocked) return { ok: false, bundle, reason: blocked };
  const limit = seatLimitFor(bundle.fulfillment, invite.tenantId);
  if (limit == null) return { ok: false, bundle, reason: "Choose a test plan before inviting someone." };
  const members = (bundle.fulfillment.memberships || []).filter((row) => row.tenantId === invite.tenantId && row.status === "accepted").length;
  const otherPending = (bundle.fulfillment.seatInvites || []).filter((row) => row.tenantId === invite.tenantId && row.id !== invite.id && !row.usedAt && row.expiresAt > input.now).length;
  const already = (bundle.fulfillment.memberships || []).some((row) => row.tenantId === invite.tenantId && row.userId === input.userId);
  if (!already && members + otherPending + 1 > limit) {
    return { ok: false, bundle, reason: `This test plan records up to ${limit} people. The invite was not accepted.` };
  }
  const used: SeatInvite = { ...invite, usedAt: input.now };
  const memberships = already
    ? bundle.fulfillment.memberships
    : [...(bundle.fulfillment.memberships || []), { tenantId: invite.tenantId, userId: input.userId, email, role: invite.role, status: "accepted" as const }];
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    memberships,
    seatInvites: (bundle.fulfillment.seatInvites || []).map((row) => (row.id === invite.id ? used : row)),
  };
  return { ok: true, invite: used, bundle: { ...bundle, fulfillment } };
}

export function transferOwnership(
  state: FulfillmentState,
  tenantId: string,
  fromUserId: string,
  toUserId: string,
): { ok: true; state: FulfillmentState } | { ok: false; state: FulfillmentState; reason: string } {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, state, reason: "That workspace is not open." };
  if (workspace.ownerUserId !== fromUserId) return { ok: false, state, reason: "Only the owner can transfer this workspace." };
  if (fromUserId === toUserId) return { ok: false, state, reason: "Choose someone else." };
  const target = (state.memberships || []).find((row) => row.tenantId === tenantId && row.userId === toUserId && row.status === "accepted");
  if (!target || target.role === "owner") return { ok: false, state, reason: "That person is not in this workspace." };
  const owner = (state.memberships || []).find((row) => row.tenantId === tenantId && row.userId === fromUserId);
  return {
    ok: true,
    state: {
      ...state,
      workspaces: state.workspaces.map((row) => (row.id === tenantId ? { ...row, ownerUserId: toUserId } : row)),
      memberships: (state.memberships || []).map((row) => {
        if (row.tenantId !== tenantId) return row;
        if (row.userId === toUserId) return { ...row, role: "owner" as DeskRole };
        if (row.userId === fromUserId || row.userId === owner?.userId) return { ...row, role: "admin" as DeskRole };
        return row;
      }),
    },
  };
}
