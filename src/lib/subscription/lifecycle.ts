import type { AccountBundle } from "../account/types.ts";
import { sliceTenant, workspaceFor } from "../packages/tenancy.ts";
import type { ClosureSnapshot, FulfillmentState, Workspace } from "../packages/types.ts";

export const RESTORE_MS = 30 * 24 * 60 * 60 * 1000;

const KILL_KEYS = [
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

type KillKey = (typeof KILL_KEYS)[number];

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function killsOf(workspace: Workspace): ClosureSnapshot["kills"] {
  return {
    leadFollowUpKillSwitch: workspace.leadFollowUpKillSwitch === true,
    leadGenerationKillSwitch: workspace.leadGenerationKillSwitch === true,
    aiVisibilityKillSwitch: workspace.aiVisibilityKillSwitch === true,
    reviewsKillSwitch: workspace.reviewsKillSwitch === true,
    appointmentRemindersKillSwitch: workspace.appointmentRemindersKillSwitch === true,
    estimateFollowUpsKillSwitch: workspace.estimateFollowUpsKillSwitch === true,
    googleAdsKillSwitch: workspace.googleAdsKillSwitch === true,
    metaAdsKillSwitch: workspace.metaAdsKillSwitch === true,
    officeAutomationKillSwitch: workspace.officeAutomationKillSwitch === true,
  };
}

function withKills(workspace: Workspace, kills: ClosureSnapshot["kills"]): Workspace {
  const next = { ...workspace };
  for (const key of KILL_KEYS) next[key] = kills[key];
  return next;
}

function allKilled(workspace: Workspace): Workspace {
  const kills = { ...killsOf(workspace) };
  for (const key of KILL_KEYS) kills[key as KillKey] = true;
  return withKills(workspace, kills);
}

function openClosure(state: FulfillmentState, tenantId: string): ClosureSnapshot | null {
  const rows = (state.closures || []).filter((row) => row.tenantId === tenantId && !row.restoredAt);
  return rows[rows.length - 1] || null;
}

export function exportWorkspace(bundle: AccountBundle, tenantId: string, now: string): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace) return { ok: false, reason: "That workspace is not open." };
  const slice = sliceTenant(bundle.fulfillment, tenantId);
  const memberIds = new Set(slice.memberships.map((row) => row.userId));
  const people = bundle.accounts.users
    .filter((row) => memberIds.has(row.id))
    .map((row) => ({ id: row.id, email: row.email, name: row.name, emailVerified: row.emailVerified }));
  const logos = bundle.accounts.logos
    .filter((row) => row.tenantId === tenantId)
    .map((row) => ({ contentType: row.contentType, dataBase64: row.dataBase64, updatedAt: row.updatedAt }));
  const mail = (bundle.accounts.transactional || [])
    .filter((row) => row.tenantId === tenantId)
    .map((row) => ({ id: row.id, kind: row.kind, to: row.to, subject: row.subject, mode: row.mode, at: row.at }));
  return {
    ok: true,
    body: {
      ok: true,
      tenantId,
      exportedAt: now,
      people,
      logos,
      mail,
      fulfillment: slice,
    },
  };
}

export function closeWorkspace(bundle: AccountBundle, tenantId: string, now: string, id: string): { ok: true; bundle: AccountBundle; restoreUntil: string } | { ok: false; bundle: AccountBundle; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace) return { ok: false, bundle, reason: "That workspace is not open." };
  if (workspace.closedAt) return { ok: false, bundle, reason: "This workspace is already closed." };
  const restoreUntil = plus(now, RESTORE_MS);
  const snapshot: ClosureSnapshot = {
    id,
    tenantId,
    closedAt: now,
    restoreUntil,
    restoredAt: null,
    kills: killsOf(workspace),
    enrollmentKills: (bundle.fulfillment.enrollments || [])
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({ id: row.id, killSwitch: row.killSwitch === true })),
  };
  const closed = allKilled({ ...workspace, closedAt: now, restoreUntil });
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    workspaces: bundle.fulfillment.workspaces.map((row) => (row.id === tenantId ? closed : row)),
    enrollments: bundle.fulfillment.enrollments.map((row) => (row.tenantId === tenantId ? { ...row, killSwitch: true } : row)),
    closures: [...(bundle.fulfillment.closures || []), snapshot],
  };
  return {
    ok: true,
    restoreUntil,
    bundle: {
      fulfillment,
      accounts: {
        ...bundle.accounts,
        sessions: bundle.accounts.sessions.filter((row) => row.tenantId !== tenantId),
      },
    },
  };
}

export function restoreWorkspace(bundle: AccountBundle, tenantId: string, now: string): { ok: true; bundle: AccountBundle } | { ok: false; bundle: AccountBundle; reason: string } {
  const workspace = workspaceFor(bundle.fulfillment, tenantId);
  if (!workspace?.closedAt) return { ok: false, bundle, reason: "This workspace is not closed." };
  const snapshot = openClosure(bundle.fulfillment, tenantId);
  if (!snapshot) return { ok: false, bundle, reason: "This workspace is not closed." };
  if (now > snapshot.restoreUntil) return { ok: false, bundle, reason: "The 30 day restore window has ended." };
  const restored = withKills({ ...workspace, closedAt: null, restoreUntil: null }, snapshot.kills);
  const kills = new Map(snapshot.enrollmentKills.map((row) => [row.id, row.killSwitch]));
  const fulfillment: FulfillmentState = {
    ...bundle.fulfillment,
    workspaces: bundle.fulfillment.workspaces.map((row) => (row.id === tenantId ? restored : row)),
    enrollments: bundle.fulfillment.enrollments.map((row) =>
      row.tenantId === tenantId && kills.has(row.id) ? { ...row, killSwitch: kills.get(row.id) === true } : row,
    ),
    closures: (bundle.fulfillment.closures || []).map((row) => (row.id === snapshot.id ? { ...row, restoredAt: now } : row)),
  };
  return { ok: true, bundle: { ...bundle, fulfillment } };
}
