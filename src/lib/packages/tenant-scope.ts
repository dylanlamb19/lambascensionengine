import { workspaceIdForUser } from "./tenancy.ts";
import { TENANT_SETTING } from "./tenant-data.ts";

export type TenantScopePlan =
  | { ok: true; tenantId: string; setting: typeof TENANT_SETTING; local: true; text: string; params: [string, true] }
  | { ok: false; reason: string };

/**
 * Tenant for a request. The id always comes from the verified user id.
 * A caller-supplied tenant that does not match is rejected.
 * The setting is transaction-local (`set_config` third argument true).
 */
export function planTenantScope(verifiedUserId: string, claimedTenantId?: string | null): TenantScopePlan {
  const tenantId = workspaceIdForUser(verifiedUserId);
  if (!tenantId) return { ok: false, reason: "Sign in is required before a workspace can be scoped." };
  if (claimedTenantId && claimedTenantId !== tenantId) {
    return { ok: false, reason: "That workspace does not match the signed-in marketer." };
  }
  return {
    ok: true,
    tenantId,
    setting: TENANT_SETTING,
    local: true,
    text: "select set_config('app.tenant_id', $1, $2)",
    params: [tenantId, true],
  };
}

export type ScopeExec = (text: string, params: readonly unknown[]) => Promise<void>;

/** Apply the tenant setting inside an already-open transaction, then run the work. */
export async function applyTenantScope<T>(
  verifiedUserId: string,
  claimedTenantId: string | null,
  exec: ScopeExec,
  work: (tenantId: string) => Promise<T>,
): Promise<{ ok: true; tenantId: string; value: T } | { ok: false; reason: string }> {
  const plan = planTenantScope(verifiedUserId, claimedTenantId);
  if (!plan.ok) return plan;
  await exec(plan.text, plan.params);
  const value = await work(plan.tenantId);
  return { ok: true, tenantId: plan.tenantId, value };
}
