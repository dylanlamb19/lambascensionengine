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
 * Accepts x-job-secret or Authorization: Bearer.
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
 * GitHub Actions should send the same existing worker secret.
 * Either OUTREACH_JOB_SECRET or CRON_SECRET is valid — they do not have to match each other.
 */
export function allowOutreachJob(opts: {
  secret: string | undefined;
  header: string;
  production?: boolean;
  extraSecrets?: Array<string | undefined>;
}): { ok: true } | { ok: false; status: number; body: string } {
  void opts.production;
  const candidates = [opts.secret, ...(opts.extraSecrets || [])]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .filter((s, i, all) => all.indexOf(s) === i);
  if (!candidates.length) {
    return {
      ok: false,
      status: 503,
      body: "Outreach jobs are not configured. Set OUTREACH_JOB_SECRET. No emails were sent.",
    };
  }
  const header = opts.header || "";
  for (const secret of candidates) {
    if (secretsEqual(secret, header)) return { ok: true };
  }
  return { ok: false, status: 401, body: "forbidden" };
}
