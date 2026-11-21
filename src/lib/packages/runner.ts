import { fakeBilling } from "./billing.ts";
import { withPipelineCapNotice } from "./cadence.ts";
import { getPackage, isPackageId, type PackageId } from "./catalog.ts";
import { connectionForIntegration, connectionLabel, missingConnectionLine } from "./connections.ts";
import { stepTemplates } from "./steps.ts";
import { workspaceFor } from "./tenancy.ts";
import { assertEnrollmentAllowed, assertPipelineRunAllowed, usageFor, writeUsage } from "./usage.ts";
import {
  NO_CREDENTIALS,
  type CredentialPort,
  type Enrollment,
  type EnrollmentStatus,
  type FulfillmentState,
  type PaymentRecord,
  type RecordPurchaseInput,
  type StepOutcome,
  type StepRun,
} from "./types.ts";

export const MAX_ATTEMPTS = 3;
const RETRY_MS = 60_000;
const LOG_CAP = 30;

export type IdFactory = () => string;

export type RecordResult =
  | { ok: true; state: FulfillmentState; clientId: string; enrollmentId: string }
  | { ok: false; state: FulfillmentState; reason: string };

export type TickOptions = {
  enabled: boolean;
  credentials?: CredentialPort;
  runStep?: (step: StepRun, credentials: CredentialPort) => StepOutcome;
};

function defaultIdFactory(): IdFactory {
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => `pkg_${stamp}_${++n}`;
}

export function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function addDays(iso: string, days: number): string {
  return addMs(iso, days * 24 * 60 * 60 * 1000);
}

export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function addMonthsDate(date: string, months: number): string {
  return addMonthsIso(`${date}T00:00:00.000Z`, months).slice(0, 10);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function appendLog(step: StepRun, at: string, message: string): StepRun {
  return { ...step, logs: [...step.logs, { at, message }].slice(-LOG_CAP) };
}

function initialNextRun(schedule: StepRun["schedule"], now: string): string {
  if (schedule === "weekly") return addDays(now, 7);
  return now;
}

function followingRun(schedule: StepRun["schedule"], now: string): string | null {
  if (schedule === "weekly") return addDays(now, 7);
  if (schedule === "monthly") return addMonthsIso(now, 1);
  return null;
}

export function defaultRunStep(step: StepRun, credentials: CredentialPort): StepOutcome {
  if (step.mode === "bookkeeping") return { status: "done", output: step.doneOutput };
  const kind = step.integration ? connectionForIntegration(step.integration) : null;
  if (!kind) return { status: "needs_human", output: step.missingOutput || "Needs a person. Nothing was sent." };
  const label = connectionLabel(kind);
  if (!step.integration || !credentials.has(step.integration)) {
    return { status: "needs_human", output: missingConnectionLine(kind, step.missingOutput) };
  }
  return { status: "needs_human", output: `${label} is marked connected in test mode, but the adapter is not wired. Nothing was sent.` };
}

function sameClient(tenantId: string, clientName: string, state: FulfillmentState) {
  const key = normalizeName(clientName);
  return state.clients.find((row) => row.tenantId === tenantId && normalizeName(row.name) === key) || null;
}

export function recordPurchase(
  state: FulfillmentState,
  tenantId: string,
  input: RecordPurchaseInput,
  now: string,
  ids: IdFactory = defaultIdFactory(),
): RecordResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, state, reason: "Open this marketer's workspace before recording a purchase." };
  }
  if (!isPackageId(input.packageId)) return { ok: false, state, reason: "Unknown package." };
  const pkg = getPackage(input.packageId);
  const clientName = input.clientName.trim().replace(/\s+/g, " ");
  if (!clientName) return { ok: false, state, reason: "The client needs a name." };
  const startedOn = input.startedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.startedOn) ? input.startedOn : dateOnly(now);
  let client = sameClient(tenantId, clientName, state);
  if (!client) {
    const gate = fakeBilling.assertCanAddClient(state, tenantId, now);
    if (!gate.ok) return { ok: false, state: gate.state, reason: gate.reason };
    state = gate.state;
  }
  if (pkg.addonOf) {
    const parent = client
      ? state.enrollments.find(
          (row) =>
            row.tenantId === tenantId &&
            row.clientId === client?.id &&
            row.packageId === pkg.addonOf &&
            row.status === "active",
        )
      : null;
    if (!parent) {
      return {
        ok: false,
        state,
        reason: "Estimate Follow-Ups is an add-on to Lead Follow-Up for this same client. A second follow-up sequence was not created.",
      };
    }
  }
  if (!client) {
    client = { id: ids(), tenantId, name: clientName, createdAt: now };
  }
  const existing = state.enrollments.find(
    (row) => row.tenantId === tenantId && row.clientId === client?.id && row.packageId === pkg.id && row.status !== "cancelled",
  );
  if (existing) return { ok: true, state, clientId: client.id, enrollmentId: existing.id };
  const enrollmentGate = assertEnrollmentAllowed(state, tenantId);
  if (!enrollmentGate.ok) return { ok: false, state, reason: enrollmentGate.reason };

  const enrollment: Enrollment = {
    id: ids(),
    tenantId,
    clientId: client.id,
    packageId: pkg.id,
    status: "active",
    killSwitch: false,
    setupFeeCents: pkg.setupCents,
    monthlyCents: pkg.monthlyCents,
    pricingKind: pkg.pricingKind,
    setupPayment: input.setupPayment,
    monthlyPayment: input.monthlyPayment,
    startedOn,
    renewsOn: addMonthsDate(startedOn, 1),
    includedPackageIds: [...pkg.includes],
    createdAt: now,
  };
  const steps: StepRun[] = stepTemplates(pkg.id).map(({ sourcePackageId, group, step }) => ({
    id: `${enrollment.id}:${sourcePackageId}:${step.id}`,
    tenantId,
    enrollmentId: enrollment.id,
    clientId: client.id,
    packageId: pkg.id,
    sourcePackageId,
    stepId: step.id,
    title: step.title,
    group,
    schedule: step.schedule,
    mode: step.mode,
    integration: step.integration,
    doneOutput: step.doneOutput,
    missingOutput: step.missingOutput,
    unwiredOutput: step.unwiredOutput,
    status: "pending",
    attempts: 0,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    nextRunAt: initialNextRun(step.schedule, now),
    output: "",
    logs: [{ at: now, message: "Scheduled." }],
  }));
  const clients = state.clients.some((row) => row.id === client?.id) ? state.clients : [...state.clients, client];
  const withRows: FulfillmentState = { ...state, clients, enrollments: [...state.enrollments, enrollment], steps: [...state.steps, ...steps] };
  const opened = withRows.workspaces.map((row) =>
    row.id === tenantId && row.onboarding === "packages" ? { ...row, onboarding: "connections" as const } : row,
  );
  const before = usageFor(state, tenantId);
  return {
    ok: true,
    clientId: client.id,
    enrollmentId: enrollment.id,
    state: writeUsage({ ...withRows, workspaces: opened }, { tenantId, pipelineRuns: before.pipelineRuns, enrollments: before.enrollments + 1 }),
  };
}

export function addClient(
  state: FulfillmentState,
  tenantId: string,
  clientName: string,
  now: string,
  ids: IdFactory = defaultIdFactory(),
): RecordResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, state, reason: "Open this marketer's workspace before adding a client." };
  }
  const name = clientName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, state, reason: "The client needs a name." };
  const existing = sameClient(tenantId, name, state);
  if (existing) {
    const advanced = state.workspaces.map((row) =>
      row.id === tenantId && row.onboarding === "client" ? { ...row, onboarding: "packages" as const } : row,
    );
    return { ok: true, state: { ...state, workspaces: advanced }, clientId: existing.id, enrollmentId: "" };
  }
  const gate = fakeBilling.assertCanAddClient(state, tenantId, now);
  if (!gate.ok) return { ok: false, state: gate.state, reason: gate.reason };
  const client = { id: ids(), tenantId, name, createdAt: now };
  const workspaces = gate.state.workspaces.map((row) =>
    row.id === tenantId && row.onboarding === "client" ? { ...row, onboarding: "packages" as const } : row,
  );
  return {
    ok: true,
    clientId: client.id,
    enrollmentId: "",
    state: { ...gate.state, workspaces, clients: [...gate.state.clients, client] },
  };
}

function advanceStep(step: StepRun, enrollment: Enrollment, now: string, opts: TickOptions): StepRun | null {
  if (enrollment.killSwitch || enrollment.status !== "active") return null;
  const credentials = opts.credentials || NO_CREDENTIALS;
  const run = opts.runStep || defaultRunStep;

  if (step.status === "needs_human" && step.nextRunAt && step.nextRunAt <= now) {
    return appendLog(
      { ...step, nextRunAt: followingRun(step.schedule, now) },
      now,
      "Still needs a person. The connection is still missing. Nothing was sent.",
    );
  }
  if (step.status === "pending") {
    if (step.nextRunAt && step.nextRunAt > now) return null;
    return appendLog({ ...step, status: "running", startedAt: step.startedAt || now }, now, "Started.");
  }
  if (step.status === "running") {
    try {
      const outcome = run(step, credentials);
      return appendLog(
        {
          ...step,
          status: outcome.status,
          finishedAt: now,
          output: outcome.output,
          nextRunAt: outcome.status === "failed" ? null : followingRun(step.schedule, now),
        },
        now,
        outcome.output,
      );
    } catch (err) {
      const attempts = step.attempts + 1;
      const message = err instanceof Error ? err.message : "Step failed.";
      if (attempts >= MAX_ATTEMPTS) {
        return appendLog(
          { ...step, status: "failed", attempts, finishedAt: now, output: "Failed after retries.", nextRunAt: null },
          now,
          message,
        );
      }
      return appendLog(
        { ...step, status: "pending", attempts, nextRunAt: addMs(now, RETRY_MS * attempts) },
        now,
        `Retry ${attempts} of ${MAX_ATTEMPTS - 1} scheduled. ${message}`,
      );
    }
  }
  if (step.status === "done" && step.nextRunAt && step.nextRunAt <= now && step.schedule !== "immediate") {
    return appendLog(
      { ...step, status: "pending", attempts: 0, startedAt: null, finishedAt: null, output: "", nextRunAt: now },
      now,
      "Next cycle opened.",
    );
  }
  return null;
}

/** Advance due steps for one tenant. Other tenants' rows are returned unchanged. */
export function tickFulfillment(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: TickOptions,
): { state: FulfillmentState; advanced: number } {
  if (!opts.enabled) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  let runs = usageFor(state, tenantId).pipelineRuns;
  let advanced = 0;
  let blocked: string | null = null;
  const steps = state.steps.map((step) => {
    if (step.tenantId !== tenantId) return step;
    const enrollment = state.enrollments.find((row) => row.id === step.enrollmentId && row.tenantId === tenantId);
    if (!enrollment) return step;
    const gate = assertPipelineRunAllowed(state, tenantId, runs);
    if (!gate.ok) {
      blocked = gate.reason;
      return step;
    }
    const next = advanceStep(step, enrollment, now, opts);
    if (!next) return step;
    runs += 1;
    advanced += 1;
    return next;
  });
  if (advanced === 0 && !blocked) return { state, advanced: 0 };
  const next = withPipelineCapNotice(
    writeUsage({ ...state, steps }, { ...usageFor(state, tenantId), pipelineRuns: runs }),
    tenantId,
    now,
    blocked,
    `run_${now}`,
  );
  return { state: next, advanced };
}

const CLIENT_STOP = "Kill switch is on. This client's pipeline is stopped. Nothing was sent. Sales outreach was not changed.";

function enrollmentInTenant(state: FulfillmentState, tenantId: string, enrollmentId: string): Enrollment | null {
  return state.enrollments.find((row) => row.id === enrollmentId && row.tenantId === tenantId) || null;
}

export function setKillSwitch(state: FulfillmentState, tenantId: string, enrollmentId: string, on: boolean, now: string): FulfillmentState {
  if (!enrollmentInTenant(state, tenantId, enrollmentId)) return state;
  return {
    ...state,
    enrollments: state.enrollments.map((row) => (row.id === enrollmentId && row.tenantId === tenantId ? { ...row, killSwitch: on } : row)),
    steps: state.steps.map((step) =>
      step.enrollmentId === enrollmentId && step.tenantId === tenantId && on
        ? appendLog(step, now, "Kill switch is on. This pipeline is stopped. Sales outreach was not changed.")
        : step,
    ),
    packageRunSteps: (state.packageRunSteps || []).map((step) =>
      step.enrollmentId === enrollmentId && step.tenantId === tenantId && on
        ? {
            ...step,
            logs: [...step.logs, { at: now, message: CLIENT_STOP }].slice(-30),
          }
        : step,
    ),
    reviewRequestSteps: (state.reviewRequestSteps || []).map((step) =>
      step.enrollmentId === enrollmentId && step.tenantId === tenantId && on
        ? { ...step, logs: [...step.logs, { at: now, message: CLIENT_STOP }].slice(-30) }
        : step,
    ),
    appointmentSteps: (state.appointmentSteps || []).map((step) =>
      step.enrollmentId === enrollmentId && step.tenantId === tenantId && on
        ? { ...step, logs: [...step.logs, { at: now, message: CLIENT_STOP }].slice(-30) }
        : step,
    ),
    estimateSteps: (state.estimateSteps || []).map((step) =>
      step.enrollmentId === enrollmentId && step.tenantId === tenantId && on
        ? { ...step, logs: [...step.logs, { at: now, message: CLIENT_STOP }].slice(-30) }
        : step,
    ),
  };
}

export function setEnrollmentStatus(
  state: FulfillmentState,
  tenantId: string,
  enrollmentId: string,
  status: EnrollmentStatus,
): FulfillmentState {
  if (!enrollmentInTenant(state, tenantId, enrollmentId)) return state;
  return {
    ...state,
    enrollments: state.enrollments.map((row) => (row.id === enrollmentId && row.tenantId === tenantId ? { ...row, status } : row)),
  };
}

export function setPayment(
  state: FulfillmentState,
  tenantId: string,
  enrollmentId: string,
  which: "setup" | "monthly",
  value: PaymentRecord,
): FulfillmentState {
  if (!enrollmentInTenant(state, tenantId, enrollmentId)) return state;
  return {
    ...state,
    enrollments: state.enrollments.map((row) => {
      if (row.id !== enrollmentId || row.tenantId !== tenantId) return row;
      return which === "setup" ? { ...row, setupPayment: value } : { ...row, monthlyPayment: value };
    }),
  };
}

export function emptyFulfillment(): FulfillmentState {
  return {
    workspaces: [],
    clients: [],
    enrollments: [],
    steps: [],
    connections: [],
    billingEvents: [],
    invoices: [],
    invites: [],
    memberships: [],
    usage: [],
    leads: [],
    leadSteps: [],
    intakes: [],
    packageRuns: [],
    packageRunSteps: [],
    generatedLeads: [],
    completedJobs: [],
    reviewRequestSteps: [],
    storedReviews: [],
    appointments: [],
    appointmentSteps: [],
    estimates: [],
    estimateSteps: [],
    adsMetrics: [],
    adsChangeNotes: [],
  };
}

export type { PackageId };
