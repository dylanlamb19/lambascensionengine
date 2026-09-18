import { createHash } from "node:crypto";
import type { ResearchMode, ResearchResult } from "./types.ts";

const GLOBAL_USER = "__global__";
const DEFAULTS: Record<ResearchMode, number> = { quick: 40, deep: 8, page: 30 };
const GLOBAL: Record<ResearchMode, number> = { quick: 80, deep: 16, page: 60 };
const CACHE_MS = 15 * 60 * 1000;

const memCount = new Map<string, { day: string; count: number }>();
const memCache = new Map<string, { at: number; payload: ResearchResult }>();
const inflight = new Map<string, Promise<ResearchResult>>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function capFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function dailyResearchCap(kind: ResearchMode): number {
  const key = kind === "deep" ? "DAILY_ARA_DEEP_RESEARCH_CAP" : kind === "page" ? "DAILY_ARA_PAGE_RESEARCH_CAP" : "DAILY_ARA_RESEARCH_CAP";
  return capFromEnv(key, DEFAULTS[kind]);
}

export function queryHash(query: string, mode: ResearchMode, url?: string): string {
  return createHash("sha256").update(`${mode}|${(query || "").trim().toLowerCase()}|${url || ""}`).digest("hex").slice(0, 32);
}

function memKey(userId: string, kind: ResearchMode) {
  return `${userId}:${kind}`;
}

function reserveMem(userId: string, kind: ResearchMode): { ok: boolean; reason: string } {
  const day = today();
  const cap = dailyResearchCap(kind);
  const k = memKey(userId, kind);
  const g = memKey(GLOBAL_USER, kind);
  const user = memCount.get(k);
  const glob = memCount.get(g);
  const userCount = user && user.day === day ? user.count : 0;
  const globCount = glob && glob.day === day ? glob.count : 0;
  if (userCount >= cap) return { ok: false, reason: "I’ve hit today’s research limit. Ask again tomorrow, or I can answer from what I already know." };
  if (globCount >= capFromEnv("GLOBAL_DAILY_ARA_RESEARCH_CAP", GLOBAL[kind])) {
    return { ok: false, reason: "Live research is paused for the rest of the day. I can still run Lamb Ascension and answer from what I know." };
  }
  memCount.set(k, { day, count: userCount + 1 });
  memCount.set(g, { day, count: globCount + 1 });
  return { ok: true, reason: "" };
}

export function tryReserveResearchMem(userId: string, kind: ResearchMode): { ok: boolean; reason: string } {
  return reserveMem(userId, kind);
}

export async function tryReserveResearch(userId: string, kind: ResearchMode): Promise<{ ok: boolean; reason: string }> {
  const cap = dailyResearchCap(kind);
  const globalCap = capFromEnv("GLOBAL_DAILY_ARA_RESEARCH_CAP", GLOBAL[kind]);
  const day = today();
  try {
    const { withSqlTransaction } = await import("@/lib/db");
    await withSqlTransaction(async (sql) => {
      const globalRows = await sql<{ count: number }>`
        insert into ara_research_usage as u (user_id, day, kind, count)
        values (${GLOBAL_USER}, ${day}, ${kind}, 1)
        on conflict (user_id, day, kind) do update
          set count = u.count + 1
          where u.count < ${globalCap}
        returning count
      `;
      if (!globalRows.length) throw new Error("global");
      const userRows = await sql<{ count: number }>`
        insert into ara_research_usage as u (user_id, day, kind, count)
        values (${userId}, ${day}, ${kind}, 1)
        on conflict (user_id, day, kind) do update
          set count = u.count + 1
          where u.count < ${cap}
        returning count
      `;
      if (!userRows.length) throw new Error("user");
    });
    return { ok: true, reason: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "global" || msg === "user") {
      return {
        ok: false,
        reason: msg === "global"
          ? "Live research is paused for the rest of the day. I can still run Lamb Ascension and answer from what I know."
          : "I’ve hit today’s research limit. Ask again tomorrow, or I can answer from what I already know.",
      };
    }
    return reserveMem(userId, kind);
  }
}

export async function readCache(userId: string, hash: string, mode: ResearchMode): Promise<ResearchResult | null> {
  const k = `${userId}:${hash}:${mode}`;
  const hit = memCache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.payload, cached: true };
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ payload: string; created_at: string }>`
      select payload, created_at from ara_research_cache
      where user_id = ${userId} and query_hash = ${hash} and mode = ${mode}
    `;
    const row = rows[0];
    if (!row) return null;
    const at = new Date(row.created_at).getTime();
    if (!Number.isFinite(at) || Date.now() - at > CACHE_MS) return null;
    let parsed: ResearchResult;
    try {
      parsed = JSON.parse(row.payload) as ResearchResult;
    } catch {
      return null;
    }
    const payload = { ...parsed, cached: true };
    memCache.set(k, { at, payload });
    return payload;
  } catch {
    return null;
  }
}

export async function writeCache(userId: string, hash: string, mode: ResearchMode, payload: ResearchResult): Promise<void> {
  const k = `${userId}:${hash}:${mode}`;
  memCache.set(k, { at: Date.now(), payload });
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into ara_research_cache (user_id, query_hash, mode, payload, created_at)
      values (${userId}, ${hash}, ${mode}, ${JSON.stringify(payload)}, now())
      on conflict (user_id, query_hash, mode) do update set payload = excluded.payload, created_at = now()
    `;
  } catch {
    /* cache is best-effort */
  }
}

export function dedupeInflight(key: string, run: () => Promise<ResearchResult>): Promise<ResearchResult> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Test helper — not used in production. */
export function _resetResearchLimitsForTests() {
  memCount.clear();
  memCache.clear();
  inflight.clear();
}
