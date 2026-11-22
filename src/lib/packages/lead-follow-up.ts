import {
  appendCadenceLog,
  cadenceRetryDelayMs,
  packagePipelineEnabled,
  stampWorkspaceKill,
  tickCadenceSteps,
  withPipelineCapNotice,
} from "./cadence.ts";
import { listConnections } from "./connections.ts";
import { draftFollowUp } from "./dry-run-sender.ts";
import { addDays, type IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { Enrollment, FollowUpLead, FulfillmentState, LeadStepId, LeadStepRun } from "./types.ts";
import { assertPipelineRunAllowed, finishPipelineRuns, usageFor, writeUsage } from "./usage.ts";

export const LEAD_MAX_ATTEMPTS = 3;
export const LEAD_BACKOFF_MS = 60_000;
export const LEAD_CADENCE: { id: LeadStepId; title: string; delayDays: number; sends: boolean }[] = [
  { id: "captured", title: "New lead captured", delayDays: 0, sends: false },
  { id: "speed-to-lead", title: "Speed-to-lead reply", delayDays: 0, sends: true },
  { id: "day-1", title: "Day 1 follow-up", delayDays: 1, sends: true },
  { id: "day-3", title: "Day 3 follow-up", delayDays: 3, sends: true },
  { id: "day-7", title: "Day 7 follow-up", delayDays: 7, sends: true },
];

export type LeadFlag = { enabled?: boolean; entitlements?: boolean };

export type CaptureLeadInput = {
  enrollmentId: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  source?: string;
};

export type CaptureLeadResult =
  | { ok: true; state: FulfillmentState; leadId: string; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

type LeadTickOptions = LeadFlag & {
  runStep?: (step: LeadStepRun, lead: FollowUpLead) => void;
};

type DraftStep = "speed-to-lead" | "day-1" | "day-3" | "day-7";

const LEAD_ORDER = LEAD_CADENCE.map((step) => step.id);
const LEAD_QUIET = "Nothing was sent.";
const LEAD_STOP = "Stopped because an earlier step failed. Needs a person. Nothing was sent.";

function defaultIds(): IdFactory {
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => `lead_${stamp}_${++n}`;
}

export function leadRetryDelayMs(attempt: number): number {
  return cadenceRetryDelayMs(attempt, LEAD_BACKOFF_MS);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function leadsOf(state: FulfillmentState): FollowUpLead[] {
  return state.leads || [];
}

function stepsOf(state: FulfillmentState): LeadStepRun[] {
  return state.leadSteps || [];
}

function enrollmentFor(state: FulfillmentState, tenantId: string, enrollmentId: string): Enrollment | null {
  return state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId) || null;
}

function clientName(state: FulfillmentState, tenantId: string, clientId: string): string {
  return state.clients.find((row) => row.id === clientId && row.tenantId === tenantId)?.name || "";
}

export function mailboxBlock(state: FulfillmentState, tenantId: string): string {
  const row = listConnections(state, tenantId).find((item) => item.kind === "mailbox");
  if (row?.status === "stub_connected") {
    return "Connected (test): Mailbox. Missing connection: Mailbox. The test stub cannot send. Nothing was sent.";
  }
  return "Missing connection: Mailbox. Nothing was sent. Sales outreach was not used.";
}

function duplicateLead(state: FulfillmentState, tenantId: string, enrollmentId: string, email: string, name: string): FollowUpLead | null {
  const emailKey = normalize(email);
  const nameKey = normalize(name);
  return leadsOf(state).find((row) => {
    if (row.tenantId !== tenantId || row.enrollmentId !== enrollmentId) return false;
    if (emailKey) return normalize(row.contactEmail) === emailKey;
    return normalize(row.contactName) === nameKey;
  }) || null;
}

export function captureLead(
  state: FulfillmentState,
  tenantId: string,
  input: CaptureLeadInput,
  now: string,
  options: LeadFlag & { ids?: IdFactory } = {},
): CaptureLeadResult {
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
  if (workspace.leadFollowUpKillSwitch) {
    return { ok: false, state, reason: "Lead follow-up is stopped for this workspace. The lead was not captured. Nothing was sent." };
  }
  const enrollment = enrollmentFor(state, tenantId, input.enrollmentId);
  if (!enrollment || enrollment.packageId !== "lead-follow-up") {
    return { ok: false, state, reason: "Capture a lead on an active Lead Follow-Up package in this workspace." };
  }
  if (enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This Lead Follow-Up package is not running. The lead was not captured." };
  }
  const contactName = input.contactName.trim().replace(/\s+/g, " ");
  if (!contactName) return { ok: false, state, reason: "The lead needs a name." };
  const contactEmail = (input.contactEmail || "").trim();
  const contactPhone = (input.contactPhone || "").trim();
  const existing = duplicateLead(state, tenantId, enrollment.id, contactEmail, contactName);
  if (existing) return { ok: true, state, leadId: existing.id, created: false };

  const ids = options.ids || defaultIds();
  const lead: FollowUpLead = {
    id: `${tenantId}:${ids()}`,
    tenantId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
    contactName,
    contactEmail,
    contactPhone,
    source: (input.source || "inquiry").trim() || "inquiry",
    status: "active",
    capturedAt: now,
    repliedAt: null,
  };
  const steps: LeadStepRun[] = LEAD_CADENCE.map((step) => ({
    id: `${lead.id}:${step.id}`,
    tenantId,
    leadId: lead.id,
    enrollmentId: enrollment.id,
    clientId: enrollment.clientId,
    stepId: step.id,
    title: step.title,
    sends: step.sends,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    nextRunAt: addDays(now, step.delayDays),
    output: "",
    draftedMessage: null,
    logs: [{ at: now, message: "Scheduled." }],
  }));
  return {
    ok: true,
    created: true,
    leadId: lead.id,
    state: { ...state, leads: [...leadsOf(state), lead], leadSteps: [...stepsOf(state), ...steps] },
  };
}

function dryRunOutcome(state: FulfillmentState, step: LeadStepRun, lead: FollowUpLead): {
  status: "done" | "needs_human";
  output: string;
  lastError: string | null;
  draftedMessage: string | null;
  log: string;
} {
  if (!step.sends) {
    return {
      status: "done",
      output: "Lead captured for this workspace. No message was sent.",
      lastError: null,
      draftedMessage: null,
      log: "Lead captured. No message was sent.",
    };
  }
  const draft = draftFollowUp({
    stepId: step.stepId as DraftStep,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    contactPhone: lead.contactPhone,
    clientName: clientName(state, step.tenantId, step.clientId),
  });
  const blocked = mailboxBlock(state, step.tenantId);
  return {
    status: "needs_human",
    output: blocked,
    lastError: blocked,
    draftedMessage: draft.body,
    log: draft.logLine,
  };
}

/** Advance due Lead Follow-Up steps for one workspace. A no-op while the flag is off. */
export function tickLeadFollowUp(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: LeadTickOptions = {},
): { state: FulfillmentState; advanced: number } {
  if (!packagePipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  const leads = leadsOf(state);
  const tick = tickCadenceSteps({
    state,
    tenantId,
    now,
    steps: stepsOf(state),
    order: LEAD_ORDER,
    groupId: (step) => step.leadId,
    inGroup: (row, step) => row.leadId === step.leadId,
    prepare: (step) => {
      const lead = leads.find((row) => row.id === step.leadId && row.tenantId === tenantId);
      const enrollment = lead ? enrollmentFor(state, tenantId, lead.enrollmentId) : null;
      if (!lead || !enrollment) return { skip: true };
      return {
        skip: false,
        runnable: !workspace.leadFollowUpKillSwitch
          && !enrollment.killSwitch
          && enrollment.status === "active"
          && lead.status === "active"
          && !lead.repliedAt,
      };
    },
    execute: (step) => {
      const lead = leads.find((row) => row.id === step.leadId && row.tenantId === tenantId);
      if (!lead) throw new Error("Lead is missing.");
      opts.runStep?.(step, lead);
      const outcome = dryRunOutcome(state, step, lead);
      return {
        outcome: {
          status: outcome.status,
          output: outcome.output,
          lastError: outcome.lastError,
          log: outcome.log,
        },
        patch: { draftedMessage: outcome.draftedMessage },
      };
    },
    quietLine: LEAD_QUIET,
    stopReason: LEAD_STOP,
    runs: usageFor(state, tenantId).pipelineRuns,
    allow: (runs) => assertPipelineRunAllowed(state, tenantId, runs, now, opts.entitlements),
  });
  if (tick.unchanged) return { state, advanced: 0 };
  let next = writeUsage({ ...state, leadSteps: tick.steps }, { ...usageFor(state, tenantId), pipelineRuns: tick.runs });
  if (tick.escalations.length > 0) {
    const failed = new Set(tick.escalations.map((row) => row.groupId));
    next = {
      ...next,
      leads: leadsOf(next).map((lead) => failed.has(lead.id) && lead.tenantId === tenantId ? { ...lead, status: "needs_human" as const } : lead),
    };
  }
  next = withPipelineCapNotice(next, tenantId, now, tick.blocked, `lead_run_${now}`);
  return { state: finishPipelineRuns(next, tenantId, now, tick.advanced, opts.entitlements), advanced: tick.advanced };
}

const WORKSPACE_KILL = "Workspace kill switch is on. Lead follow-up is stopped. Nothing was sent. Sales outreach was not changed.";

export function setLeadFollowUpKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: LeadFlag = {},
): FulfillmentState {
  if (!packagePipelineEnabled(options.enabled)) return state;
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.leadFollowUpKillSwitch === on) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((row) => row.id === tenantId ? { ...row, leadFollowUpKillSwitch: on } : row),
    leadSteps: on ? stampWorkspaceKill(stepsOf(state), tenantId, now, WORKSPACE_KILL, () => true) : stepsOf(state),
  };
}

const REPLY_REASON = "Lead replied. Needs a person. Nothing was sent.";

/** Stop the rest of the cadence when the lead writes back. Does not send a reply. */
export function recordLeadReply(
  state: FulfillmentState,
  tenantId: string,
  leadId: string,
  now: string,
  options: LeadFlag = {},
): FulfillmentState {
  if (!packagePipelineEnabled(options.enabled)) return state;
  const lead = leadsOf(state).find((row) => row.id === leadId && row.tenantId === tenantId);
  if (!lead || lead.repliedAt) return state;
  return {
    ...state,
    leads: leadsOf(state).map((row) => row.id === lead.id ? { ...row, status: "needs_human" as const, repliedAt: now } : row),
    leadSteps: stepsOf(state).map((step) => {
      if (step.leadId !== lead.id || step.tenantId !== tenantId || step.status === "done") return step;
      return appendCadenceLog(
        {
          ...step,
          status: "needs_human",
          finishedAt: step.finishedAt || now,
          nextRunAt: null,
          lastError: step.lastError || REPLY_REASON,
          output: step.output || REPLY_REASON,
        },
        now,
        REPLY_REASON,
      );
    }),
  };
}
