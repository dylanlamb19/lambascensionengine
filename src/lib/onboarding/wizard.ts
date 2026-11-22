import { colorProblem, senderProblem, timezoneProblem } from "../account/brand.ts";
import { limitBanners, readingsFor } from "../entitlements/meter.ts";
import { recordTestPlan } from "../entitlements/checkout.ts";
import { resolveEntitledPlan } from "../entitlements/resolve.ts";
import { getPackage } from "../packages/catalog.ts";
import { PACKAGE_FULFILLMENT_TAB } from "../packages/nav.ts";
import { addClient, recordPurchase } from "../packages/runner.ts";
import { workspaceFor } from "../packages/tenancy.ts";
import type { FulfillmentState, WizardProgress, WizardStepId } from "../packages/types.ts";
import { importLeadCsv } from "./csv.ts";

export const WIZARD_STEPS: readonly WizardStepId[] = ["branding", "plan", "client", "packages", "leads", "next"];

export type WizardResult =
  | { ok: true; state: FulfillmentState; progress: WizardProgress }
  | { ok: false; state: FulfillmentState; reason: string };

export function wizardProgress(state: FulfillmentState, tenantId: string): WizardProgress | null {
  return (state.wizardProgress || []).find((row) => row.tenantId === tenantId) || null;
}

export function ensureWizard(state: FulfillmentState, tenantId: string, now: string): WizardResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, state, reason: "That workspace is not open." };
  const existing = wizardProgress(state, tenantId);
  if (existing) return { ok: true, state, progress: existing };
  const progress: WizardProgress = {
    tenantId,
    step: "branding",
    completed: [],
    skipped: [],
    updatedAt: now,
    finishedAt: null,
  };
  return { ok: true, progress, state: { ...state, wizardProgress: [...(state.wizardProgress || []), progress] } };
}

function saveProgress(state: FulfillmentState, progress: WizardProgress): FulfillmentState {
  const rest = (state.wizardProgress || []).filter((row) => row.tenantId !== progress.tenantId);
  return { ...state, wizardProgress: [...rest, progress] };
}

function advance(progress: WizardProgress, bucket: "completed" | "skipped", now: string): WizardProgress {
  const index = WIZARD_STEPS.indexOf(progress.step);
  const finished = progress.step === "next";
  const next = finished ? "next" : WIZARD_STEPS[Math.min(index + 1, WIZARD_STEPS.length - 1)];
  const list = progress[bucket].includes(progress.step) ? progress[bucket] : [...progress[bucket], progress.step];
  return {
    ...progress,
    step: next,
    [bucket]: list,
    updatedAt: now,
    finishedAt: finished ? now : progress.finishedAt,
  };
}

function requireStep(state: FulfillmentState, tenantId: string, step: WizardStepId): WizardResult {
  const progress = wizardProgress(state, tenantId);
  if (!progress) return { ok: false, state, reason: "Open the wizard before this step." };
  if (progress.step !== step) return { ok: false, state, reason: "Resume the step that is in progress." };
  return { ok: true, state, progress };
}

export function skipWizardStep(state: FulfillmentState, tenantId: string, step: WizardStepId, now: string): WizardResult {
  const ready = requireStep(state, tenantId, step);
  if (!ready.ok) return ready;
  const progress = advance(ready.progress, "skipped", now);
  return { ok: true, progress, state: saveProgress(state, progress) };
}

export function confirmWizardBranding(
  state: FulfillmentState,
  tenantId: string,
  input: { name: string; senderDisplayName: string; primary: string; accent: string; timezone: string },
  now: string,
): WizardResult {
  const ready = requireStep(state, tenantId, "branding");
  if (!ready.ok) return ready;
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return { ok: false, state, reason: "The workspace needs a name." };
  const sender = senderProblem(input.senderDisplayName);
  if (sender) return { ok: false, state, reason: sender };
  const primary = colorProblem(input.primary.trim());
  if (primary) return { ok: false, state, reason: primary };
  const accent = colorProblem(input.accent.trim());
  if (accent) return { ok: false, state, reason: accent };
  const zone = timezoneProblem(input.timezone.trim());
  if (zone) return { ok: false, state, reason: zone };
  const branded = {
    ...state,
    workspaces: state.workspaces.map((row) => row.id === tenantId
      ? {
          ...row,
          name,
          senderDisplayName: input.senderDisplayName.trim(),
          brandPrimary: input.primary.trim(),
          brandAccent: input.accent.trim(),
          timezone: input.timezone.trim(),
        }
      : row),
  };
  const progress = advance(ready.progress, "completed", now);
  return { ok: true, progress, state: saveProgress(branded, progress) };
}

export function chooseWizardPlan(state: FulfillmentState, tenantId: string, planId: string, now: string): WizardResult {
  const ready = requireStep(state, tenantId, "plan");
  if (!ready.ok) return ready;
  const recorded = recordTestPlan(state, tenantId, planId, now);
  if (!recorded.ok) return { ok: false, state, reason: recorded.reason };
  if (recorded.amountCents !== 0) return { ok: false, state, reason: "Only a zero-amount test plan can be recorded." };
  const progress = advance(ready.progress, "completed", now);
  return { ok: true, progress, state: saveProgress(recorded.state, progress) };
}

export function addWizardClient(state: FulfillmentState, tenantId: string, name: string, now: string, entitlements: boolean): WizardResult {
  const ready = requireStep(state, tenantId, "client");
  if (!ready.ok) return ready;
  const added = addClient(state, tenantId, name, now, undefined, { entitlements });
  if (!added.ok) return { ok: false, state: added.state, reason: added.reason };
  const progress = advance(ready.progress, "completed", now);
  return { ok: true, progress, state: saveProgress(added.state, progress) };
}

export function chooseWizardPackages(
  state: FulfillmentState,
  tenantId: string,
  input: { clientId: string; packageIds: string[] },
  now: string,
  entitlements: boolean,
): WizardResult {
  const ready = requireStep(state, tenantId, "packages");
  if (!ready.ok) return ready;
  const client = state.clients.find((row) => row.id === input.clientId && row.tenantId === tenantId);
  if (!client) return { ok: false, state, reason: "That client is not in this workspace." };
  const unique = [...new Set(input.packageIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, state, reason: "Choose at least one package, or skip this step." };
  let next = state;
  for (const packageId of unique) {
    const recorded = recordPurchase(next, tenantId, {
      clientName: client.name,
      packageId: packageId as never,
      setupPayment: "unrecorded",
      monthlyPayment: "unrecorded",
    }, now, undefined, { entitlements });
    if (!recorded.ok) return { ok: false, state: recorded.state, reason: recorded.reason };
    next = recorded.state;
  }
  const progress = advance(ready.progress, "completed", now);
  return { ok: true, progress, state: saveProgress(next, progress) };
}

export function importWizardLeads(
  state: FulfillmentState,
  tenantId: string,
  clientId: string,
  csv: string,
  now: string,
): WizardResult {
  const ready = requireStep(state, tenantId, "leads");
  if (!ready.ok) return ready;
  const imported = importLeadCsv(state, tenantId, clientId, csv, now);
  if (!imported.ok) return imported;
  const progress = advance(ready.progress, "completed", now);
  return { ok: true, progress, state: saveProgress(imported.state, progress) };
}

export function finishWizard(state: FulfillmentState, tenantId: string, now: string): WizardResult {
  const ready = requireStep(state, tenantId, "next");
  if (!ready.ok) return ready;
  const progress = advance(ready.progress, "completed", now);
  return { ok: true, progress, state: saveProgress(state, progress) };
}

export type QueuedPipeline = {
  clientName: string;
  packageId: string;
  packageName: string;
  stepTitles: string[];
  tab: typeof PACKAGE_FULFILLMENT_TAB;
};

/** Pipelines already queued for the Client Package Fulfillment tab. This does not start them. */
export function queuedPipelines(state: FulfillmentState, tenantId: string): QueuedPipeline[] {
  return (state.enrollments || [])
    .filter((row) => row.tenantId === tenantId && row.status !== "cancelled")
    .map((row) => ({
      clientName: state.clients.find((client) => client.id === row.clientId && client.tenantId === tenantId)?.name || "Client",
      packageId: row.packageId,
      packageName: getPackage(row.packageId).name,
      stepTitles: (state.steps || []).filter((step) => step.tenantId === tenantId && step.enrollmentId === row.id).map((step) => step.title),
      tab: PACKAGE_FULFILLMENT_TAB,
    }));
}

export function wizardView(state: FulfillmentState, tenantId: string, now: string, entitlements: boolean) {
  const progress = wizardProgress(state, tenantId);
  const workspace = workspaceFor(state, tenantId);
  const plan = resolveEntitledPlan(state, tenantId);
  const readings = entitlements && workspace ? readingsFor(state, tenantId, now, plan) : [];
  return {
    step: progress?.step || "branding",
    completed: progress?.completed || [],
    skipped: progress?.skipped || [],
    finishedAt: progress?.finishedAt || null,
    steps: WIZARD_STEPS,
    workspace: workspace
      ? {
          name: workspace.name,
          senderDisplayName: workspace.senderDisplayName || "",
          primary: workspace.brandPrimary || "",
          accent: workspace.brandAccent || "",
          timezone: workspace.timezone || "UTC",
        }
      : null,
    clients: state.clients.filter((row) => row.tenantId === tenantId).map((row) => ({ id: row.id, name: row.name })),
    queued: queuedPipelines(state, tenantId),
    tab: PACKAGE_FULFILLMENT_TAB,
    banners: limitBanners(plan, readings),
    amountCents: 0 as const,
    billingMode: "test" as const,
  };
}
