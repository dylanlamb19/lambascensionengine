import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleAppointmentReply,
  quietHoursShift,
  recordAppointment,
  setAppointmentRemindersKillSwitch,
  tickAppointments,
} from "./appointment-reminders.ts";
import { CADENCE_BACKOFF_MS, CADENCE_MAX_ATTEMPTS, cadenceRetryDelayMs } from "./cadence.ts";
import { stubConnect } from "./connections.ts";
import { FLAGS } from "../flags.ts";
import { sentinelPackageHealth } from "./health.ts";
import { saveClientIntake } from "./lead-generation.ts";
import { getTestPlan } from "./plans.ts";
import { tickPackagePipelines } from "./pipelines.ts";
import {
  REVIEW_EQUAL_ASK,
  REVIEW_JOB_GATE,
  recordCompletedJob,
  recordStoredReview,
  setReviewsKillSwitch,
  tickReviews,
} from "./reviews-gbp.ts";
import { addMonthsIso, recordPurchase, setKillSwitch } from "./runner.ts";
import { replaceTenant, sliceTenant, startMarketerOnboarding } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type AppointmentStep, type FulfillmentState, type ReviewRequestStep } from "./types.ts";
import { usageFor } from "./usage.ts";
import { appointmentViews, formatFulfillmentStepReport, reviewsView } from "./view.ts";

const NOW = "2026-11-15T15:00:00.000Z";
const STARTS = "2026-11-17T15:00:00.000Z";
const root = dirname(fileURLToPath(import.meta.url));

function ids() {
  let n = 0;
  return () => `care-${++n}`;
}

function openTwo(): { state: FulfillmentState; tenantA: string; tenantB: string } {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "Harbor Marketing", now: NOW });
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "Prairie Studio", now: NOW });
  if (!second.ok) throw new Error("b");
  return { state: second.state, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

function buy(state: FulfillmentState, tenantId: string, clientName: string, packageId: "reviews-gbp" | "appointment-reminders", factory = ids()) {
  return recordPurchase(state, tenantId, {
    clientName,
    packageId,
    setupPayment: "recorded",
    monthlyPayment: "recorded",
  }, NOW, factory);
}

function requestStep(state: FulfillmentState, tenantId?: string): ReviewRequestStep | undefined {
  return state.reviewRequestSteps.find((row) => row.stepId === "review-request" && (!tenantId || row.tenantId === tenantId));
}

function appointmentStep(state: FulfillmentState, stepId: AppointmentStep["stepId"], tenantId?: string): AppointmentStep | undefined {
  return state.appointmentSteps.find((row) => row.stepId === stepId && (!tenantId || row.tenantId === tenantId));
}

function connectBooking(state: FulfillmentState, tenantId: string): FulfillmentState {
  const connected = stubConnect(state, tenantId, "booking_calendar", NOW);
  if (!connected.ok) throw new Error(connected.reason);
  return connected.state;
}

test("reviews and appointment ticks are no-ops while the flag is off", () => {
  assert.equal(FLAGS.PACKAGE_FULFILLMENT, false);
  const { state, tenantA } = openTwo();
  const reviews = buy(state, tenantA, "North Roofing", "reviews-gbp");
  if (!reviews.ok) throw new Error(reviews.reason);
  const appointments = buy(reviews.state, tenantA, "Lakeside HVAC", "appointment-reminders");
  if (!appointments.ok) throw new Error(appointments.reason);
  const job = recordCompletedJob(appointments.state, tenantA, {
    enrollmentId: reviews.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
  }, NOW);
  assert.equal(job.ok, false);
  assert.equal(job.state, appointments.state);
  const booked = recordAppointment(appointments.state, tenantA, {
    enrollmentId: appointments.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
  }, NOW);
  assert.equal(booked.ok, false);
  assert.equal(booked.state, appointments.state);
  const ticked = tickReviews(appointments.state, tenantA, NOW);
  assert.equal(ticked.advanced, 0);
  assert.equal(ticked.state, appointments.state);
  const reminders = tickAppointments(appointments.state, tenantA, NOW);
  assert.equal(reminders.state, appointments.state);
  const both = tickPackagePipelines(appointments.state, tenantA, NOW);
  assert.equal(both.state, appointments.state);
  assert.equal(setReviewsKillSwitch(appointments.state, tenantA, true, NOW), appointments.state);
  assert.equal(setAppointmentRemindersKillSwitch(appointments.state, tenantA, true, NOW), appointments.state);
});

test("workspace A cannot see or advance workspace B reviews or appointments", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const reviewsA = buy(state, tenantA, "North Roofing", "reviews-gbp", factory);
  if (!reviewsA.ok) throw new Error(reviewsA.reason);
  const reviewsB = buy(reviewsA.state, tenantB, "Red Barn Roofing", "reviews-gbp", factory);
  if (!reviewsB.ok) throw new Error(reviewsB.reason);
  const jobA = recordCompletedJob(reviewsB.state, tenantA, {
    enrollmentId: reviewsA.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  if (!jobA.ok) throw new Error(jobA.reason);
  const foreignJob = recordCompletedJob(jobA.state, tenantB, {
    enrollmentId: reviewsA.enrollmentId,
    customerName: "Smuggled",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  assert.equal(foreignJob.ok, false);
  const openedA = tickReviews(jobA.state, tenantA, NOW, { enabled: true });
  const beforeB = JSON.stringify(openedA.state.reviewRequestSteps.filter((row) => row.tenantId === tenantB));
  const openedB = tickReviews(openedA.state, tenantB, NOW, { enabled: true });
  assert.equal(JSON.stringify(openedB.state.reviewRequestSteps.filter((row) => row.tenantId === tenantA)), JSON.stringify(openedA.state.reviewRequestSteps.filter((row) => row.tenantId === tenantA)));
  assert.equal(JSON.stringify(openedB.state.reviewRequestSteps.filter((row) => row.tenantId === tenantB)), beforeB);
  assert.equal(reviewsView(openedB.state, tenantB, reviewsA.enrollmentId), null);
  assert.equal(reviewsView(openedB.state, tenantA, reviewsA.enrollmentId)?.jobs[0]?.customerName, "Riley Chen");
  const appointmentsA = buy(openedB.state, tenantA, "Lakeside HVAC", "appointment-reminders", factory);
  if (!appointmentsA.ok) throw new Error(appointmentsA.reason);
  const appointmentsB = buy(connectBooking(appointmentsA.state, tenantA), tenantB, "Main Street Dental", "appointment-reminders", factory);
  if (!appointmentsB.ok) throw new Error(appointmentsB.reason);
  const saved = recordAppointment(appointmentsB.state, tenantA, {
    enrollmentId: appointmentsA.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
    calendar: "booking_calendar",
  }, NOW, { enabled: true, ids: factory });
  if (!saved.ok) throw new Error(saved.reason);
  const other = recordAppointment(saved.state, tenantB, {
    enrollmentId: appointmentsA.enrollmentId,
    customerName: "Hidden",
    startsAt: STARTS,
  }, NOW, { enabled: true });
  assert.equal(other.ok, false);
  assert.equal(appointmentViews(saved.state, tenantB, appointmentsA.enrollmentId), null);
  const sliced = sliceTenant(saved.state, tenantA);
  const poisoned = {
    ...sliced,
    completedJobs: [...sliced.completedJobs, { ...sliced.completedJobs[0], id: "smuggled-job", tenantId: tenantB }],
    appointments: [...sliced.appointments, { ...sliced.appointments[0], id: "smuggled-appt", tenantId: tenantB }],
    reviewRequestSteps: [...sliced.reviewRequestSteps, { ...sliced.reviewRequestSteps[0], id: "smuggled-step", tenantId: tenantB }],
  };
  const replaced = replaceTenant(EMPTY_FULFILLMENT, tenantA, poisoned);
  assert.equal(replaced.completedJobs.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.appointments.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.reviewRequestSteps.every((row) => row.tenantId === tenantA), true);
  assert.equal(replaced.completedJobs.some((row) => row.id === "smuggled-job"), false);
  const report = formatFulfillmentStepReport(saved.state, tenantA);
  assert.match(report, /Riley Chen/);
  assert.doesNotMatch(report, /Red Barn Roofing/);
});

test("a workspace kill switch stops that package only", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const reviewsA = buy(state, tenantA, "North Roofing", "reviews-gbp", factory);
  if (!reviewsA.ok) throw new Error(reviewsA.reason);
  const appointmentsA = buy(reviewsA.state, tenantA, "North Roofing", "appointment-reminders", factory);
  if (!appointmentsA.ok) throw new Error(appointmentsA.reason);
  const reviewsB = buy(appointmentsA.state, tenantB, "Red Barn Roofing", "reviews-gbp", factory);
  if (!reviewsB.ok) throw new Error(reviewsB.reason);
  const job = recordCompletedJob(reviewsB.state, tenantA, {
    enrollmentId: reviewsA.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  if (!job.ok) throw new Error(job.reason);
  const booked = recordAppointment(connectBooking(job.state, tenantA), tenantA, {
    enrollmentId: appointmentsA.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
  }, NOW, { enabled: true, ids: factory });
  if (!booked.ok) throw new Error(booked.reason);
  let current = tickReviews(booked.state, tenantA, NOW, { enabled: true }).state;
  const stopped = setReviewsKillSwitch(current, tenantA, true, NOW, { enabled: true });
  assert.equal(stopped.workspaces.find((row) => row.id === tenantA)?.reviewsKillSwitch, true);
  assert.equal(stopped.workspaces.find((row) => row.id === tenantA)?.appointmentRemindersKillSwitch, false);
  assert.equal(stopped.workspaces.find((row) => row.id === tenantB)?.reviewsKillSwitch, false);
  assert.match(stopped.reviewRequestSteps.find((row) => row.tenantId === tenantA)?.logs.at(-1)?.message || "", /Review requests are stopped/);
  const held = tickReviews(stopped, tenantA, NOW, { enabled: true });
  assert.equal(held.advanced, 0);
  assert.equal(held.state, stopped);
  const reminders = tickAppointments(stopped, tenantA, NOW, { enabled: true });
  assert.ok(reminders.advanced > 0);
  const neighbor = tickReviews(stopped, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(neighbor.state.reviewRequestSteps.find((row) => row.tenantId === tenantA)?.status, stopped.reviewRequestSteps.find((row) => row.tenantId === tenantA)?.status);
  const appointmentStop = setAppointmentRemindersKillSwitch(reminders.state, tenantA, true, NOW, { enabled: true });
  const heldAppointments = tickAppointments(appointmentStop, tenantA, addMonthsIso(NOW, 1), { enabled: true });
  assert.equal(heldAppointments.advanced, 0);
  assert.equal(sentinelPackageHealth(appointmentStop, tenantA, true, NOW).pipelines.find((row) => row.packageId === "appointment-reminders")?.health, "stopped");
});

test("a client kill switch stops that client's review request and leaves the other client moving", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const north = buy(state, tenantA, "North Roofing", "reviews-gbp", factory);
  if (!north.ok) throw new Error(north.reason);
  const south = buy(north.state, tenantA, "South Plumbing", "reviews-gbp", factory);
  if (!south.ok) throw new Error(south.reason);
  let current = south.state;
  for (const item of [
    { enrollmentId: north.enrollmentId, customerName: "Riley Chen" },
    { enrollmentId: south.enrollmentId, customerName: "Jordan Hale" },
  ]) {
    const job = recordCompletedJob(current, tenantA, {
      enrollmentId: item.enrollmentId,
      customerName: item.customerName,
      jobLabel: "Repair",
      completedAt: NOW,
      completed: true,
    }, NOW, { enabled: true, ids: factory });
    if (!job.ok) throw new Error(job.reason);
    current = job.state;
  }
  current = tickReviews(current, tenantA, NOW, { enabled: true }).state;
  assert.equal(current.reviewRequestSteps.every((row) => row.status === "running"), true);
  const killed = setKillSwitch(current, tenantA, north.enrollmentId, true, NOW);
  const next = tickReviews(killed, tenantA, NOW, { enabled: true });
  const northStep = next.state.reviewRequestSteps.find((row) => row.enrollmentId === north.enrollmentId);
  const southStep = next.state.reviewRequestSteps.find((row) => row.enrollmentId === south.enrollmentId);
  assert.equal(northStep?.status, "running");
  assert.equal(southStep?.status, "done");
  assert.match(northStep?.logs.map((row) => row.message).join("\n") || "", /This client's pipeline is stopped/);
});

test("retry exhaustion on reviews and appointments needs a person", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const reviews = buy(state, tenantA, "North Roofing", "reviews-gbp", factory);
  if (!reviews.ok) throw new Error(reviews.reason);
  const appointments = buy(connectBooking(reviews.state, tenantA), tenantA, "North Roofing", "appointment-reminders", factory);
  if (!appointments.ok) throw new Error(appointments.reason);
  const job = recordCompletedJob(appointments.state, tenantA, {
    enrollmentId: reviews.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  if (!job.ok) throw new Error(job.reason);
  const booked = recordAppointment(job.state, tenantA, {
    enrollmentId: appointments.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
  }, NOW, { enabled: true, ids: factory });
  if (!booked.ok) throw new Error(booked.reason);
  const runStep = () => {
    throw new Error("draft timeout");
  };
  let current = booked.state;
  let now = NOW;
  current = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep }).state;
  assert.equal(requestStep(current)?.status, "running");
  current = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep }).state;
  assert.equal(requestStep(current)?.attempts, 1);
  assert.equal(requestStep(current)?.nextRunAt, new Date(new Date(now).getTime() + cadenceRetryDelayMs(1)).toISOString());
  assert.equal(cadenceRetryDelayMs(1), CADENCE_BACKOFF_MS);
  const early = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep });
  assert.equal(early.advanced, 0);
  now = requestStep(current)?.nextRunAt || now;
  current = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep }).state;
  current = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep }).state;
  assert.equal(requestStep(current)?.attempts, 2);
  assert.equal(cadenceRetryDelayMs(2), CADENCE_BACKOFF_MS * 2);
  now = requestStep(current)?.nextRunAt || now;
  current = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep }).state;
  current = tickReviews(current, tenantA, now, { enabled: true, runStep, runCareStep: runStep }).state;
  const failed = requestStep(current);
  assert.equal(failed?.status, "needs_human");
  assert.equal(failed?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.match(failed?.output || "", /Needs a person/);
  assert.match(failed?.output || "", /Nothing was sent/);
  const audit = current.packageRunSteps.find((row) => row.stepId === "profile-audit");
  assert.equal(audit?.status, "needs_human");
  assert.equal(current.packageRunSteps.find((row) => row.stepId === "monthly-report")?.status, "needs_human");
  assert.match(current.packageRunSteps.find((row) => row.stepId === "monthly-report")?.output || "", /earlier step failed/);

  let visitNow = NOW;
  current = tickAppointments(current, tenantA, visitNow, { enabled: true, runStep }).state;
  current = tickAppointments(current, tenantA, visitNow, { enabled: true, runStep }).state;
  visitNow = appointmentStep(current, "confirm")?.nextRunAt || visitNow;
  current = tickAppointments(current, tenantA, visitNow, { enabled: true, runStep }).state;
  current = tickAppointments(current, tenantA, visitNow, { enabled: true, runStep }).state;
  visitNow = appointmentStep(current, "confirm")?.nextRunAt || visitNow;
  current = tickAppointments(current, tenantA, visitNow, { enabled: true, runStep }).state;
  current = tickAppointments(current, tenantA, visitNow, { enabled: true, runStep }).state;
  assert.equal(appointmentStep(current, "confirm")?.status, "needs_human");
  assert.equal(appointmentStep(current, "confirm")?.attempts, CADENCE_MAX_ATTEMPTS);
  assert.equal(appointmentStep(current, "reminder-24h")?.status, "needs_human");
  assert.match(appointmentStep(current, "reminder-24h")?.output || "", /earlier step failed/);
  assert.match(appointmentStep(current, "confirm")?.output || "", /owner sales calendar was not read/);
});

test("plan cap blocks this workspace and records a zero-dollar notice", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const reviewsA = buy(state, tenantA, "North Roofing", "reviews-gbp", factory);
  if (!reviewsA.ok) throw new Error(reviewsA.reason);
  const reviewsB = buy(reviewsA.state, tenantB, "Red Barn Roofing", "reviews-gbp", factory);
  if (!reviewsB.ok) throw new Error(reviewsB.reason);
  const appointmentsA = buy(reviewsB.state, tenantA, "Lakeside HVAC", "appointment-reminders", factory);
  if (!appointmentsA.ok) throw new Error(appointmentsA.reason);
  const job = recordCompletedJob(appointmentsA.state, tenantA, {
    enrollmentId: reviewsA.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  if (!job.ok) throw new Error(job.reason);
  const booked = recordAppointment(connectBooking(job.state, tenantA), tenantA, {
    enrollmentId: appointmentsA.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
  }, NOW, { enabled: true, ids: factory });
  if (!booked.ok) throw new Error(booked.reason);
  const limit = getTestPlan("test_trial").pipelineRunLimit || 0;
  const capped = {
    ...booked.state,
    usage: booked.state.usage.map((row) => row.tenantId === tenantA ? { ...row, pipelineRuns: limit } : row),
  };
  const stopped = tickReviews(capped, tenantA, NOW, { enabled: true });
  assert.equal(stopped.advanced, 0);
  assert.equal(usageFor(stopped.state, tenantA).pipelineRuns, limit);
  assert.equal(requestStep(stopped.state, tenantA)?.status, "pending");
  const notice = stopped.state.billingEvents.find((row) => row.tenantId === tenantA && row.type === "pipeline_limit");
  assert.ok(notice);
  assert.equal(notice?.amountCents, 0);
  assert.equal(notice?.billingMode, "test");
  const reminders = tickAppointments(stopped.state, tenantA, NOW, { enabled: true });
  assert.equal(reminders.advanced, 0);
  assert.equal(appointmentStep(reminders.state, "confirm", tenantA)?.status, "pending");
  const neighbor = tickReviews(reminders.state, tenantB, NOW, { enabled: true });
  assert.ok(neighbor.advanced > 0);
  assert.equal(usageFor(neighbor.state, tenantA).pipelineRuns, limit);
  assert.equal(neighbor.state.billingEvents.some((row) => row.tenantId === tenantB && row.amountCents !== 0), false);
});

test("a review request waits for a real completed job and asks every customer the same way", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const bought = buy(state, tenantA, "North Roofing", "reviews-gbp", factory);
  if (!bought.ok) throw new Error(bought.reason);
  const open = tickReviews(bought.state, tenantA, NOW, { enabled: true });
  assert.equal(open.state.reviewRequestSteps.length, 0);
  assert.equal(open.state.completedJobs.length, 0);
  const incomplete = recordCompletedJob(open.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: false,
  }, NOW, { enabled: true });
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.equal(incomplete.reason, REVIEW_JOB_GATE);
  assert.equal(incomplete.state.completedJobs.length, 0);
  const undated = recordCompletedJob(open.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: "",
    completed: true,
  }, NOW, { enabled: true });
  assert.equal(undated.ok, false);
  const filtered = recordCompletedJob(open.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Riley Chen",
    jobLabel: "Repair",
    completedAt: NOW,
    completed: true,
    minRating: 5,
  }, NOW, { enabled: true });
  assert.equal(filtered.ok, false);
  if (!filtered.ok) assert.match(filtered.reason, /not purchased, gated, or filtered/);
  assert.equal(filtered.state, open.state);
  const rated = recordStoredReview(open.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    reviewerName: "Riley Chen",
    body: "Fine work.",
    rating: 5,
  }, NOW, { enabled: true });
  assert.equal(rated.ok, false);
  const first = recordCompletedJob(open.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Riley Chen",
    customerEmail: "riley@north.example",
    jobLabel: "Repair",
    completedAt: "2026-11-14T15:00:00.000Z",
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  if (!first.ok) throw new Error(first.reason);
  const second = recordCompletedJob(first.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Jordan Hale",
    customerEmail: "jordan@north.example",
    jobLabel: "Repair",
    completedAt: "2026-11-14T16:00:00.000Z",
    completed: true,
  }, NOW, { enabled: true, ids: factory });
  if (!second.ok) throw new Error(second.reason);
  assert.equal(second.state.completedJobs.length, 2);
  let current = second.state;
  for (let i = 0; i < 4; i += 1) current = tickReviews(current, tenantA, NOW, { enabled: true }).state;
  const drafts = current.reviewRequestSteps.map((row) => row.draftedMessage || "");
  assert.equal(drafts.length, 2);
  assert.equal(current.reviewRequestSteps.every((row) => row.status === "done"), true);
  const same = drafts[0].replaceAll("Riley Chen", "NAME");
  assert.equal(drafts[1].replaceAll("Jordan Hale", "NAME"), same);
  assert.match(same, /every customer the same way/i);
  assert.doesNotMatch(same, /star|rating|filter/i);
  assert.match(current.reviewRequestSteps[0]?.output || "", /Dry run/);
  assert.match(current.reviewRequestSteps[0]?.output || "", /Nothing was sent/);
  assert.match(current.reviewRequestSteps[0]?.output || "", new RegExp(REVIEW_EQUAL_ASK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(reviewsView(current, tenantA, bought.enrollmentId)?.jobs.length, 2);
});

test("appointment reminders use only this workspace's booking calendar", () => {
  const { state, tenantA, tenantB } = openTwo();
  const factory = ids();
  const bookedA = buy(state, tenantA, "Lakeside HVAC", "appointment-reminders", factory);
  if (!bookedA.ok) throw new Error(bookedA.reason);
  const bookedB = buy(bookedA.state, tenantB, "Main Street Dental", "appointment-reminders", factory);
  if (!bookedB.ok) throw new Error(bookedB.reason);
  const owner = recordAppointment(bookedB.state, tenantA, {
    enrollmentId: bookedA.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
    calendar: "owner_sales_calendar",
  }, NOW, { enabled: true });
  assert.equal(owner.ok, false);
  if (!owner.ok) assert.match(owner.reason, /owner sales calendar was not read/);
  assert.equal(owner.state.appointments.length, 0);
  const missing = recordAppointment(bookedB.state, tenantA, {
    enrollmentId: bookedA.enrollmentId,
    customerName: "Avery Cole",
    startsAt: STARTS,
  }, NOW, { enabled: true, ids: factory });
  if (!missing.ok) throw new Error(missing.reason);
  const neighbor = stubConnect(missing.state, tenantB, "booking_calendar", NOW);
  if (!neighbor.ok) throw new Error(neighbor.reason);
  let current = tickAppointments(neighbor.state, tenantA, NOW, { enabled: true }).state;
  current = tickAppointments(current, tenantA, NOW, { enabled: true }).state;
  assert.equal(appointmentStep(current, "confirm", tenantA)?.status, "needs_human");
  assert.match(appointmentStep(current, "confirm", tenantA)?.lastError || "", /Missing connection: Booking calendar/);
  assert.match(appointmentStep(current, "confirm", tenantA)?.lastError || "", /owner sales calendar was not read/);
  assert.equal(appointmentStep(current, "reminder-24h", tenantA)?.status, "needs_human");
  assert.equal(current.appointments.find((row) => row.tenantId === tenantA)?.status, "needs_human");
  const connected = connectBooking(current, tenantA);
  const second = recordAppointment(connected, tenantA, {
    enrollmentId: bookedA.enrollmentId,
    customerName: "Drew Patel",
    startsAt: STARTS,
  }, NOW, { enabled: true, ids: factory });
  if (!second.ok) throw new Error(second.reason);
  let live = second.state;
  live = tickAppointments(live, tenantA, NOW, { enabled: true }).state;
  live = tickAppointments(live, tenantA, NOW, { enabled: true }).state;
  const drew = live.appointmentSteps.find((row) => row.clientId === bookedA.clientId && row.stepId === "confirm" && row.appointmentId === second.appointmentId);
  assert.equal(drew?.status, "done");
  assert.match(drew?.output || "", /Dry run/);
  assert.match(drew?.output || "", /Connected \(test\): Booking calendar/);
  assert.match(drew?.output || "", /No calendar API was called/);
  assert.equal(live.appointmentSteps.find((row) => row.appointmentId !== second.appointmentId && row.stepId === "confirm")?.status, "needs_human");
  const src = ["appointment-reminders.ts", "reviews-gbp.ts", "dry-run-sender.ts"].map((name) => readFileSync(join(root, name), "utf8")).join("\n");
  assert.doesNotMatch(src, /from ["'][^"']*\/calendar\//);
  assert.doesNotMatch(src, /from ["'][^"']*mail\//);
  assert.doesNotMatch(src, /googleapis|calendar\.google|canSend|twilio|sk_live|STRIPE_SECRET/i);
});

test("dry-run reminders respect quiet hours, reschedule, and no-show drafts", () => {
  const { state, tenantA } = openTwo();
  const factory = ids();
  const bought = buy(connectBooking(state, tenantA), tenantA, "Lakeside HVAC", "appointment-reminders", factory);
  if (!bought.ok) throw new Error(bought.reason);
  const booked = recordAppointment(bought.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Avery Cole",
    customerPhone: "555-0100",
    startsAt: STARTS,
  }, NOW, { enabled: true, ids: factory });
  if (!booked.ok) throw new Error(booked.reason);
  const twoHours = quietHoursShift("2026-11-17T13:00:00.000Z");
  assert.equal(twoHours.held, true);
  assert.equal(twoHours.at, "2026-11-17T14:00:00.000Z");
  assert.equal(appointmentStep(booked.state, "reminder-24h")?.nextRunAt, "2026-11-16T15:00:00.000Z");
  assert.equal(appointmentStep(booked.state, "reminder-2h")?.nextRunAt, "2026-11-17T14:00:00.000Z");
  assert.match(appointmentStep(booked.state, "reminder-2h")?.logs.map((row) => row.message).join("\n") || "", /Quiet hours/);
  let current = tickAppointments(booked.state, tenantA, NOW, { enabled: true }).state;
  current = tickAppointments(current, tenantA, NOW, { enabled: true }).state;
  assert.equal(appointmentStep(current, "confirm")?.status, "done");
  assert.match(appointmentStep(current, "confirm")?.draftedMessage || "", /Avery Cole/);
  assert.match(appointmentStep(current, "confirm")?.output || "", /Nothing was sent/);
  const moved = handleAppointmentReply(current, tenantA, {
    appointmentId: booked.appointmentId,
    kind: "reschedule",
    startsAt: "2026-11-18T16:00:00.000Z",
  }, NOW, { enabled: true });
  if (!moved.ok) throw new Error(moved.reason);
  assert.equal(moved.state.appointments[0]?.startsAt, "2026-11-18T16:00:00.000Z");
  assert.equal(moved.state.appointments[0]?.response, "rescheduled");
  assert.match(moved.state.appointments[0]?.lastNote || "", /Dry run/);
  assert.match(moved.state.appointments[0]?.lastNote || "", /owner sales calendar was not read/);
  assert.equal(appointmentStep(moved.state, "reminder-24h")?.nextRunAt, "2026-11-17T16:00:00.000Z");
  assert.equal(appointmentStep(moved.state, "reminder-2h")?.nextRunAt, "2026-11-18T14:00:00.000Z");
  const confirmed = handleAppointmentReply(moved.state, tenantA, { appointmentId: booked.appointmentId, kind: "confirm" }, NOW, { enabled: true });
  if (!confirmed.ok) throw new Error(confirmed.reason);
  assert.equal(confirmed.state.appointments[0]?.response, "confirmed");
  assert.match(confirmed.state.appointments[0]?.lastNote || "", /Nothing was sent/);
  const noted = handleAppointmentReply(confirmed.state, tenantA, { appointmentId: booked.appointmentId, kind: "no_show" }, NOW, { enabled: true });
  if (!noted.ok) throw new Error(noted.reason);
  assert.equal(noted.state.appointments[0]?.outcome, "no_show");
  current = noted.state;
  current = tickAppointments(current, tenantA, "2026-11-17T16:00:00.000Z", { enabled: true }).state;
  current = tickAppointments(current, tenantA, "2026-11-17T16:00:00.000Z", { enabled: true }).state;
  const tooEarly = tickAppointments(current, tenantA, "2026-11-18T13:00:00.000Z", { enabled: true });
  assert.equal(tooEarly.advanced, 0);
  assert.equal(appointmentStep(tooEarly.state, "reminder-2h")?.status, "pending");
  current = tickAppointments(tooEarly.state, tenantA, "2026-11-18T14:00:00.000Z", { enabled: true }).state;
  current = tickAppointments(current, tenantA, "2026-11-18T14:00:00.000Z", { enabled: true }).state;
  assert.equal(appointmentStep(current, "reminder-2h")?.status, "done");
  assert.match(appointmentStep(current, "reminder-2h")?.output || "", /Not sent by text/);
  current = tickAppointments(current, tenantA, "2026-11-18T16:00:00.000Z", { enabled: true }).state;
  current = tickAppointments(current, tenantA, "2026-11-18T16:00:00.000Z", { enabled: true }).state;
  assert.equal(appointmentStep(current, "no-show")?.status, "done");
  assert.match(appointmentStep(current, "no-show")?.draftedMessage || "", /We missed you/);
  assert.match(appointmentStep(current, "no-show")?.output || "", /Nothing was sent/);
  const attendedBooking = recordAppointment(current, tenantA, {
    enrollmentId: bought.enrollmentId,
    customerName: "Drew Patel",
    startsAt: "2026-11-12T15:00:00.000Z",
  }, NOW, { enabled: true, ids: factory });
  if (!attendedBooking.ok) throw new Error(attendedBooking.reason);
  const attended = handleAppointmentReply(attendedBooking.state, tenantA, { appointmentId: attendedBooking.appointmentId, kind: "attended" }, NOW, { enabled: true });
  if (!attended.ok) throw new Error(attended.reason);
  let visit = attended.state;
  for (let i = 0; i < 8; i += 1) visit = tickAppointments(visit, tenantA, NOW, { enabled: true }).state;
  const follow = visit.appointmentSteps.find((row) => row.appointmentId === attendedBooking.appointmentId && row.stepId === "no-show");
  assert.equal(follow?.status, "done");
  assert.equal(follow?.draftedMessage, null);
  assert.match(follow?.output || "", /attended/);
  assert.equal(sentinelPackageHealth(visit, tenantA, false, NOW).pipelines[0]?.health, "disabled");
});

test("google business profile drafts use stored data and replies wait for a person", () => {
  const { state, tenantA } = openTwo();
  const bought = buy(state, tenantA, "North Roofing", "reviews-gbp");
  if (!bought.ok) throw new Error(bought.reason);
  const intake = saveClientIntake(bought.state, tenantA, {
    clientId: bought.clientId,
    businessName: "North Roofing",
    phone: "555-0142",
    address: "12 Harbor Ave",
    website: "https://north.example",
    offer: "Roof inspections",
    serviceArea: "Harbor County",
  }, NOW, { enabled: true });
  if (!intake.ok) throw new Error(intake.reason);
  const review = recordStoredReview(intake.state, tenantA, {
    enrollmentId: bought.enrollmentId,
    reviewerName: "Riley Chen",
    body: "The crew kept the yard clean.",
  }, NOW, { enabled: true, ids: ids() });
  if (!review.ok) throw new Error(review.reason);
  let current = review.state;
  for (let i = 0; i < 8; i += 1) current = tickReviews(current, tenantA, NOW, { enabled: true }).state;
  const audit = current.packageRunSteps.find((row) => row.stepId === "profile-audit");
  const posts = current.packageRunSteps.find((row) => row.stepId === "post-draft");
  const replies = current.packageRunSteps.find((row) => row.stepId === "reply-drafts");
  assert.equal(audit?.status, "done");
  assert.match(audit?.draft || "", /stored workspace data only/);
  assert.match(audit?.draft || "", /No Google API was called/);
  assert.equal(posts?.status, "done");
  assert.match(posts?.draft || "", /Post 1/);
  assert.match(posts?.draft || "", /Post 2/);
  assert.match(posts?.draft || "", /monthly cap is 2/);
  assert.match(posts?.draft || "", /None were published/);
  assert.equal(replies?.status, "needs_human");
  assert.match(replies?.draft || "", /Riley Chen/);
  assert.match(replies?.draft || "", /Needs a person to approve/);
  assert.match(replies?.output || "", /Nothing was published/);
  assert.equal(current.packageRunSteps.find((row) => row.stepId === "monthly-report")?.status, "pending");
  assert.equal(current.packageRunSteps.find((row) => row.stepId === "monthly-report")?.nextRunAt, addMonthsIso(NOW, 1));
  const month = addMonthsIso(NOW, 1);
  for (let i = 0; i < 4; i += 1) current = tickReviews(current, tenantA, month, { enabled: true }).state;
  const report = current.packageRunSteps.find((row) => row.stepId === "monthly-report");
  assert.equal(report?.status, "done");
  assert.match(report?.draft || "", /Monthly review report/);
  assert.match(report?.draft || "", /Nothing was emailed/);
  assert.match(report?.draft || "", /not purchased, gated, or filtered/);
  const health = sentinelPackageHealth(current, tenantA, true, month);
  assert.equal(health.pipelines.find((row) => row.packageId === "reviews-gbp")?.health, "degraded");
  const lines = formatFulfillmentStepReport(current, tenantA);
  assert.match(lines, /Review reply drafts/);
  assert.match(lines, /reviews kill switch off/);
});
