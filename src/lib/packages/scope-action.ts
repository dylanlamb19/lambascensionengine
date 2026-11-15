import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { FLAGS } from "@/lib/flags";
import { planTenantScope } from "./tenant-scope";

/**
 * Request path for package fulfillment. The tenant id is the verified session
 * user, set only for this transaction. The flag skips the database entirely.
 */
export const scopePackageTenantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!FLAGS.PACKAGE_FULFILLMENT) return { ok: false as const, reason: "Package fulfillment is off." };
    const plan = planTenantScope(context.userId, null);
    if (!plan.ok) return { ok: false as const, reason: plan.reason };
    const { withSqlTransaction } = await import("@/lib/db");
    const applied = await withSqlTransaction(async (sql) => {
      await sql.query(plan.text, [...plan.params]);
      const rows = await sql<{ tenant: string | null }>`select current_setting('app.tenant_id', true) as tenant`;
      return rows[0]?.tenant ?? null;
    });
    return { ok: true as const, tenantId: plan.tenantId, applied: applied === plan.tenantId };
  });
