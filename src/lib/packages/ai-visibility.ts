import {
  clientLabel,
  intakeFor,
  setPackageWorkspaceKill,
  tickPackageRun,
  workspaceLabel,
  type PackageFlag,
  type PackageRunSpec,
} from "./package-runs.ts";
import type { IdFactory } from "./runner.ts";
import type { FulfillmentState, PackageRunStep } from "./types.ts";

const QUIET = "Nothing was published.";

export const AI_VISIBILITY_STEPS = [
  { id: "profile-audit", title: "Business profile audit", delayDays: 0, delayMonths: 0 },
  { id: "schema-faq", title: "Schema and FAQ draft", delayDays: 0, delayMonths: 0 },
  { id: "ai-recommendation", title: "AI recommendation check", delayDays: 0, delayMonths: 0 },
  { id: "monthly-report", title: "Monthly visibility report", delayDays: 0, delayMonths: 1 },
] as const;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function storedProfile(state: FulfillmentState, step: PackageRunStep) {
  const intake = intakeFor(state, step.tenantId, step.clientId);
  const client = clientLabel(state, step.tenantId, step.clientId) || "this client";
  return {
    client,
    businessName: (intake?.businessName || "").trim(),
    phone: (intake?.phone || "").trim(),
    address: (intake?.address || "").trim(),
    website: (intake?.website || "").trim(),
    offer: (intake?.offer || "").trim(),
    serviceArea: (intake?.serviceArea || "").trim(),
  };
}

function auditText(profile: ReturnType<typeof storedProfile>): string {
  const missing = [
    profile.businessName ? "" : "name",
    profile.phone ? "" : "phone",
    profile.address ? "" : "address",
    profile.website ? "" : "site",
  ].filter(Boolean);
  const mismatch = profile.businessName && normalize(profile.businessName) !== normalize(profile.client)
    ? `Name on file (${profile.businessName}) does not match the client name (${profile.client}).`
    : `Business name on file matches ${profile.client}.`;
  const gap = missing.length ? `Missing on file: ${missing.join(", ")}.` : "Name, address, phone, and site are on file.";
  return `${mismatch} ${gap} Checked stored workspace data only. No third-party page was read.`;
}

function aiVisibilityOutcome(state: FulfillmentState, step: PackageRunStep) {
  const profile = storedProfile(state, step);
  if (step.stepId === "profile-audit") {
    const draft = auditText(profile);
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: "Profile audit used stored name, address, phone, and site. No third-party page was read." },
      patch: { draft },
    };
  }
  if (step.stepId === "schema-faq") {
    const business: Record<string, string> = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: profile.businessName || profile.client,
    };
    if (profile.phone) business.telephone = profile.phone;
    if (profile.address) business.address = profile.address;
    if (profile.website) business.url = profile.website;
    const faq = `FAQ draft: What does ${profile.client} offer? ${profile.offer || "The offer on file."} Where does ${profile.client} work? ${profile.serviceArea || "The service area on file."}`;
    const draft = `${JSON.stringify(business)} ${faq} Nothing was published.`;
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: "Schema and FAQ drafted from stored intake. Nothing was published." },
      patch: { draft },
    };
  }
  if (step.stepId === "ai-recommendation") {
    const output = "Dry run. Needs a person. No live model or search API was called.";
    return {
      outcome: {
        status: "needs_human" as const,
        output,
        lastError: output,
        log: "Dry run. The AI recommendation check was recorded for a person. No live model or search API was called.",
      },
      patch: { draft: output },
    };
  }
  const draft = [
    `Monthly visibility report for ${profile.client} in ${workspaceLabel(state, step.tenantId)}.`,
    auditText(profile),
    "The schema and FAQ draft is on file. The recommendation check is a dry run and needs a person.",
    "No live model or search API was called. Nothing was published.",
  ].join(" ");
  return {
    outcome: {
      status: "done" as const,
      output: draft,
      lastError: null,
      log: "Monthly visibility report drafted from stored data. Nothing was published.",
    },
    patch: { draft },
  };
}

const SPEC: PackageRunSpec = {
  packageId: "ai-visibility",
  steps: AI_VISIBILITY_STEPS,
  killField: "aiVisibilityKillSwitch",
  quietLine: QUIET,
  stopReason: `Stopped because an earlier step failed. Needs a person. ${QUIET}`,
  killMessage: `Workspace kill switch is on. AI visibility is stopped. ${QUIET} Sales outreach was not changed.`,
  noticePrefix: "ai_visibility_run",
  outcome: aiVisibilityOutcome,
};

export function tickAiVisibility(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: PackageFlag & { ids?: IdFactory; runStep?: (step: PackageRunStep) => void } = {},
) {
  return tickPackageRun(state, tenantId, now, SPEC, opts);
}

export function setAiVisibilityKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: PackageFlag = {},
) {
  return setPackageWorkspaceKill(state, tenantId, on, now, SPEC, options);
}
