import {
  appendCadenceLog,
  packagePipelineEnabled,
  stampWorkspaceKill,
  stopLaterCadenceSteps,
  tickCadenceSteps,
  withPipelineCapNotice,
} from "./cadence.ts";
import { listConnections } from "./connections.ts";
import { draftAppointmentMessage, type AppointmentDraftKind } from "./dry-run-sender.ts";
import { clientLabel, enrollmentFor, type PackageFlag } from "./package-runs.ts";
import type { IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { AppointmentStep, AppointmentStepId, ClientAppointment, FulfillmentState } from "./types.ts";
import { assertPipelineRunAllowed, finishPipelineRuns, usageFor, writeUsage } from "./usage.ts";

/** Reminders wait outside 8:00–21:00 America/Chicago. This copy does not read the sales-mail hour gate. */
export const REMINDER_TIME_ZONE = "America/Chicago";
export const REMINDER_OPEN_HOUR = 8;
export const REMINDER_CLOSE_HOUR = 21;
export const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
export const REMINDER_2H_MS = 2 * 60 * 60 * 1000;
export const CLIENT_BOOKING_CALENDAR = "booking_calendar";
export const OWNER_CALENDAR_LINE = "The owner sales calendar was not read.";

const QUIET = `Nothing was sent. ${OWNER_CALENDAR_LINE}`;
const STOP = `Stopped because an earlier step failed. Needs a person. ${QUIET}`;
const KILL = `Workspace kill switch is on. Appointment reminders are stopped. ${QUIET} Sales outreach was not changed.`;

export const APPOINTMENT_STEPS: { id: AppointmentStepId; title: string }[] = [
  { id: "confirm", title: "Confirmation" },
  { id: "reminder-24h", title: "Reminder, 24 hours" },
  { id: "reminder-2h", title: "Reminder, 2 hours" },
  { id: "no-show", title: "No-show follow-up" },
];

const ORDER = APPOINTMENT_STEPS.map((step) => step.id);

export type AppointmentFlag = PackageFlag;

type IdOpts = AppointmentFlag & { ids?: IdFactory; runStep?: (step: AppointmentStep) => void };

function defaultIds(): IdFactory {
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => `appt_${stamp}_${++n}`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function appointmentsOf(state: FulfillmentState): ClientAppointment[] {
  return state.appointments || [];
}

function stepsOf(state: FulfillmentState): AppointmentStep[] {
  return state.appointmentSteps || [];
}

export function chicagoHour(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REMINDER_TIME_ZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const raw = Number(parts.find((part) => part.type === "hour")?.value);
  if (!Number.isFinite(raw)) return 0;
  return raw === 24 ? 0 : raw;
}

export function withinReminderHours(iso: string): boolean {
  const hour = chicagoHour(iso);
  return hour >= REMINDER_OPEN_HOUR && hour < REMINDER_CLOSE_HOUR;
}

/** Move a send instant to the next 8:00 America/Chicago when it falls in quiet hours. */
export function quietHoursShift(iso: string): { at: string; held: boolean } {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return { at: iso, held: false };
  let cursor = start.getTime();
  for (let i = 0; i < 24 * 4 * 3; i += 1) {
    const at = new Date(cursor).toISOString();
    if (withinReminderHours(at)) return { at, held: cursor !== start.getTime() };
    cursor += 15 * 60 * 1000;
  }
  return { at: start.toISOString(), held: false };
}

function scheduleAt(targetIso: string, now: string): { at: string; held: boolean } {
  const target = targetIso > now ? targetIso : now;
  return quietHoursShift(target);
}

function reminderInstant(startsAt: string, stepId: AppointmentStepId, now: string): { at: string; held: boolean } {
  if (stepId === "confirm") return scheduleAt(now, now);
  if (stepId === "no-show") return scheduleAt(startsAt, now);
  const offset = stepId === "reminder-24h" ? REMINDER_24H_MS : REMINDER_2H_MS;
  const raw = new Date(new Date(startsAt).getTime() - offset).toISOString();
  return scheduleAt(raw, now);
}

export function bookingCalendarLine(state: FulfillmentState, tenantId: string): { connected: boolean; line: string } {
  const row = listConnections(state, tenantId).find((item) => item.kind === "booking_calendar");
  if (row?.status === "stub_connected") {
    return {
      connected: true,
      line: `Connected (test): Booking calendar. No calendar API was called. ${OWNER_CALENDAR_LINE}`,
    };
  }
  return {
    connected: false,
    line: `Missing connection: Booking calendar. ${OWNER_CALENDAR_LINE}`,
  };
}

function appointmentEnrollment(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "appointment-reminders" && !enrollment.includedPackageIds.includes("appointment-reminders")) return null;
  return enrollment;
}

export type RecordAppointmentInput = {
  enrollmentId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  startsAt: string;
  /** Only `booking_calendar` is accepted. The owner sales calendar is refused. */
  calendar?: string;
};

export type RecordAppointmentResult =
  | { ok: true; state: FulfillmentState; appointmentId: string; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

/**
 * Record a booking that belongs to this workspace's booking calendar.
 * Any other calendar, including the owner sales calendar, is refused.
 */
export function recordAppointment(
  state: FulfillmentState,
  tenantId: string,
  input: RecordAppointmentInput,
  now: string,
  options: IdOpts = {},
): RecordAppointmentResult {
  if (!packagePipelineEnabled(options.enabled)) return { ok: false, state, reason: "Package fulfillment is off." };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false, state, reason: "Open this marketer's workspace before recording an appointment." };
  }
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false, state, reason: "This test subscription is canceled. The appointment was not recorded and no charge was attempted." };
  }
  if (workspace.appointmentRemindersKillSwitch) {
    return { ok: false, state, reason: `Appointment reminders are stopped for this workspace. ${QUIET}` };
  }
  const calendar = (input.calendar || CLIENT_BOOKING_CALENDAR).trim();
  if (calendar !== CLIENT_BOOKING_CALENDAR) {
    return { ok: false, state, reason: `Appointment reminders use this workspace's booking calendar only. ${OWNER_CALENDAR_LINE}` };
  }
  const startsAt = (input.startsAt || "").trim();
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) {
    return { ok: false, state, reason: "The appointment needs a start time from the client's booking calendar." };
  }
  const customerName = input.customerName.trim().replace(/\s+/g, " ");
  if (!customerName) return { ok: false, state, reason: "The appointment needs the customer's name." };
  const enrollment = appointmentEnrollment(state, tenantId, input.enrollmentId);
  if (!enrollment) return { ok: false, state, reason: "Record this on an active Appointment Reminders package in this workspace." };
  if (enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This client's appointment pipeline is not running. Nothing was sent." };
  }
  const existing = appointmentsOf(state).find((row) =>
    row.tenantId === tenantId
    && row.enrollmentId === enrollment.id
    && normalize(row.customerName) === normalize(customerName)
    && row.startsAt === startsAt
    && row.calendar === CLIENT_BOOKING_CALENDAR,
  );
  if (existing) return { ok: true, state, appointmentId: existing.id, created: false };
  const ids = options.ids || defaultIds();
  const appointment: ClientAppointment = {
    id: ids(),
    tenantId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
    customerName,
    customerEmail: (input.customerEmail || "").trim(),
    customerPhone: (input.customerPhone || "").trim(),
    startsAt,
    calendar: CLIENT_BOOKING_CALENDAR,
    status: "active",
    response: "none",
    outcome: "unset",
    lastNote: "",
    recordedAt: now,
  };
  const steps: AppointmentStep[] = APPOINTMENT_STEPS.map((step) => {
    const when = reminderInstant(startsAt, step.id, now);
    const quiet = when.held ? ` Quiet hours. Held until ${when.at}.` : "";
    return {
      id: `${appointment.id}:${step.id}`,
      tenantId,
      appointmentId: appointment.id,
      enrollmentId: enrollment.id,
      clientId: enrollment.clientId,
      stepId: step.id,
      title: step.title,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      nextRunAt: when.at,
      output: "",
      draftedMessage: null,
      logs: [{ at: now, message: `Scheduled from the client's booking calendar.${quiet} ${OWNER_CALENDAR_LINE}` }],
    };
  });
  return {
    ok: true,
    appointmentId: appointment.id,
    created: true,
    state: {
      ...state,
      appointments: [...appointmentsOf(state), appointment],
      appointmentSteps: [...stepsOf(state), ...steps],
    },
  };
}

function draftFor(state: FulfillmentState, step: AppointmentStep, appointment: ClientAppointment, kind: AppointmentDraftKind) {
  return draftAppointmentMessage({
    kind,
    customerName: appointment.customerName,
    customerEmail: appointment.customerEmail,
    customerPhone: appointment.customerPhone,
    clientName: clientLabel(state, step.tenantId, step.clientId),
    whenLabel: appointment.startsAt,
  });
}

function appointmentOutcome(state: FulfillmentState, step: AppointmentStep) {
  const appointment = appointmentsOf(state).find((row) => row.id === step.appointmentId && row.tenantId === step.tenantId);
  const calendar = bookingCalendarLine(state, step.tenantId);
  if (!appointment || appointment.calendar !== CLIENT_BOOKING_CALENDAR) {
    const output = `This reminder is not tied to the client's booking calendar. ${OWNER_CALENDAR_LINE}`;
    return {
      outcome: { status: "needs_human" as const, output, lastError: output, log: output },
      patch: { draftedMessage: null as string | null },
    };
  }
  if (!calendar.connected) {
    return {
      outcome: { status: "needs_human" as const, output: calendar.line, lastError: calendar.line, log: calendar.line },
      patch: { draftedMessage: null as string | null },
    };
  }
  if (step.stepId === "no-show") {
    if (appointment.outcome === "attended") {
      const output = `The customer attended. No follow-up was drafted. ${calendar.line}`;
      return {
        outcome: { status: "done" as const, output, lastError: null, log: output },
        patch: { draftedMessage: null as string | null },
      };
    }
    if (appointment.outcome !== "no_show") {
      const output = `No-show was not recorded. No follow-up was sent. ${calendar.line}`;
      return {
        outcome: { status: "needs_human" as const, output, lastError: output, log: output },
        patch: { draftedMessage: null as string | null },
      };
    }
    const draft = draftFor(state, step, appointment, "no-show");
    const output = `${draft.logLine} ${calendar.line}`;
    return {
      outcome: { status: "done" as const, output, lastError: null, log: output },
      patch: { draftedMessage: draft.body },
    };
  }
  const kind: AppointmentDraftKind = step.stepId === "reminder-24h" || step.stepId === "reminder-2h" ? step.stepId : "confirm";
  const draft = draftFor(state, step, appointment, kind);
  const output = `${draft.logLine} ${calendar.line}`;
  return {
    outcome: { status: "done" as const, output, lastError: null, log: output },
    patch: { draftedMessage: draft.body },
  };
}

export function tickAppointments(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: IdOpts = {},
): { state: FulfillmentState; advanced: number } {
  if (!packagePipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  const original = stepsOf(state);
  const tick = tickCadenceSteps({
    state,
    tenantId,
    now,
    steps: original,
    order: ORDER,
    groupId: (step) => step.appointmentId,
    inGroup: (row, step) => row.appointmentId === step.appointmentId,
    prepare: (step) => {
      const appointment = appointmentsOf(state).find((row) => row.id === step.appointmentId && row.tenantId === tenantId);
      const enrollment = appointment ? enrollmentFor(state, tenantId, appointment.enrollmentId) : null;
      if (!appointment || !enrollment) return { skip: true };
      return {
        skip: false,
        runnable: !workspace.appointmentRemindersKillSwitch
          && !enrollment.killSwitch
          && enrollment.status === "active"
          && appointment.status === "active"
          && appointment.calendar === CLIENT_BOOKING_CALENDAR,
      };
    },
    execute: (step) => {
      opts.runStep?.(step);
      return appointmentOutcome(state, step);
    },
    quietLine: QUIET,
    stopReason: STOP,
    runs: usageFor(state, tenantId).pipelineRuns,
    allow: (runs) => assertPipelineRunAllowed(state, tenantId, runs, now, opts.entitlements),
  });
  if (tick.unchanged) return { state, advanced: 0 };
  let steps = tick.steps;
  const freshlyBlocked = steps.filter((step) => {
    if (step.tenantId !== tenantId || step.status !== "needs_human") return false;
    if (!(step.lastError || "").includes("Missing connection: Booking calendar")) return false;
    const before = original.find((row) => row.id === step.id);
    return Boolean(before && before.status !== "needs_human");
  });
  for (const step of freshlyBlocked) {
    steps = stopLaterCadenceSteps(steps, ORDER, step.stepId, (row) => row.appointmentId === step.appointmentId && row.tenantId === tenantId, now, step.lastError || STOP);
  }
  const blockedIds = new Set([
    ...tick.escalations.map((row) => row.groupId),
    ...freshlyBlocked.map((step) => step.appointmentId),
  ]);
  const next = withPipelineCapNotice(
    writeUsage({
      ...state,
      appointmentSteps: steps,
      appointments: appointmentsOf(state).map((row) => blockedIds.has(row.id) && row.tenantId === tenantId ? { ...row, status: "needs_human" as const } : row),
    }, { ...usageFor(state, tenantId), pipelineRuns: tick.runs }),
    tenantId,
    now,
    tick.blocked,
    `appointment_run_${now}`,
  );
  return { state: finishPipelineRuns(next, tenantId, now, tick.advanced, opts.entitlements), advanced: tick.advanced };
}

export type AppointmentReplyInput = {
  appointmentId: string;
  kind: "confirm" | "reschedule" | "no_show" | "attended";
  startsAt?: string;
};

export type AppointmentReplyResult =
  | { ok: true; state: FulfillmentState }
  | { ok: false; state: FulfillmentState; reason: string };

/** Record a confirm, reschedule, no-show, or attended note. Nothing is sent and the sales calendar is not written. */
export function handleAppointmentReply(
  state: FulfillmentState,
  tenantId: string,
  input: AppointmentReplyInput,
  now: string,
  options: AppointmentFlag = {},
): AppointmentReplyResult {
  if (!packagePipelineEnabled(options.enabled)) return { ok: false, state, reason: "Package fulfillment is off." };
  const appointment = appointmentsOf(state).find((row) => row.id === input.appointmentId && row.tenantId === tenantId);
  if (!appointment || appointment.calendar !== CLIENT_BOOKING_CALENDAR) {
    return { ok: false, state, reason: `That appointment is not on this workspace's booking calendar. ${OWNER_CALENDAR_LINE}` };
  }
  const workspace = workspaceFor(state, tenantId);
  if (workspace?.appointmentRemindersKillSwitch) {
    return { ok: false, state, reason: `Appointment reminders are stopped for this workspace. ${QUIET}` };
  }
  const enrollment = enrollmentFor(state, tenantId, appointment.enrollmentId);
  if (!enrollment || enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false, state, reason: "This client's appointment pipeline is not running. Nothing was sent." };
  }
  if (input.kind === "reschedule") {
    const startsAt = (input.startsAt || "").trim();
    if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) {
      return { ok: false, state, reason: "A reschedule needs the new start time. Nothing was sent." };
    }
    const moved: ClientAppointment = { ...appointment, startsAt, response: "rescheduled" };
    const draft = draftAppointmentMessage({
      kind: "reschedule",
      customerName: moved.customerName,
      customerEmail: moved.customerEmail,
      customerPhone: moved.customerPhone,
      clientName: clientLabel(state, tenantId, moved.clientId),
      whenLabel: startsAt,
    });
    moved.lastNote = draft.logLine;
    const steps = stepsOf(state).map((step) => {
      if (step.appointmentId !== moved.id || step.tenantId !== tenantId) return step;
      if (step.stepId === "confirm") return appendCadenceLog(step, now, draft.logLine);
      if (step.status !== "pending") return step;
      const when = reminderInstant(startsAt, step.stepId, now);
      const note = when.held
        ? `Dry run. Rescheduled. Quiet hours. Held until ${when.at}. Nothing was sent. ${OWNER_CALENDAR_LINE}`
        : `Dry run. Rescheduled. Next run moved to ${when.at}. Nothing was sent. ${OWNER_CALENDAR_LINE}`;
      return appendCadenceLog({ ...step, nextRunAt: when.at }, now, note);
    });
    return {
      ok: true,
      state: {
        ...state,
        appointments: appointmentsOf(state).map((row) => row.id === moved.id ? moved : row),
        appointmentSteps: steps,
      },
    };
  }
  if (input.kind === "confirm") {
    const draft = draftAppointmentMessage({
      kind: "confirm",
      customerName: appointment.customerName,
      customerEmail: appointment.customerEmail,
      customerPhone: appointment.customerPhone,
      clientName: clientLabel(state, tenantId, appointment.clientId),
      whenLabel: appointment.startsAt,
    });
    const note = `Dry run. Confirmation noted. ${draft.logLine}`;
    return {
      ok: true,
      state: {
        ...state,
        appointments: appointmentsOf(state).map((row) => row.id === appointment.id ? { ...row, response: "confirmed" as const, lastNote: note } : row),
        appointmentSteps: stepsOf(state).map((step) => step.appointmentId === appointment.id && step.stepId === "confirm" && step.tenantId === tenantId ? appendCadenceLog(step, now, note) : step),
      },
    };
  }
  const outcome = input.kind === "no_show" ? "no_show" as const : "attended" as const;
  const note = outcome === "no_show"
    ? `No-show recorded. The follow-up stays a draft until its step runs. Nothing was sent. ${OWNER_CALENDAR_LINE}`
    : `Attended. No follow-up will be drafted. Nothing was sent. ${OWNER_CALENDAR_LINE}`;
  return {
    ok: true,
    state: {
      ...state,
      appointments: appointmentsOf(state).map((row) => row.id === appointment.id ? { ...row, outcome, lastNote: note } : row),
      appointmentSteps: stepsOf(state).map((step) => step.appointmentId === appointment.id && step.stepId === "no-show" && step.tenantId === tenantId ? appendCadenceLog(step, now, note) : step),
    },
  };
}

export function setAppointmentRemindersKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: AppointmentFlag = {},
): FulfillmentState {
  if (!packagePipelineEnabled(options.enabled)) return state;
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.appointmentRemindersKillSwitch === on) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((row) => row.id === tenantId ? { ...row, appointmentRemindersKillSwitch: on } : row),
    appointmentSteps: on ? stampWorkspaceKill(stepsOf(state), tenantId, now, KILL, () => true) : stepsOf(state),
  };
}
