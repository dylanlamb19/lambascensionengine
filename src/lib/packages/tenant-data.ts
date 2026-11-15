import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState } from "./types.ts";

export type TenantSession = { userId: string; tenantId: string };

export function sessionCanAccess(state: FulfillmentState, userId: string, tenantId: string): boolean {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || !userId) return false;
  if (workspace.ownerUserId === userId) return true;
  return (state.memberships || []).some((row) => row.tenantId === tenantId && row.userId === userId && row.status === "accepted");
}

export type ReadResult<T> = { ok: true; rows: T[] } | { ok: false; reason: string; rows: [] };

/** Read rows for the session tenant only. A different tenant id returns no rows. */
export function readTenant<T extends { tenantId: string }>(
  state: FulfillmentState,
  session: TenantSession,
  rows: T[],
): ReadResult<T> {
  if (!session.userId || !session.tenantId) return { ok: false, reason: "Sign in is required.", rows: [] };
  if (!sessionCanAccess(state, session.userId, session.tenantId)) {
    return { ok: false, reason: "That workspace is not yours.", rows: [] };
  }
  return { ok: true, rows: rows.filter((row) => row.tenantId === session.tenantId) };
}

export type WriteResult = { ok: true; state: FulfillmentState } | { ok: false; state: FulfillmentState; reason: string };

/** Insert a row only when its tenant matches the session. Otherwise the state is unchanged. */
export function writeTenant<T extends { tenantId: string }>(
  state: FulfillmentState,
  session: TenantSession,
  row: T,
  apply: (state: FulfillmentState, row: T) => FulfillmentState,
): WriteResult {
  if (!session.userId || !session.tenantId) return { ok: false, state, reason: "Sign in is required." };
  if (row.tenantId !== session.tenantId || !sessionCanAccess(state, session.userId, session.tenantId)) {
    return { ok: false, state, reason: "Cross-tenant write blocked." };
  }
  return { ok: true, state: apply(state, row) };
}

/** SQL predicate used by the RLS policies. The setting name is the tenant id. */
export const TENANT_SETTING = "app.tenant_id";

export function tenantPredicate(column: string): string {
  return `${column} = nullif(current_setting('${TENANT_SETTING}', true), '')`;
}
