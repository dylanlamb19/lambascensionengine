import { FLAGS } from "../flags.ts";
import { listConnections } from "./connections.ts";
import { draftFollowUp } from "./dry-run-sender.ts";
import { addDays, addMs, tickFulfillment, type IdFactory, type TickOptions } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { CredentialPort, Enrollment, FollowUpLead, FulfillmentState, LeadStepId, LeadStepRun } from "./types.ts";
import { assertPipelineRunAllowed, usageFor, writeUsage } from "./usage.ts";

export const LEAD_MAX_ATTEMPTS = 3;
export const LEAD_BACKOFF_MS = 60_000;
const LOG_CAP = 30;

export const LEAD_CADENCE: { id: LeadStepId; title: string; delayDays: number; sends: boolean }[] = [
  { id: "captured", title: "New lead captured", delayDays: 0, sends: false },
  { id: "speed-to-lead", title: "Speed-to-lead reply", delayDays: 0, sends: true },
  { id: "day-1", title: "Day 1 follow-up", delayDays: 1, sends: true },
  { id: "day-3", title: "Day 3 follow-up", delayDays: 3, sends: true },
  { id: "day-7", title: "Day 7 follow-up", delayDays: 7, sends: true },
];

export type LeadFlag = { enabled?: boolean };

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

function pipelineEnabled(override?: boolean): boolean {
  if (override === false) return false;
  if (override === true) return true;
  return FLAGS.PACKAGE_FULFILLMENT;
}

function defaultIds(): IdFactory {
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => `lead_${stamp}_${++n}`;
}

export function leadRetryDelayMs(attempt: number): number {
  return LEAD_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function appendLog(step: LeadStepRun, at: string, message: string): LeadStepRun {
  return { ...step, logs: [...step.logs, { at, message }].slice(-LOG_CAP) };
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
  if (!pipelineEnabled(options.enabled)) {
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

function predecessorSettled(steps: LeadStepRun[], step: LeadStepRun): boolean {
  const index = LEAD_CADENCE.findIndex((row) => row.id === step.stepId);
  if (index <= 0) return true;
  const previousId = LEAD_CADENCE[index - 1]?.id;
  const previous = steps.find((row) => row.leadId === step.leadId && row.stepId === previousId);
  if (!previous) return false;
  return previous.status === "done" || previous.status === "needs_human" || previous.status === "failed";
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

type AdvanceResult = { step: LeadStepRun; escalate: boolean };

function advanceLeadStep(
  steps: LeadStepRun[],
  step: LeadStepRun,
  lead: FollowUpLead,
  enrollment: Enrollment,
  state: FulfillmentState,
  now: string,
  opts: LeadTickOptions,
): AdvanceResult | null {
  const workspace = workspaceFor(state, step.tenantId);
  if (!workspace || workspace.leadFollowUpKillSwitch) return null;
  if (enrollment.killSwitch || enrollment.status !== "active") return null;
  if (lead.status !== "active" || lead.repliedAt) return null;
  if (step.status === "pending") {
    if (!predecessorSettled(steps, step)) return null;
    if (step.nextRunAt && step.nextRunAt > now) return null;
    return { escalate: false, step: appendLog({ ...step, status: "running", startedAt: step.startedAt || now }, now, "Started.") };
  }
  if (step.status !== "running") return null;
  try {
    opts.runStep?.(step, lead);
    const outcome = dryRunOutcome(state, step, lead);
    return {
      escalate: false,
      step: appendLog(
        {
          ...step,
          status: outcome.status,
          attempts: step.attempts + 1,
          finishedAt: now,
          nextRunAt: null,
          output: outcome.output,
          lastError: outcome.lastError,
          draftedMessage: outcome.draftedMessage,
        },
        now,
        outcome.log,
      ),
    };
  } catch (err) {
    const attempts = step.attempts + 1;
    const message = err instanceof Error ? err.message : "Step failed.";
    if (attempts >= LEAD_MAX_ATTEMPTS) {
      return {
        escalate: true,
        step: appendLog(
          {
            ...step,
            status: "needs_human",
            attempts,
            finishedAt: now,
            nextRunAt: null,
            lastError: message,
            output: `Failed after retries. Needs a person. ${message} Nothing was sent.`,
          },
          now,
          message,
        ),
      };
    }
    const delay = leadRetryDelayMs(attempts);
    return {
      escalate: false,
      step: appendLog(
        {
          ...step,
          status: "pending",
          attempts,
          finishedAt: null,
          nextRunAt: addMs(now, delay),
          lastError: message,
        },
        now,
        `Retry ${attempts} of ${LEAD_MAX_ATTEMPTS - 1} scheduled in ${delay}ms. ${message} Nothing was sent.`,
      ),
    };
  }
}

function stopLaterSteps(steps: LeadStepRun[], tenantId: string, leadId: string, failedStepId: string, now: string, reason: string): LeadStepRun[] {
  const failedIndex = LEAD_CADENCE.findIndex((row) => row.id === failedStepId);
  return steps.map((step) => {
    if (step.leadId !== leadId || step.tenantId !== tenantId) return step;
    const index = LEAD_CADENCE.findIndex((row) => row.id === step.stepId);
    if (index <= failedIndex) return step;
    if (step.status === "done" || step.status === "needs_human" || step.status === "failed") return step;
    return appendLog(
      {
        ...step,
        status: "needs_human",
        finishedAt: now,
        nextRunAt: null,
        lastError: reason,
        output: reason,
      },
      now,
      reason,
    );
  });
}

/** Advance due Lead Follow-Up steps for one workspace. A no-op while the flag is off. */
export function tickLeadFollowUp(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: LeadTickOptions = {},
): { state: FulfillmentState; advanced: number } {
  if (!pipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  let runs = usageFor(state, tenantId).pipelineRuns;
  let advanced = 0;
  let blocked: string | null = null;
  const failedLeads = new Map<string, string>();
  const original = stepsOf(state);
  let leadSteps = original.map((step) => {
    if (step.tenantId !== tenantId) return step;
    const lead = leadsOf(state).find((row) => row.id === step.leadId && row.tenantId === tenantId);
    const enrollment = lead ? enrollmentFor(state, tenantId, lead.enrollmentId) : null;
    if (!lead || !enrollment) return step;
    const gate = assertPipelineRunAllowed(state, tenantId, runs);
    if (!gate.ok) {
      blocked = gate.reason;
      return step;
    }
    const next = advanceLeadStep(original, step, lead, enrollment, state, now, opts);
    if (!next) return step;
    runs += 1;
    advanced += 1;
    if (next.escalate) failedLeads.set(step.leadId, step.stepId);
    return next.step;
  });
  if (failedLeads.size > 0) {
    const reason = "Stopped because an earlier step failed. Needs a person. Nothing was sent.";
    for (const [leadId, stepId] of failedLeads) {
      leadSteps = stopLaterSteps(leadSteps, tenantId, leadId, stepId, now, reason);
    }
  }
  if (advanced === 0 && !blocked) return { state, advanced: 0 };
  let next = writeUsage({ ...state, leadSteps }, { ...usageFor(state, tenantId), pipelineRuns: runs });
  if (failedLeads.size > 0) {
    next = {
      ...next,
      leads: leadsOf(next).map((lead) => failedLeads.has(lead.id) && lead.tenantId === tenantId ? { ...lead, status: "needs_human" as const } : lead),
    };
  }
  const blockType = workspace.subscriptionStatus === "canceled" ? "subscription_canceled" : "pipeline_limit";
  if (blocked && !(next.billingEvents || []).some((row) => row.tenantId === tenantId && row.type === blockType)) {
    next = {
      ...next,
      billingEvents: [...(next.billingEvents || []), {
        id: `lead_run_${now}`,
        tenantId,
        type: blockType,
        planId: workspace.planId,
        amountCents: 0 as const,
        billingMode: "test" as const,
        at: now,
      }],
    };
  }
  return { state: next, advanced };
}

export function setLeadFollowUpKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: LeadFlag = {},
): FulfillmentState {
  if (!pipelineEnabled(options.enabled)) return state;
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.leadFollowUpKillSwitch === on) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((row) => row.id === tenantId ? { ...row, leadFollowUpKillSwitch: on } : row),
    leadSteps: stepsOf(state).map((step) =>
      step.tenantId === tenantId && on
        ? appendLog(step, now, "Workspace kill switch is on. Lead follow-up is stopped. Nothing was sent. Sales outreach was not changed.")
        : step,
    ),
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
  if (!pipelineEnabled(options.enabled)) return state;
  const lead = leadsOf(state).find((row) => row.id === leadId && row.tenantId === tenantId);
  if (!lead || lead.repliedAt) return state;
  return {
    ...state,
    leads: leadsOf(state).map((row) => row.id === lead.id ? { ...row, status: "needs_human" as const, repliedAt: now } : row),
    leadSteps: stepsOf(state).map((step) => {
      if (step.leadId !== lead.id || step.tenantId !== tenantId || step.status === "done") return step;
      return appendLog(
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

/**
 * Tick package steps and Lead Follow-Up together.
 * Returns the same state while PACKAGE_FULFILLMENT is off, unless a test passes enabled.
 * This is not a cron. No mailbox, text message, or sales outreach sender is called.
 */
export function tickPackagePipelines(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: LeadFlag & { credentials?: CredentialPort; runLeadStep?: LeadTickOptions["runStep"] } = {},
): { state: FulfillmentState; advanced: number } {
  if (!pipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const packageTick = tickFulfillment(state, tenantId, now, {
    enabled: true,
    credentials: opts.credentials,
  } satisfies TickOptions);
  const leadTick = tickLeadFollowUp(packageTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runLeadStep,
  });
  return { state: leadTick.state, advanced: packageTick.advanced + leadTick.advanced };
}
