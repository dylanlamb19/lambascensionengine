import { FLAGS } from "../flags.ts";
import type { PackageId } from "../packages/catalog.ts";
import type { ScaffoldPlanId } from "../packages/types.ts";

/**
 * One definition of what Starter, Pro, and Agency include.
 * Amounts stay at zero. This file does not read keys or call a provider.
 */
export const TRIAL_DAYS = 14;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
export const SOFT_RATIO = 0.8;

export type MeterKey = "clientWorkspaces" | "activePipelines" | "teamSeats" | "monthlyRuns";

export type PlanEntitlement = {
  id: ScaffoldPlanId;
  name: string;
  trialDays: number;
  billingMode: "test";
  amountCents: 0;
  limits: {
    clientWorkspaces: number | null;
    activePipelines: number | null;
    teamSeats: number;
    monthlyRuns: number | null;
  };
  packages: readonly PackageId[];
};

const STARTER_PACKAGES = ["lead-follow-up", "reviews-gbp", "appointment-reminders"] as const satisfies readonly PackageId[];

const PRO_PACKAGES = [
  ...STARTER_PACKAGES,
  "estimate-follow-ups",
  "lead-generation",
  "ai-visibility",
  "google-ads",
  "meta-ads",
  "office-automation",
] as const satisfies readonly PackageId[];

const AGENCY_PACKAGES = [...PRO_PACKAGES, "google-meta-ai"] as const satisfies readonly PackageId[];

export const PLAN_ENTITLEMENTS: Record<ScaffoldPlanId, PlanEntitlement> = {
  starter: {
    id: "starter",
    name: "Starter",
    trialDays: TRIAL_DAYS,
    billingMode: "test",
    amountCents: 0,
    limits: { clientWorkspaces: 3, activePipelines: 5, teamSeats: 2, monthlyRuns: 40 },
    packages: STARTER_PACKAGES,
  },
  pro: {
    id: "pro",
    name: "Pro",
    trialDays: TRIAL_DAYS,
    billingMode: "test",
    amountCents: 0,
    limits: { clientWorkspaces: 25, activePipelines: 40, teamSeats: 8, monthlyRuns: 500 },
    packages: PRO_PACKAGES,
  },
  agency: {
    id: "agency",
    name: "Agency",
    trialDays: TRIAL_DAYS,
    billingMode: "test",
    amountCents: 0,
    limits: { clientWorkspaces: null, activePipelines: null, teamSeats: 25, monthlyRuns: null },
    packages: AGENCY_PACKAGES,
  },
};

export const METER_LABELS: Record<MeterKey, string> = {
  clientWorkspaces: "client workspaces",
  activePipelines: "active package pipelines",
  teamSeats: "team seats",
  monthlyRuns: "monthly fulfillment runs",
};

export function entitlementsOn(flag?: boolean): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return FLAGS.PLAN_ENTITLEMENTS;
}

export function listEntitlements(): PlanEntitlement[] {
  return [PLAN_ENTITLEMENTS.starter, PLAN_ENTITLEMENTS.pro, PLAN_ENTITLEMENTS.agency];
}

export function entitlementFor(id: ScaffoldPlanId): PlanEntitlement {
  return PLAN_ENTITLEMENTS[id];
}

export function upgradeNeeded(planName: string, detail: string): string {
  return `Upgrade needed. ${planName} ${detail} Nothing was charged.`;
}

export function choosePlanNeeded(): string {
  return "Upgrade needed. Choose a plan before continuing. Nothing was charged.";
}

export function trialEnded(): string {
  return "The 14-day trial has ended. Upgrade needed. Nothing was charged.";
}
