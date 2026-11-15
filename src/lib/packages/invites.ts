import { EMAIL_PASSWORD_SIGN_UP_DISABLED } from "../auth/email-password.ts";
import { startMarketerOnboarding, workspaceFor, type OnboardingResult } from "./tenancy.ts";
import type { FulfillmentState, MarketerInvite, WorkspaceMembership } from "./types.ts";

export function publicSignupRemainsDisabled(): boolean {
  return EMAIL_PASSWORD_SIGN_UP_DISABLED === true;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function owns(state: FulfillmentState, tenantId: string, userId: string): boolean {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.ownerUserId !== userId) return false;
  return true;
}

export type InviteResult =
  | { ok: true; state: FulfillmentState; invite: MarketerInvite }
  | { ok: false; state: FulfillmentState; reason: string };

/**
 * Invite another marketer into this workspace.
 * Does not send mail and does not create a login. Public signup stays closed.
 */
export function inviteMarketer(
  state: FulfillmentState,
  tenantId: string,
  actorUserId: string,
  email: string,
  now: string,
  enabled: boolean,
  id = `inv_${now}`,
): InviteResult {
  if (!enabled) return { ok: false, state, reason: "Package fulfillment is off." };
  if (!publicSignupRemainsDisabled()) {
    return { ok: false, state, reason: "Refusing to invite while public registration is open." };
  }
  if (!owns(state, tenantId, actorUserId)) return { ok: false, state, reason: "Only this workspace's owner can invite." };
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { ok: false, state, reason: "Enter an email address." };
  const existing = (state.invites || []).find((row) => row.tenantId === tenantId && row.email === normalized && row.status === "pending");
  if (existing) return { ok: true, state, invite: existing };
  const invite: MarketerInvite = {
    id,
    tenantId,
    email: normalized,
    status: "pending",
    invitedByUserId: actorUserId,
    createdAt: now,
  };
  return { ok: true, invite, state: { ...state, invites: [...(state.invites || []), invite] } };
}

export function acceptInvite(
  state: FulfillmentState,
  inviteId: string,
  userId: string,
  email: string,
  _now: string,
  enabled: boolean,
): InviteResult {
  if (!enabled) return { ok: false, state, reason: "Package fulfillment is off." };
  if (!userId.trim()) return { ok: false, state, reason: "Public registration is closed. Sign in is required." };
  const invite = (state.invites || []).find((row) => row.id === inviteId);
  if (!invite || invite.status !== "pending") return { ok: false, state, reason: "That invite is not open." };
  if (normalizeEmail(email) !== invite.email) return { ok: false, state, reason: "This invite is for a different email." };
  const membership: WorkspaceMembership = {
    tenantId: invite.tenantId,
    userId: userId.trim(),
    email: invite.email,
    role: "marketer",
    status: "accepted",
  };
  const already = (state.memberships || []).some((row) => row.tenantId === membership.tenantId && row.userId === membership.userId);
  return {
    ok: true,
    invite: { ...invite, status: "accepted" },
    state: {
      ...state,
      invites: state.invites.map((row) => (row.id === inviteId ? { ...row, status: "accepted" as const } : row)),
      memberships: already ? state.memberships : [...(state.memberships || []), membership],
    },
  };
}

/**
 * Open a workspace for a person who is already signed in.
 * The fulfillment flag must be on. This does not create an auth user.
 */
export function beginMarketerSignup(
  state: FulfillmentState,
  input: { enabled: boolean; userId: string; email: string; workspaceName: string; now: string },
): OnboardingResult {
  if (!input.enabled) return { ok: false, state, reason: "Package fulfillment is off." };
  if (!publicSignupRemainsDisabled()) {
    return { ok: false, state, reason: "Refusing signup while public registration is open." };
  }
  if (!input.userId.trim()) {
    return { ok: false, state, reason: "Public registration is closed. Sign in is required." };
  }
  return startMarketerOnboarding(state, { userId: input.userId, workspaceName: input.workspaceName, now: input.now });
}
