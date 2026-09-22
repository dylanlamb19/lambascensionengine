export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** True only on Vercel Production (`VERCEL_ENV=production`). */
export function isVercelProduction(): boolean {
  return env("VERCEL_ENV") === "production";
}

export type DbSource = "neon" | "pglite";

/**
 * Persistent Postgres (Neon / `pg`) when DATABASE_URL is set; otherwise the
 * in-memory PGLite fallback. Empty/whitespace URLs count as unset so production
 * cannot silently fall back to ephemeral PGLite.
 */
export function resolveDbSource(databaseUrl: string | undefined | null): DbSource {
  const trimmed = typeof databaseUrl === "string" ? databaseUrl.trim() : "";
  return trimmed ? "neon" : "pglite";
}

/**
 * Workspace preview vs deployed app.
 *
 * - Grok sandbox preview: no GROK_PROJECT_ID and not running on Vercel.
 * - Grok published apps: deployer writes GROK_PROJECT_ID.
 * - Vercel (production / preview / development): never a Grok workspace preview,
 *   even when GROK_PROJECT_ID is absent. Missing that flag must not reset a
 *   persistent production owner.
 */
export function isWorkspacePreview(): boolean {
  if (env("VERCEL_ENV")) return false;
  return !env("GROK_PROJECT_ID");
}
