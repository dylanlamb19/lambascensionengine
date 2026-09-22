/**
 * Optional safe fix preparation. Auto-Fix is OFF and must stay OFF.
 * Sentinel may describe a patch. It must not merge, deploy, rotate secrets,
 * or change Test Mode.
 */

export const SENTINEL_AUTO_FIX = false as const;

export const AUTO_FIX_FORBIDDEN = [
  "auth",
  "oauth",
  "billing",
  "database_schema_destructive",
  "send_safety",
  "test_mode",
  "production_secrets",
  "dnc",
  "calendar_destructive",
  "email_delivery",
] as const;

export type FixPrepReport = {
  allowed: false;
  autoFix: false;
  reason: string;
  next: string;
};

export function mayAutoFix(_kind?: string): FixPrepReport {
  return {
    allowed: false,
    autoFix: false,
    reason: "Sentinel Auto-Fix is OFF.",
    next: "Detect → reproduce in test → smallest isolated branch → wait for Dylan to approve merge and deploy.",
  };
}

export function describeFixWorkflow(bugId: string): string {
  return [
    `Bug ${bugId} may be prepared as an isolated fix.`,
    "1. Reproduce with a regression test.",
    "2. Identify the smallest cause.",
    "3. Open an isolated branch. Do not touch main.",
    "4. Run typecheck, lint, src tests, and build.",
    "5. Wait for Dylan to approve merge and production deploy.",
    "Sentinel will not merge, roll back, rotate credentials, or disable Test Mode.",
  ].join(" ");
}
