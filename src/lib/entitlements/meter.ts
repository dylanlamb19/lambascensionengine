import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState, ScaffoldPlanId, UsageMeter } from "../packages/types.ts";
import { METER_LABELS, SOFT_RATIO, entitlementFor, upgradeNeeded, type MeterKey, type PlanEntitlement } from "./plans.ts";

export type MeterLevel = "ok" | "warning" | "blocked";

export type MeterReading = {
  key: MeterKey;
  label: string;
  used: number;
  limit: number | null;
  level: MeterLevel;
};

export type LimitBanner = {
  level: "warning" | "blocked";
  key: MeterKey;
  text: string;
};

export function meterLevel(used: number, limit: number | null): MeterLevel {
  if (limit == null) return "ok";
  if (limit <= 0) return used > 0 ? "blocked" : "ok";
  if (used >= limit) return "blocked";
  if (used / limit >= SOFT_RATIO) return "warning";
  return "ok";
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Billing periods start on the workspace's created day and roll forward one month. */
export function billingPeriod(anchorIso: string, nowIso: string): { start: string; end: string } {
  const anchor = new Date(anchorIso);
  const now = new Date(nowIso);
  const anchorDay = Number.isNaN(anchor.getTime()) ? 1 : anchor.getUTCDate();
  const basis = Number.isNaN(now.getTime()) ? new Date(0) : now;
  const clamp = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex, Math.min(anchorDay, daysInMonth(year, monthIndex))));
  let year = basis.getUTCFullYear();
  let month = basis.getUTCMonth();
  let start = clamp(year, month);
  if (start.getTime() > basis.getTime()) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    start = clamp(year, month);
  }
  let endMonth = month + 1;
  let endYear = year;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }
  return { start: start.toISOString(), end: clamp(endYear, endMonth).toISOString() };
}

export function periodAnchor(state: FulfillmentState, tenantId: string, now: string): string {
  return workspaceFor(state, tenantId)?.createdAt || now;
}

export function occupiedSeats(state: FulfillmentState, tenantId: string, now: string): number {
  const members = (state.memberships || []).filter((row) => row.tenantId === tenantId && row.status === "accepted").length;
  const pending = (state.seatInvites || []).filter((row) => row.tenantId === tenantId && !row.usedAt && row.expiresAt > now).length;
  return members + pending;
}

export function liveClientCount(state: FulfillmentState, tenantId: string): number {
  return (state.clients || []).filter((row) => row.tenantId === tenantId).length;
}

export function livePipelineCount(state: FulfillmentState, tenantId: string): number {
  return (state.enrollments || []).filter((row) => row.tenantId === tenantId && row.status === "active").length;
}

export function monthlyRunsOf(state: FulfillmentState, tenantId: string, now: string): number {
  const period = billingPeriod(periodAnchor(state, tenantId, now), now);
  const row = (state.usageMeters || []).find((meter) => meter.tenantId === tenantId && meter.periodStart === period.start);
  return row?.monthlyRuns || 0;
}

function meterRow(state: FulfillmentState, tenantId: string, now: string, monthlyRuns: number): UsageMeter {
  const period = billingPeriod(periodAnchor(state, tenantId, now), now);
  return {
    tenantId,
    periodStart: period.start,
    periodEnd: period.end,
    clientWorkspaces: liveClientCount(state, tenantId),
    activePipelines: livePipelineCount(state, tenantId),
    teamSeats: occupiedSeats(state, tenantId, now),
    monthlyRuns,
  };
}

/** Refresh one workspace's current period. Other workspaces' rows stay put. */
export function writeMeter(state: FulfillmentState, tenantId: string, now: string, monthlyRuns: number): FulfillmentState {
  const next = meterRow(state, tenantId, now, monthlyRuns);
  const rest = (state.usageMeters || []).filter((row) => !(row.tenantId === tenantId && row.periodStart === next.periodStart));
  return { ...state, usageMeters: [...rest, next] };
}

export function syncMeter(state: FulfillmentState, tenantId: string, now: string): FulfillmentState {
  return writeMeter(state, tenantId, now, monthlyRunsOf(state, tenantId, now));
}

export function addMonthlyRuns(state: FulfillmentState, tenantId: string, now: string, delta: number): FulfillmentState {
  if (delta <= 0) return state;
  return writeMeter(state, tenantId, now, monthlyRunsOf(state, tenantId, now) + delta);
}

export function readingsFor(state: FulfillmentState, tenantId: string, now: string, plan: PlanEntitlement | null): MeterReading[] {
  const used: Record<MeterKey, number> = {
    clientWorkspaces: liveClientCount(state, tenantId),
    activePipelines: livePipelineCount(state, tenantId),
    teamSeats: occupiedSeats(state, tenantId, now),
    monthlyRuns: monthlyRunsOf(state, tenantId, now),
  };
  return (Object.keys(used) as MeterKey[]).map((key) => {
    const limit = plan ? plan.limits[key] : null;
    return { key, label: METER_LABELS[key], used: used[key], limit, level: meterLevel(used[key], limit) };
  });
}

export function limitBanners(plan: PlanEntitlement | null, readings: MeterReading[]): LimitBanner[] {
  if (!plan) return [];
  const banners: LimitBanner[] = [];
  for (const reading of readings) {
    if (reading.level === "ok" || reading.limit == null) continue;
    if (reading.level === "blocked") {
      banners.push({ level: "blocked", key: reading.key, text: upgradeNeeded(plan.name, `includes ${reading.limit} ${reading.label}.`) });
      continue;
    }
    const percent = Math.floor((reading.used / reading.limit) * 100);
    banners.push({
      level: "warning",
      key: reading.key,
      text: `${plan.name} is at ${percent}% of its ${reading.label}. Upgrade before this plan stops.`,
    });
  }
  return banners;
}

export function capReason(plan: PlanEntitlement, key: MeterKey, used: number): string | null {
  const limit = plan.limits[key];
  if (limit == null || used < limit) return null;
  return upgradeNeeded(plan.name, `includes ${limit} ${METER_LABELS[key]}.`);
}

export function planRank(id: ScaffoldPlanId): number {
  if (id === "starter") return 0;
  if (id === "pro") return 1;
  return 2;
}
