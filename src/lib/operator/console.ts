import { newId } from "../account/crypto.ts";
import type { AccountBundle, AccountSession, OperatorAuditAction } from "../account/types.ts";
import { limitBanners, readingsFor } from "../entitlements/meter.ts";
import { resolveEntitledPlan } from "../entitlements/resolve.ts";
import { fulfillmentHealthSummary } from "../packages/health.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState, Workspace } from "../packages/types.ts";
import { subscriptionFor } from "../subscription/billing.ts";

const KILL_FIELDS = [
  "leadFollowUpKillSwitch",
  "leadGenerationKillSwitch",
  "aiVisibilityKillSwitch",
  "reviewsKillSwitch",
  "appointmentRemindersKillSwitch",
  "estimateFollowUpsKillSwitch",
  "googleAdsKillSwitch",
  "metaAdsKillSwitch",
  "officeAutomationKillSwitch",
] as const;

export function isPlatformOperator(bundle: AccountBundle, userId: string): boolean {
  return (bundle.accounts.platformOperators || []).some((row) => row.userId === userId);
}

/** Records the Lasengine owner. A workspace role does not grant this. */
export function grantPlatformOperator(bundle: AccountBundle, userId: string, now: string): { ok: true; bundle: AccountBundle } | { ok: false; bundle: AccountBundle; reason: string } {
  const user = bundle.accounts.users.find((row) => row.id === userId);
  if (!user) return { ok: false, bundle, reason: "That person does not have an account." };
  if (isPlatformOperator(bundle, userId)) return { ok: true, bundle };
  return {
    ok: true,
    bundle: {
      ...bundle,
      accounts: {
        ...bundle.accounts,
        platformOperators: [...(bundle.accounts.platformOperators || []), { userId, email: user.email, grantedAt: now }],
      },
    },
  };
}

function audit(bundle: AccountBundle, actorUserId: string, action: OperatorAuditAction, tenantId: string | null, now: string): AccountBundle {
  return {
    ...bundle,
    accounts: {
      ...bundle.accounts,
      operatorAudit: [
        ...(bundle.accounts.operatorAudit || []),
        { id: newId(), actorUserId, action, tenantId, at: now },
      ],
    },
  };
}

function tenantSummary(state: FulfillmentState, workspace: Workspace, now: string) {
  const plan = resolveEntitledPlan(state, workspace.id);
  const sub = subscriptionFor(state, workspace.id);
  const readings = readingsFor(state, workspace.id, now, plan);
  return {
    tenantId: workspace.id,
    name: workspace.name,
    planId: plan?.id || null,
    planName: plan?.name || null,
    subscriptionStatus: workspace.subscriptionStatus,
    scaffoldStatus: sub?.status || null,
    trialEndsAt: sub?.trialEndsAt || null,
    suspended: workspace.operatorSuspended === true,
    closedAt: workspace.closedAt || null,
    amountCents: 0 as const,
    billingMode: "test" as const,
    usage: readings,
    banners: limitBanners(plan, readings),
    health: fulfillmentHealthSummary(state, workspace.id),
  };
}

export function listOperatorTenants(bundle: AccountBundle, actorUserId: string, now: string): AccountBundle {
  return audit(bundle, actorUserId, "list_tenants", null, now);
}

export function operatorTenantList(bundle: AccountBundle, now: string) {
  return (bundle.fulfillment.workspaces || []).map((workspace) => tenantSummary(bundle.fulfillment, workspace, now));
}

export function viewOperatorTenant(
  bundle: AccountBundle,
  actorUserId: string,
  tenantId: string,
  now: string,
): { ok: true; bundle: AccountBundle; tenant: ReturnType<typeof tenantSummary> } | { ok: false; bundle: AccountBundle; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace) return { ok: false, bundle, reason: "That workspace is not open." };
  const next = audit(bundle, actorUserId, "view_tenant", tenantId, now);
  return { ok: true, bundle: next, tenant: tenantSummary(next.fulfillment, workspace, now) };
}

function patchWorkspace(state: FulfillmentState, tenantId: string, patch: (workspace: Workspace) => Workspace): FulfillmentState {
  return {
    ...state,
    workspaces: state.workspaces.map((row) => (row.id === tenantId ? patch(row) : row)),
  };
}

export function suspendTenant(
  bundle: AccountBundle,
  actorUserId: string,
  tenantId: string,
  now: string,
): { ok: true; bundle: AccountBundle } | { ok: false; bundle: AccountBundle; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace) return { ok: false, bundle, reason: "That workspace is not open." };
  const fulfillment = patchWorkspace(bundle.fulfillment, tenantId, (row) => ({ ...row, operatorSuspended: true }));
  return { ok: true, bundle: audit({ ...bundle, fulfillment }, actorUserId, "suspend", tenantId, now) };
}

export function resumeTenant(
  bundle: AccountBundle,
  actorUserId: string,
  tenantId: string,
  now: string,
): { ok: true; bundle: AccountBundle } | { ok: false; bundle: AccountBundle; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace) return { ok: false, bundle, reason: "That workspace is not open." };
  const fulfillment = patchWorkspace(bundle.fulfillment, tenantId, (row) => ({ ...row, operatorSuspended: false }));
  return { ok: true, bundle: audit({ ...bundle, fulfillment }, actorUserId, "resume", tenantId, now) };
}

/** Stops pipelines in one workspace. Does not open a session as that workspace. */
export function killTenantPipelines(
  bundle: AccountBundle,
  actorUserId: string,
  tenantId: string,
  now: string,
): { ok: true; bundle: AccountBundle } | { ok: false; bundle: AccountBundle; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace) return { ok: false, bundle, reason: "That workspace is not open." };
  const killed = patchWorkspace(bundle.fulfillment, tenantId, (row) => {
    const next = { ...row };
    for (const key of KILL_FIELDS) next[key] = true;
    return next;
  });
  const fulfillment: FulfillmentState = {
    ...killed,
    enrollments: killed.enrollments.map((row) => row.tenantId === tenantId && row.status !== "cancelled" ? { ...row, killSwitch: true } : row),
  };
  return { ok: true, bundle: audit({ ...bundle, fulfillment }, actorUserId, "kill_pipelines", tenantId, now) };
}

export function sessionUnchanged(before: AccountSession, bundle: AccountBundle): boolean {
  const after = bundle.accounts.sessions.find((row) => row.id === before.id);
  return Boolean(after && after.tenantId === before.tenantId && after.userId === before.userId && after.role === before.role);
}
