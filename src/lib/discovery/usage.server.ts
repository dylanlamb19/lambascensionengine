import { getSql, withSqlTransaction } from "@/lib/db";

const DEFAULT_CAP = 50;
const DEFAULT_GLOBAL = 50;
const DEFAULT_CENTS = 200;
const GLOBAL_USER = "__global__";
export const EST_SEARCH_CENTS = 4;
export const EST_GEOCODE_CENTS = 1;

class CapError extends Error {
  constructor(readonly kind: "user" | "global" | "spend") {
    super(kind);
  }
}

function capFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function dailyDiscoveryCap(): number {
  return capFromEnv("DAILY_DISCOVERY_CAP", DEFAULT_CAP);
}
export function globalDailyDiscoveryCap(): number {
  return capFromEnv("GLOBAL_DAILY_DISCOVERY_CAP", DEFAULT_GLOBAL);
}
export function dailyDiscoverySpendCapCents(): number {
  return capFromEnv("DAILY_DISCOVERY_SPEND_CAP_CENTS", DEFAULT_CENTS);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function tryReserveDiscovery(userId: string, cents: number): Promise<{ ok: boolean; reason: string }> {
  const userCap = dailyDiscoveryCap();
  const globalCap = globalDailyDiscoveryCap();
  const spendCap = dailyDiscoverySpendCapCents();
  const day = today();
  try {
    await withSqlTransaction(async (sql) => {
      const globalRows = await sql<{ count: number }>`
        insert into discovery_usage as u (user_id, day, count, cents)
        values (${GLOBAL_USER}, ${day}, 1, ${cents})
        on conflict (user_id, day) do update
          set count = u.count + 1, cents = u.cents + ${cents}
          where u.count < ${globalCap} and u.cents + ${cents} <= ${spendCap}
        returning count
      `;
      if (!globalRows.length) throw new CapError("global");
      const userRows = await sql<{ count: number }>`
        insert into discovery_usage as u (user_id, day, count, cents)
        values (${userId}, ${day}, 1, ${cents})
        on conflict (user_id, day) do update
          set count = u.count + 1, cents = u.cents + ${cents}
          where u.count < ${userCap} and u.cents + ${cents} <= ${spendCap}
        returning count
      `;
      if (!userRows.length) throw new CapError("user");
    });
    return { ok: true, reason: "" };
  } catch (err) {
    if (err instanceof CapError) {
      return { ok: false, reason: "Daily company-search limit reached. Try again tomorrow." };
    }
    throw err;
  }
}

export async function cacheGet(key: string): Promise<unknown | null> {
  const sql = await getSql();
  const rows = await sql<{ payload: unknown }>`
    select payload from search_cache where cache_key = ${key} and expires_at > now()
  `;
  return rows[0]?.payload ?? null;
}

export async function cacheSet(key: string, payload: unknown, _days = 7): Promise<void> {
  const sql = await getSql();
  const body = JSON.stringify(payload);
  await sql`
    insert into search_cache (cache_key, payload, expires_at)
    values (${key}, ${body}::jsonb, now() + interval '7 days')
    on conflict (cache_key) do update set payload = excluded.payload, expires_at = excluded.expires_at
  `;
}
