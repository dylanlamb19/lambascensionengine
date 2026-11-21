import { usageFor } from "../packages/usage.ts";
import { getTestPlan } from "../packages/plans.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState } from "../packages/types.ts";
import type { AccountBundle } from "./types.ts";

export type BrandView = {
  tenantId: string;
  name: string;
  logoUrl: string;
  logoStored: boolean;
  primary: string;
  accent: string;
  senderDisplayName: string;
  timezone: string;
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const TIMEZONE = /^(UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

export function clientFacingBrand(state: FulfillmentState, tenantId: string, logoStored = false): BrandView | null {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return null;
  return {
    tenantId,
    name: workspace.name,
    logoUrl: workspace.logoUrl || "",
    logoStored,
    primary: workspace.brandPrimary || "",
    accent: workspace.brandAccent || "",
    senderDisplayName: workspace.senderDisplayName || workspace.name,
    timezone: workspace.timezone || "UTC",
  };
}

/** CSS variables for this tenant's shell. Other tenants' colors are not read. */
export function shellBrandStyle(
  state: FulfillmentState,
  tenantId: string,
  enabled: boolean,
): Record<string, string> | undefined {
  if (!enabled || !tenantId) return undefined;
  const brand = clientFacingBrand(state, tenantId);
  if (!brand) return undefined;
  const style: Record<string, string> = {};
  if (brand.primary) style["--la-tenant-primary"] = brand.primary;
  if (brand.accent) style["--la-tenant-accent"] = brand.accent;
  return Object.keys(style).length ? style : undefined;
}

export function colorProblem(value: string): string | null {
  if (!COLOR.test(value)) return "Use a color like #1f6f5b.";
  return null;
}

export function timezoneProblem(value: string): string | null {
  if (!value || value.length > 64 || !TIMEZONE.test(value)) return "Use a timezone like America/Chicago.";
  return null;
}

export function senderProblem(value: string): string | null {
  const clean = value.trim();
  if (!clean || clean.length > 80 || /[\r\n\u0000]/.test(clean)) return "Enter a sender name.";
  return null;
}

export function logoUrlProblem(value: string): string | null {
  if (!value) return null;
  if (value.length > 300) return "That logo address is too long.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Use an https logo address.";
  }
  if (url.protocol !== "https:") return "Use an https logo address.";
  return null;
}

export type Checklist = {
  plan: boolean;
  brand: boolean;
  firstClient: boolean;
  firstPackage: boolean;
  complete: boolean;
};

export function onboardingChecklist(state: FulfillmentState, tenantId: string): Checklist | null {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return null;
  const plan = workspace.subscriptionStatus === "active" || workspace.subscriptionStatus === "past_due";
  const brand = Boolean(workspace.brandPrimary && workspace.senderDisplayName);
  const firstClient = state.clients.some((row) => row.tenantId === tenantId);
  const firstPackage = state.enrollments.some((row) => row.tenantId === tenantId && row.status !== "cancelled");
  return { plan, brand, firstClient, firstPackage, complete: brand && firstClient && firstPackage };
}

export function planUsageView(state: FulfillmentState, tenantId: string) {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return null;
  const plan = getTestPlan(workspace.planId);
  const usage = usageFor(state, tenantId);
  const open = (state.invoices || []).filter((row) => row.tenantId === tenantId);
  return {
    planId: workspace.planId,
    planName: plan.name,
    subscriptionStatus: workspace.subscriptionStatus,
    billingMode: "test" as const,
    amountCents: 0 as const,
    clientLimit: plan.clientLimit,
    enrollmentLimit: plan.enrollmentLimit,
    pipelineRuns: usage.pipelineRuns,
    enrollments: usage.enrollments,
    clients: state.clients.filter((row) => row.tenantId === tenantId).length,
    invoices: open.map((row) => ({ id: row.id, status: row.status, amountCents: 0 as const })),
  };
}

export function brandForBundle(bundle: AccountBundle, tenantId: string): BrandView | null {
  return clientFacingBrand(bundle.fulfillment, tenantId, bundle.accounts.logos.some((row) => row.tenantId === tenantId));
}
