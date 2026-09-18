import { timingSafeEqual } from "node:crypto";

export function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function jobSecretFromRequest(headers: { get(name: string): string | null }): string {
  const x = (headers.get("x-job-secret") || "").trim();
  if (x) return x;
  const auth = headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

/**
 * HTTP worker endpoint is fail-closed: a missing secret never runs jobs.
 * Preview uses the in-process tick, not this unauthenticated route.
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> — set CRON_SECRET
 * to the same value as OUTREACH_JOB_SECRET.
 */
export function allowOutreachJob(opts: {
  secret: string | undefined;
  header: string;
  production?: boolean;
}): { ok: true } | { ok: false; status: number; body: string } {
  void opts.production;
  const secret = (opts.secret || "").trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: "Outreach jobs are not configured. Set OUTREACH_JOB_SECRET. No emails were sent.",
    };
  }
  if (!secretsEqual(secret, opts.header || "")) {
    return { ok: false, status: 401, body: "forbidden" };
  }
  return { ok: true };
}
