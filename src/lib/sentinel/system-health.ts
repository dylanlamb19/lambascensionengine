import { overallLabel } from "./health.ts";
import type { HealthLight, SentinelSnapshot, SubsystemHealth } from "./types.ts";

export type CanonicalHealth = {
  openIssues: number;
  criticalCount: number;
  highCount: number;
  latestRun: string | null;
  status: HealthLight;
  systemIssues: number;
  prospectIssues: number;
  overallLabel: string;
  subsystems: SubsystemHealth[];
  araText: "ready";
  araVoice: HealthLight;
};

/** One selector for Home, System Health, Ara, and banners. */
export function canonicalHealth(input: {
  snapshot: SentinelSnapshot | null;
  prospectIssueCount?: number;
}): CanonicalHealth {
  const snap = input.snapshot;
  const criticalCount = snap?.criticalOpen ?? 0;
  const highCount = snap?.highOpen ?? 0;
  const systemIssues = snap
    ? snap.alerts.filter((b) => b.status === "open" || b.status === "acknowledged").length
    : 0;
  const openIssues = systemIssues;
  const status: HealthLight = snap?.overall || "unknown";
  const voice = snap?.subsystems.find((s) => s.feature === "ara_voice");
  return {
    openIssues,
    criticalCount,
    highCount,
    latestRun: snap?.lastRunAt || null,
    status,
    systemIssues,
    prospectIssues: Math.max(0, input.prospectIssueCount || 0),
    overallLabel: snap?.overallLabel || overallLabel(status, openIssues),
    subsystems: snap?.subsystems || [],
    araText: "ready",
    araVoice: voice?.light || "unknown",
  };
}

export function homeIssueLine(health: CanonicalHealth): string {
  if (health.systemIssues === 0 && health.prospectIssues === 0) {
    return "Everything is good";
  }
  const prospect = `${health.prospectIssues} prospect issue${health.prospectIssues === 1 ? "" : "s"}`;
  const system = `${health.systemIssues} system issue${health.systemIssues === 1 ? "" : "s"}`;
  return `${prospect} · ${system}`;
}

export function homeAttentionCount(health: CanonicalHealth): number {
  return health.systemIssues + health.prospectIssues;
}

export function falseZeroForbidden(health: CanonicalHealth): boolean {
  return health.systemIssues > 0;
}
