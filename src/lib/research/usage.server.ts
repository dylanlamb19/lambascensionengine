/**
 * Server-authoritative daily caps for paid Hunter enrichment.
 *
 * Flow (cost-safe):
 *   1. Free research + qualification (no Hunter).
 *   2. If qualified AND a Hunter key exists, atomically RESERVE one slot
 *      (user daily cap AND global app daily cap) in a SQL transaction.
 *   3. If reservation fails, DO NOT call Hunter.
 *   4. If reservation succeeds, call Hunter.
 *
 * Failed / rejected Hunter requests still CONSUME the reservation. We do not
 * refund: a 401/500/timeout already spent (or might have spent) the provider
 * call, and refunding would let a retry storm multiply spend. Favor cost safety.
 *
 * Two concurrent requests with one slot left: the `WHERE count < cap` update
 * plus a transaction around global+user rows means at most one insert pair
 * commits, so at most one Hunter call proceeds.
 *
 * `__global__` is a reserved user_id for the app-wide counter so extra accounts
 * cannot multiply spend.
 *
 * Server-only. Never trust client-supplied used/cap fields.
 */
import { getSql, withSqlTransaction } from "@/lib/db";

const DEFAULT_USER_CAP = 10;
const DEFAULT_GLOBAL_CAP = 10;
const GLOBAL_USER = "__global__";

class CapError extends Error {
  constructor(readonly kind: "user" | "global") {
    super(kind);
  }
}

function capFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function dailyEnrichmentCap(): number {
  return capFromEnv("DAILY_ENRICHMENT_CAP", DEFAULT_USER_CAP);
}

export function globalDailyEnrichmentCap(): number {
  return capFromEnv("GLOBAL_DAILY_ENRICHMENT_CAP", DEFAULT_GLOBAL_CAP);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function enrichmentUsedToday(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ count: number }>`
    select count from enrichment_usage where user_id = ${userId} and day = ${today()}
  `;
  return rows[0]?.count ?? 0;
}

/**
 * Atomically reserve one paid enrichment slot for this user AND the app.
 * Returns ok:false without writing when either cap is already reached.
 */
export async function tryReserveEnrichment(userId: string): Promise<{ ok: boolean; reason: string }> {
  const userCap = dailyEnrichmentCap();
  const globalCap = globalDailyEnrichmentCap();
  const day = today();
  try {
    await withSqlTransaction(async (sql) => {
      const globalRows = await sql<{ count: number }>`
        insert into enrichment_usage as u (user_id, day, count)
        values (${GLOBAL_USER}, ${day}, 1)
        on conflict (user_id, day) do update
          set count = u.count + 1
          where u.count < ${globalCap}
        returning count
      `;
      if (!globalRows.length) throw new CapError("global");
      const userRows = await sql<{ count: number }>`
        insert into enrichment_usage as u (user_id, day, count)
        values (${userId}, ${day}, 1)
        on conflict (user_id, day) do update
          set count = u.count + 1
          where u.count < ${userCap}
        returning count
      `;
      if (!userRows.length) throw new CapError("user");
    });
    return { ok: true, reason: "" };
  } catch (err) {
    if (err instanceof CapError) {
      return {
        ok: false,
        reason:
          err.kind === "global"
            ? "App-wide daily paid-contact cap reached. Try again tomorrow."
            : "Daily paid-contact cap reached. Try again tomorrow.",
      };
    }
    throw err;
  }
}
