import { WORKER_STALE_MS } from "../mail/heartbeat.ts";
import type { HealthLight, SentinelBug, SentinelCheckResult, SentinelFinding, SubsystemHealth } from "./types.ts";
import type { SentinelCode, SentinelFeature } from "./codes.ts";

export const OBSERVED_FRESH_MS = 30 * 60 * 1000;

const DASHBOARD: SentinelFeature[] = [
  "gmail",
  "calendar",
  "places",
  "database",
  "worker",
  "booking",
  "outreach",
  "ara",
];

export function lightFromFindings(findings: SentinelFinding[], observed: boolean): HealthLight {
  if (findings.some((f) => f.severity === "critical")) return "red";
  if (findings.some((f) => f.severity === "high")) return "red";
  if (!observed) return "yellow";
  if (findings.some((f) => f.severity === "medium")) return "yellow";
  return "green";
}

export function overallFromSubsystems(rows: SubsystemHealth[]): HealthLight {
  if (rows.some((r) => r.light === "red")) return "red";
  if (rows.some((r) => r.light === "yellow" || r.light === "unknown")) return "yellow";
  if (!rows.length) return "unknown";
  return "green";
}

export function overallGrade(light: HealthLight): "healthy" | "degraded" | "critical" | "unknown" {
  if (light === "green") return "healthy";
  if (light === "red") return "critical";
  if (light === "yellow") return "degraded";
  return "unknown";
}

export function overallLabel(light: HealthLight, open: number): string {
  if (light === "green") return "Everything is healthy";
  if (light === "red") return open === 1 ? "1 regression detected" : `${open} problems detected`;
  if (light === "yellow") return "Something needs attention";
  return "Sentinel has not observed production yet";
}

export function workerStale(lastCompletedAt: number | null, now: number, staleMs = WORKER_STALE_MS): boolean {
  if (lastCompletedAt == null) return true;
  return now - lastCompletedAt > staleMs;
}

export function recentlyObserved(iso: string | null, now = Date.now(), freshMs = OBSERVED_FRESH_MS): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return now - t <= freshMs;
}

/** Map a finding onto the owner-facing System Health tile it should light. */
export function dashboardFeatureOf(code: SentinelCode, feature: SentinelFeature): SentinelFeature {
  if (code === "PROSPECT_DUPLICATE_IDENTITY") return "places";
  if (
    code === "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY"
    || code === "DNC_SEQUENCE_ACTIVE"
    || code === "BOUNCE_FUTURE_SEND_SCHEDULED"
    || code === "TEST_MODE_INVARIANT_FAILED"
  ) return "outreach";
  if (code === "PIPELINE_STATE_MISMATCH" || code === "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE") {
    return "booking";
  }
  if (feature === "pipeline") return "outreach";
  if (feature === "test_mode") return "outreach";
  return feature;
}

function relatedChecks(feature: SentinelFeature, checks: SentinelCheckResult[]): SentinelCheckResult[] {
  const direct = checks.filter((c) => c.feature === feature);
  if (feature === "booking" || feature === "outreach" || feature === "ara") {
    return [...direct, ...checks.filter((c) => c.id === "invariants" || (feature === "outreach" && c.id === "test-mode"))];
  }
  if (feature === "places") {
    return [...direct, ...checks.filter((c) => c.id === "invariants")];
  }
  return direct;
}

export function rollupSubsystems(
  checks: SentinelCheckResult[],
  bugs: SentinelBug[],
  observedAt: Record<string, string | null>,
  now = Date.now(),
): SubsystemHealth[] {
  return DASHBOARD.map((feature) => {
    const related = relatedChecks(feature, checks);
    const findings: SentinelFinding[] = [
      ...related.flatMap((c) => c.findings).filter((f) => dashboardFeatureOf(f.code, f.feature) === feature),
      ...bugs.filter((b) => b.status === "open" && dashboardFeatureOf(b.error_code, b.feature) === feature).map((b) => ({
        code: b.error_code,
        severity: b.severity,
        feature: b.feature,
        summary: b.summary,
        evidence: b.evidence,
        signature: b.signature,
      })),
    ];
    const observed = related.some((c) => c.observed) || recentlyObserved(observedAt[feature], now);
    const light = lightFromFindings(findings, observed);
    const worst = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
    const okCheck = related.find((c) => c.ok && c.observed);
    return {
      feature,
      light,
      label: featureLabel(feature),
      detail: worst?.summary || okCheck?.detail || (observed ? "Recently observed working." : "Not recently observed."),
      observedAt: observedAt[feature] || null,
    };
  });
}

function severityRank(s: string): number {
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  return 1;
}

export function featureLabel(feature: SentinelFeature): string {
  switch (feature) {
    case "gmail": return "Gmail";
    case "calendar": return "Calendar";
    case "places": return "Google Places";
    case "database": return "Database";
    case "worker": return "Worker";
    case "booking": return "Booking";
    case "outreach": return "Outreach safety";
    case "pipeline": return "Pipeline";
    case "ara": return "Ara actions";
    case "auth": return "Auth";
    case "test_mode": return "Test Mode";
    case "sentinel": return "Sentinel";
  }
}
