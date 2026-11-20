import { packagePipelineEnabled } from "./cadence.ts";
import { captureLead } from "./lead-follow-up.ts";
import {
  clientLabel,
  defaultRunIds,
  enrollmentFor,
  intakeFor,
  saveClientIntake,
  setPackageWorkspaceKill,
  tickPackageRun,
  workspaceLabel,
  type IntakeInput,
  type PackageFlag,
  type PackageRunSpec,
} from "./package-runs.ts";
import type { IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { FulfillmentState, GeneratedLead, PackageRunStep } from "./types.ts";

export type { IntakeInput };

const QUIET = "Nothing was sent and no spend was set.";

export const LEAD_GEN_STEPS = [
  { id: "campaign-brief", title: "Campaign brief", delayDays: 0, delayMonths: 0 },
  { id: "landing-page", title: "Landing page draft", delayDays: 0, delayMonths: 0 },
  { id: "ad-copy", title: "Ad copy draft", delayDays: 0, delayMonths: 0 },
  { id: "launch", title: "Launch", delayDays: 0, delayMonths: 0 },
  { id: "weekly-report", title: "Weekly lead report", delayDays: 7, delayMonths: 0 },
] as const;

function onFile(value: string | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed || "not on file";
}

function leadsForClient(state: FulfillmentState, tenantId: string, clientId: string): GeneratedLead[] {
  return (state.generatedLeads || []).filter((row) => row.tenantId === tenantId && row.clientId === clientId);
}

function leadGenOutcome(state: FulfillmentState, step: PackageRunStep) {
  const intake = intakeFor(state, step.tenantId, step.clientId);
  const client = clientLabel(state, step.tenantId, step.clientId) || "this client";
  const business = onFile(intake?.businessName || client);
  const offer = onFile(intake?.offer);
  const area = onFile(intake?.serviceArea);
  if (step.stepId === "campaign-brief") {
    const draft = [
      `Campaign brief for ${client}.`,
      `Business: ${business}.`,
      `Offer: ${offer}.`,
      `Service area: ${area}.`,
      `Phone: ${onFile(intake?.phone)}.`,
      `Address: ${onFile(intake?.address)}.`,
      `Site: ${onFile(intake?.website)}.`,
      "Taken from this workspace's stored intake. No ad account was read.",
    ].join(" ");
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: "Campaign brief drafted from stored intake. No ad account was read." },
      patch: { draft },
    };
  }
  if (step.stepId === "landing-page") {
    const draft = `Landing page draft for ${client}. Headline: ${offer}. The form asks for a name, email, and phone. The page was not published. Ad spend was not set.`;
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: "Landing page drafted. Nothing was published. No spend was set." },
      patch: { draft },
    };
  }
  if (step.stepId === "ad-copy") {
    const draft = [
      `Google: Headline: ${offer}. Description: ${client} serves ${area}.`,
      `Meta: Primary text: ${offer} with ${client}. Headline: ${business}.`,
      "Google and Meta variants were not published. No spend was set.",
    ].join(" ");
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: "Google and Meta ad copy drafted. Nothing was published. No spend was set." },
      patch: { draft },
    };
  }
  if (step.stepId === "launch") {
    const output = "Needs a person before anything goes live. No live ad account was used. No spend was set.";
    return {
      outcome: {
        status: "needs_human" as const,
        output,
        lastError: output,
        log: "Dry run. Launch stopped for a person. No live ad account was used. No spend was set.",
      },
      patch: { draft: null },
    };
  }
  const leads = leadsForClient(state, step.tenantId, step.clientId);
  const listed = leads.map((row) => `${row.contactName}${row.followUpLeadId ? " (handed to Lead Follow-Up)" : ""}`);
  const draft = [
    `Weekly lead report for ${client} in ${workspaceLabel(state, step.tenantId)}.`,
    `Captured leads: ${leads.length}.`,
    listed.length ? listed.join("; ") + "." : "No leads captured yet.",
    "Spend is UNKNOWN. Nothing was emailed. No live ad account was read.",
  ].join(" ");
  return {
    outcome: {
      status: "done" as const,
      output: draft,
      lastError: null,
      log: "Weekly lead report drafted from captured leads in this workspace. Nothing was emailed.",
    },
    patch: { draft },
  };
}

const SPEC: PackageRunSpec = {
  packageId: "lead-generation",
  steps: LEAD_GEN_STEPS,
  killField: "leadGenerationKillSwitch",
  quietLine: QUIET,
  stopReason: `Stopped because an earlier step failed. Needs a person. ${QUIET}`,
  killMessage: `Workspace kill switch is on. Lead generation is stopped. ${QUIET} Sales outreach was not changed.`,
  noticePrefix: "lead_gen_run",
  outcome: leadGenOutcome,
};

export function tickLeadGeneration(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: PackageFlag & { ids?: IdFactory; runStep?: (step: PackageRunStep) => void } = {},
) {
  return tickPackageRun(state, tenantId, now, SPEC, opts);
}

export function setLeadGenerationKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: PackageFlag = {},
) {
  return setPackageWorkspaceKill(state, tenantId, on, now, SPEC, options);
}

export { saveClientIntake };

export type CaptureGeneratedInput = {
  enrollmentId: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  source?: string;
};

export type CaptureGeneratedResult =
  | { ok: true; state: FulfillmentState; leadId: string; followUpLeadId: string | null; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function ownsLeadGeneration(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "lead-generation" && !enrollment.includedPackageIds.includes("lead-generation")) return null;
  return enrollment;
}

/**
 * Record a lead on this client's Lead Generation package.
 * If the same client has active Lead Follow-Up, the lead is handed there.
 * Nothing is sent and no ad spend is set.
 */
export function captureGeneratedLead(
  state: FulfillmentState,
  tenantId: string,
  input: CaptureGeneratedInput,
  now: string,
  options: PackageFlag & { ids?: IdFactory } = {},
): CaptureGeneratedResult {
  if (!packagePipelineEnabled(options.enabled)) {
    return { ok: false, state, reason: "Package fulfillment is off." };
  }
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, state, reason: "Open this marketer's workspace before capturing a lead." };
  }
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. The lead was not captured and no charge was attempted." };
  }
  if (workspace.leadGenerationKillSwitch) {
    return { ok: false, state, reason: "Lead generation is stopped for this workspace. The lead was not captured. Nothing was sent and no spend was set." };
  }
  const enrollment = ownsLeadGeneration(state, tenantId, input.enrollmentId);
  if (!enrollment) {
    return { ok: false, state, reason: "Capture a lead on an active Lead Generation package in this workspace." };
  }
  if (enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This Lead Generation package is not running. The lead was not captured." };
  }
  const contactName = input.contactName.trim().replace(/\s+/g, " ");
  if (!contactName) return { ok: false, state, reason: "The lead needs a name." };
  const contactEmail = (input.contactEmail || "").trim();
  const contactPhone = (input.contactPhone || "").trim();
  const existing = (state.generatedLeads || []).find((row) => {
    if (row.tenantId !== tenantId || row.enrollmentId !== enrollment.id) return false;
    if (contactEmail) return normalize(row.contactEmail) === normalize(contactEmail);
    return normalize(row.contactName) === normalize(contactName);
  });
  if (existing) {
    return { ok: true, state, leadId: existing.id, followUpLeadId: existing.followUpLeadId, created: false };
  }

  const ids = options.ids || defaultRunIds("gen");
  const followUp = state.enrollments.find((row) =>
    row.tenantId === tenantId &&
    row.clientId === enrollment.clientId &&
    row.packageId === "lead-follow-up" &&
    row.status === "active" &&
    !row.killSwitch,
  );
  let followUpLeadId: string | null = null;
  let handoffNote = "This client does not have an active Lead Follow-Up package. The lead stayed on Lead Generation.";
  let next = state;
  if (followUp) {
    const handed = captureLead(state, tenantId, {
      enrollmentId: followUp.id,
      contactName,
      contactEmail,
      contactPhone,
      source: "lead-generation",
    }, now, { enabled: true, ids });
    if (handed.ok) {
      followUpLeadId = handed.leadId;
      handoffNote = handed.created
        ? "Handed to Lead Follow-Up. Nothing was sent."
        : "Already on Lead Follow-Up. Nothing was sent.";
      next = handed.state;
    } else {
      handoffNote = handed.reason;
    }
  }
  const lead: GeneratedLead = {
    id: `${tenantId}:${ids()}`,
    tenantId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
    contactName,
    contactEmail,
    contactPhone,
    source: (input.source || "landing page").trim() || "landing page",
    capturedAt: now,
    followUpLeadId,
    handoffNote,
  };
  return {
    ok: true,
    created: true,
    leadId: lead.id,
    followUpLeadId,
    state: { ...next, generatedLeads: [...(next.generatedLeads || []), lead] },
  };
}
