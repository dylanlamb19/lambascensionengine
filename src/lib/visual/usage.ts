import { getSql, withSqlTransaction } from "@/lib/db";

export const DEFAULT_IMAGE_CAP = 12;
export const MAX_IMAGE_CAP = 40;
export const DUP_WINDOW_MS = 12_000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function clampImageCap(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_IMAGE_CAP;
  return Math.min(MAX_IMAGE_CAP, Math.max(1, Math.round(n)));
}

export async function loadImageCap(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ daily_cap: number }>`
    select daily_cap from image_generation_settings where user_id = ${userId} limit 1
  `;
  return clampImageCap(rows[0]?.daily_cap ?? DEFAULT_IMAGE_CAP);
}

export async function saveImageCap(userId: string, cap: number): Promise<number> {
  const daily = clampImageCap(cap);
  const sql = await getSql();
  await sql`
    insert into image_generation_settings (user_id, daily_cap, updated_at)
    values (${userId}, ${daily}, now())
    on conflict (user_id) do update set daily_cap = excluded.daily_cap, updated_at = now()
  `;
  return daily;
}

export async function imagesUsedToday(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ count: number }>`
    select count from image_generation_usage where user_id = ${userId} and day = ${today()}
  `;
  return Number(rows[0]?.count || 0);
}

export async function findRecentDuplicate(
  userId: string,
  hash: string,
): Promise<{ id: string } | null> {
  const sql = await getSql();
  const rows = await sql<{ id: string; created_at: Date | string }>`
    select id, created_at from visual_assets
    where user_id = ${userId} and prompt_hash = ${hash} and source = 'generated'
    order by created_at desc
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const at = new Date(row.created_at).getTime();
  if (!Number.isFinite(at) || Date.now() - at > DUP_WINDOW_MS) return null;
  return { id: row.id };
}

class CapError extends Error {}

export async function tryReserveImageSlot(
  userId: string,
  hash: string,
): Promise<{ ok: true; remaining: number } | { ok: false; reason: string; remaining: number }> {
  const cap = await loadImageCap(userId);
  const day = today();
  try {
    const remaining = await withSqlTransaction(async (sql) => {
      const rows = await sql<{ count: number }>`
        insert into image_generation_usage as u (user_id, day, count, last_prompt_hash, last_at)
        values (${userId}, ${day}, 1, ${hash}, now())
        on conflict (user_id, day) do update
          set count = u.count + 1, last_prompt_hash = ${hash}, last_at = now()
          where u.count < ${cap}
        returning count
      `;
      if (!rows.length) throw new CapError();
      return Math.max(0, cap - Number(rows[0].count));
    });
    return { ok: true, remaining };
  } catch (err) {
    if (err instanceof CapError) {
      return { ok: false, remaining: 0, reason: `Daily AI image cap reached (${cap}). Raise it in Settings if you want more.` };
    }
    throw err;
  }
}

export async function noteLastAsset(userId: string, assetId: string) {
  const sql = await getSql();
  await sql`
    update image_generation_usage
    set last_asset_id = ${assetId}
    where user_id = ${userId} and day = ${today()}
  `;
}

const inflight = new Map<string, string>();

export function beginInflight(userId: string, hash: string): boolean {
  if (inflight.has(userId)) return false;
  inflight.set(userId, hash);
  return true;
}

export function endInflight(userId: string) {
  inflight.delete(userId);
}
