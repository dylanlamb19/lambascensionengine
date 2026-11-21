import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState } from "../packages/types.ts";
import type { DeskRole } from "./types.ts";

export type AccountAction =
  | "settings:read"
  | "settings:write"
  | "billing:read"
  | "billing:write"
  | "invite"
  | "members:write"
  | "members:remove";

const ALLOWED: Record<AccountAction, readonly DeskRole[]> = {
  "settings:read": ["owner", "admin", "member"],
  "settings:write": ["owner", "admin"],
  "billing:read": ["owner", "admin", "member"],
  "billing:write": ["owner"],
  "invite": ["owner", "admin"],
  "members:write": ["owner"],
  "members:remove": ["owner", "admin"],
};

export function deskRole(state: FulfillmentState, userId: string, tenantId: string): DeskRole | null {
  if (!userId || !tenantId) return null;
  const workspace = workspaceFor(state, tenantId);
  if (workspace?.ownerUserId === userId) return "owner";
  const membership = (state.memberships || []).find((row) => row.tenantId === tenantId && row.userId === userId && row.status === "accepted");
  if (!membership) return null;
  if (membership.role === "owner") return "owner";
  if (membership.role === "admin") return "admin";
  return "member";
}

export function roleAllows(role: DeskRole | null, action: AccountAction): boolean {
  if (!role) return false;
  return ALLOWED[action].includes(role);
}

export function homeForUser(state: FulfillmentState, userId: string): { tenantId: string; role: DeskRole } | null {
  const owned = (state.workspaces || []).find((row) => row.ownerUserId === userId);
  if (owned) return { tenantId: owned.id, role: "owner" };
  const membership = (state.memberships || []).find((row) => row.userId === userId && row.status === "accepted");
  if (!membership) return null;
  return { tenantId: membership.tenantId, role: deskRole(state, userId, membership.tenantId) || "member" };
}
