import { appendCadenceLog, packagePipelineEnabled, stampWorkspaceKill, tickCadenceSteps, withPipelineCapNotice } from "./cadence.ts";
import { draftReviewRequest } from "./dry-run-sender.ts";
import {
  clientLabel,
  enrollmentFor,
  intakeFor,
  runStepsOf,
  setPackageWorkspaceKill,
  tickPackageRun,
  workspaceLabel,
  type PackageFlag,
  type PackageRunSpec,
} from "./package-runs.ts";
import type { IdFactory } from "./runner.ts";
import { workspaceFor } from "./tenancy.ts";
import type { CompletedJob, FulfillmentState, PackageRunStep, ReviewRequestStep, StoredReview } from "./types.ts";
import { assertPipelineRunAllowed, usageFor, writeUsage } from "./usage.ts";

const QUIET = "Nothing was sent and nothing was published. No Google API was called.";
export const REVIEW_EQUAL_ASK = "Reviews are not purchased, gated, or filtered. Every completed-job customer is asked the same way.";
export const REVIEW_JOB_GATE = "A review request waits for a real recorded completed job. Nothing was sent.";
export const GBP_POST_CAP = 2;

const FILTER_KEYS = ["minRating", "onlyPositive", "skipCustomer", "purchaseReview", "rating", "sentiment", "gate"] as const;

export const REVIEWS_STEPS = [
  { id: "profile-audit", title: "Google Business Profile audit", delayDays: 0, delayMonths: 0 },
  { id: "post-draft", title: "Profile post drafts", delayDays: 0, delayMonths: 0 },
  { id: "reply-drafts", title: "Review reply drafts", delayDays: 0, delayMonths: 0 },
  { id: "monthly-report", title: "Monthly review report", delayDays: 0, delayMonths: 1 },
] as const;

export type ReviewsFlag = PackageFlag;

type IdOpts = ReviewsFlag & { ids?: IdFactory };

function defaultIds(prefix: string): IdFactory {
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => `${prefix}_${stamp}_${++n}`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function jobsOf(state: FulfillmentState): CompletedJob[] {
  return state.completedJobs || [];
}

function requestStepsOf(state: FulfillmentState): ReviewRequestStep[] {
  return state.reviewRequestSteps || [];
}

function reviewsOf(state: FulfillmentState): StoredReview[] {
  return state.storedReviews || [];
}

function onFile(value: string | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed || "not on file";
}

function reviewsEnrollment(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = enrollmentFor(state, tenantId, enrollmentId);
  if (!enrollment) return null;
  if (enrollment.packageId !== "reviews-gbp" && !enrollment.includedPackageIds.includes("reviews-gbp")) return null;
  return enrollment;
}

function openWorkspace(state: FulfillmentState, tenantId: string, enabled: boolean | undefined) {
  if (!packagePipelineEnabled(enabled)) return { ok: false as const, reason: "Package fulfillment is off." };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace || workspace.billingMode !== "test") {
    return { ok: false as const, reason: "Open this marketer's workspace before recording review work." };
  }
  if (workspace.subscriptionStatus === "canceled") {
    return { ok: false as const, reason: "This test subscription is canceled. Nothing was recorded and no charge was attempted." };
  }
  if (workspace.reviewsKillSwitch) {
    return { ok: false as const, reason: `Review requests are stopped for this workspace. ${REVIEW_EQUAL_ASK} ${QUIET}` };
  }
  return { ok: true as const, workspace };
}

function runnableEnrollment(state: FulfillmentState, tenantId: string, enrollmentId: string) {
  const enrollment = reviewsEnrollment(state, tenantId, enrollmentId);
  if (!enrollment) return { ok: false as const, reason: "Record this on an active Review Requests package in this workspace." };
  if (enrollment.status !== "active" || enrollment.killSwitch) {
    return { ok: false as const, reason: "This client's review pipeline is not running. Nothing was sent." };
  }
  return { ok: true as const, enrollment };
}

export type RecordJobInput = {
  enrollmentId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobLabel: string;
  completedAt: string;
  completed: boolean;
  minRating?: unknown;
  onlyPositive?: unknown;
  skipCustomer?: unknown;
  purchaseReview?: unknown;
  rating?: unknown;
  sentiment?: unknown;
  gate?: unknown;
};

export type RecordJobResult =
  | { ok: true; state: FulfillmentState; jobId: string; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

/**
 * Record a finished job and open one review request.
 * A job that is not completed does not open a request.
 * Filter and purchase fields are refused. Every recorded job is asked the same way.
 */
export function recordCompletedJob(
  state: FulfillmentState,
  tenantId: string,
  input: RecordJobInput,
  now: string,
  options: IdOpts = {},
): RecordJobResult {
  const opened = openWorkspace(state, tenantId, options.enabled);
  if (!opened.ok) return { ok: false, state, reason: opened.reason };
  if (FILTER_KEYS.some((key) => input[key] !== undefined)) {
    return { ok: false, state, reason: `${REVIEW_EQUAL_ASK} A rating or filter was not stored. Nothing was sent.` };
  }
  if (input.completed !== true) return { ok: false, state, reason: REVIEW_JOB_GATE };
  const completedAt = (input.completedAt || "").trim();
  if (!completedAt || Number.isNaN(new Date(completedAt).getTime())) return { ok: false, state, reason: REVIEW_JOB_GATE };
  const customerName = input.customerName.trim().replace(/\s+/g, " ");
  const jobLabel = input.jobLabel.trim().replace(/\s+/g, " ");
  if (!customerName || !jobLabel) return { ok: false, state, reason: "The completed job needs the customer and a job name." };
  const ready = runnableEnrollment(state, tenantId, input.enrollmentId);
  if (!ready.ok) return { ok: false, state, reason: ready.reason };
  const existing = jobsOf(state).find((row) =>
    row.tenantId === tenantId
    && row.enrollmentId === ready.enrollment.id
    && normalize(row.customerName) === normalize(customerName)
    && normalize(row.jobLabel) === normalize(jobLabel)
    && row.completedAt === completedAt
    && row.status === "completed",
  );
  if (existing) return { ok: true, state, jobId: existing.id, created: false };
  const ids = options.ids || defaultIds("job");
  const job: CompletedJob = {
    id: ids(),
    tenantId,
    clientId: ready.enrollment.clientId,
    enrollmentId: ready.enrollment.id,
    customerName,
    customerEmail: (input.customerEmail || "").trim(),
    customerPhone: (input.customerPhone || "").trim(),
    jobLabel,
    completedAt,
    recordedAt: now,
    status: "completed",
  };
  const step: ReviewRequestStep = {
    id: `${tenantId}:review:${job.id}:review-request`,
    tenantId,
    jobId: job.id,
    enrollmentId: ready.enrollment.id,
    clientId: ready.enrollment.clientId,
    stepId: "review-request",
    title: "Review request",
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    nextRunAt: now,
    output: "",
    draftedMessage: null,
    logs: [{ at: now, message: `Scheduled after the completed job. ${REVIEW_EQUAL_ASK} Nothing was sent.` }],
  };
  return {
    ok: true,
    jobId: job.id,
    created: true,
    state: {
      ...state,
      completedJobs: [...jobsOf(state), job],
      reviewRequestSteps: [...requestStepsOf(state), step],
    },
  };
}

export type RecordReviewInput = {
  enrollmentId: string;
  reviewerName: string;
  body: string;
  rating?: unknown;
  minRating?: unknown;
};

export type RecordReviewResult =
  | { ok: true; state: FulfillmentState; reviewId: string; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

/** Store a review the marketer already has. It is not read from Google and it does not decide who is asked. */
export function recordStoredReview(
  state: FulfillmentState,
  tenantId: string,
  input: RecordReviewInput,
  now: string,
  options: IdOpts = {},
): RecordReviewResult {
  const opened = openWorkspace(state, tenantId, options.enabled);
  if (!opened.ok) return { ok: false, state, reason: opened.reason };
  if (input.rating !== undefined || input.minRating !== undefined) {
    return { ok: false, state, reason: `${REVIEW_EQUAL_ASK} A star rating is not stored.` };
  }
  const reviewerName = input.reviewerName.trim().replace(/\s+/g, " ");
  const body = input.body.trim().replace(/\s+/g, " ");
  if (!reviewerName || !body) return { ok: false, state, reason: "A stored review needs a name and the review text." };
  const ready = runnableEnrollment(state, tenantId, input.enrollmentId);
  if (!ready.ok) return { ok: false, state, reason: ready.reason };
  const existing = reviewsOf(state).find((row) =>
    row.tenantId === tenantId
    && row.enrollmentId === ready.enrollment.id
    && normalize(row.reviewerName) === normalize(reviewerName)
    && normalize(row.body) === normalize(body),
  );
  if (existing) return { ok: true, state, reviewId: existing.id, created: false };
  const ids = options.ids || defaultIds("review");
  const review: StoredReview = {
    id: ids(),
    tenantId,
    clientId: ready.enrollment.clientId,
    enrollmentId: ready.enrollment.id,
    reviewerName,
    body,
    recordedAt: now,
  };
  const withReview: FulfillmentState = { ...state, storedReviews: [...reviewsOf(state), review] };
  return { ok: true, reviewId: review.id, created: true, state: reopenReplyDrafts(withReview, tenantId, ready.enrollment.clientId, now) };
}

function reopenReplyDrafts(state: FulfillmentState, tenantId: string, clientId: string, now: string): FulfillmentState {
  let changed = false;
  const steps = runStepsOf(state).map((step) => {
    if (step.tenantId !== tenantId || step.clientId !== clientId || step.packageId !== "reviews-gbp" || step.stepId !== "reply-drafts") return step;
    if (step.status !== "done" && step.status !== "needs_human") return step;
    if ((step.lastError || "").includes("Failed after retries")) return step;
    changed = true;
    return appendCadenceLog(
      { ...step, status: "pending" as const, finishedAt: null, nextRunAt: now, output: "", draft: null, lastError: null },
      now,
      "A stored review was added. The reply draft will run again. Nothing was published. No Google API was called.",
    );
  });
  return changed ? { ...state, packageRunSteps: steps } : state;
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
  const gap = missing.length ? `Missing on file: ${missing.join(", ")}.` : "Name, address, phone, and site are on file.";
  return `Google Business Profile audit for ${profile.client}. ${gap} Checked stored workspace data only. No Google API was called. Nothing was published.`;
}

function gbpOutcome(state: FulfillmentState, step: PackageRunStep) {
  const profile = storedProfile(state, step);
  if (step.stepId === "profile-audit") {
    const draft = auditText(profile);
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: "Profile audit used stored name, address, phone, and site. No Google API was called." },
      patch: { draft },
    };
  }
  if (step.stepId === "post-draft") {
    const offer = onFile(profile.offer);
    const area = onFile(profile.serviceArea);
    const posts = [
      `Post 1: ${profile.client} — ${offer}. Service area: ${area}.`,
      `Post 2: ${profile.businessName || profile.client} is taking ${offer}.`,
    ].slice(0, GBP_POST_CAP);
    const draft = `${posts.join(" ")} Drafted ${posts.length} profile posts. The monthly cap is ${GBP_POST_CAP}. None were published. No Google API was called.`;
    return {
      outcome: { status: "done" as const, output: draft, lastError: null, log: `Drafted ${GBP_POST_CAP} profile posts from stored intake. None were published. No Google API was called.` },
      patch: { draft },
    };
  }
  if (step.stepId === "reply-drafts") {
    const reviews = reviewsOf(state).filter((row) => row.tenantId === step.tenantId && row.clientId === step.clientId);
    if (reviews.length === 0) {
      const draft = "No stored reviews to answer. Nothing was published. No Google API was called.";
      return {
        outcome: { status: "done" as const, output: draft, lastError: null, log: draft },
        patch: { draft },
      };
    }
    const drafts = reviews.map((row) => `Reply draft for ${row.reviewerName}: Thank you for the note about "${row.body}" A person still has to approve this before it is posted.`);
    const draft = `${drafts.join(" ")} Needs a person to approve each reply. Nothing was published. No Google API was called. ${REVIEW_EQUAL_ASK}`;
    return {
      outcome: {
        status: "needs_human" as const,
        output: draft,
        lastError: "Needs a person to approve each reply. Nothing was published.",
        log: "Reply drafts were written from stored reviews. Needs a person to approve them. No Google API was called.",
      },
      patch: { draft },
    };
  }
  const jobs = jobsOf(state).filter((row) => row.tenantId === step.tenantId && row.clientId === step.clientId && row.status === "completed");
  const requests = requestStepsOf(state).filter((row) => row.tenantId === step.tenantId && row.clientId === step.clientId);
  const reviews = reviewsOf(state).filter((row) => row.tenantId === step.tenantId && row.clientId === step.clientId);
  const draft = [
    `Monthly review report for ${profile.client} in ${workspaceLabel(state, step.tenantId)}.`,
    `Completed jobs: ${jobs.length}. Review requests drafted: ${requests.filter((row) => row.draftedMessage).length}.`,
    `Stored reviews: ${reviews.length}.`,
    auditText(profile),
    `Profile post drafts are capped at ${GBP_POST_CAP} and were not published.`,
    "Reply drafts stay with a person until they are approved.",
    `${REVIEW_EQUAL_ASK} Nothing was emailed. No Google API was called.`,
  ].join(" ");
  return {
    outcome: { status: "done" as const, output: draft, lastError: null, log: "Monthly review report drafted from stored jobs and reviews. Nothing was emailed. No Google API was called." },
    patch: { draft },
  };
}

const SPEC: PackageRunSpec = {
  packageId: "reviews-gbp",
  steps: REVIEWS_STEPS,
  killField: "reviewsKillSwitch",
  quietLine: QUIET,
  stopReason: `Stopped because an earlier step failed. Needs a person. ${QUIET}`,
  killMessage: `Workspace kill switch is on. Review requests are stopped. ${REVIEW_EQUAL_ASK} ${QUIET} Sales outreach was not changed.`,
  noticePrefix: "reviews_run",
  outcome: gbpOutcome,
};

function requestOutcome(state: FulfillmentState, step: ReviewRequestStep) {
  const job = jobsOf(state).find((row) => row.id === step.jobId && row.tenantId === step.tenantId);
  if (!job || job.status !== "completed") {
    return {
      outcome: { status: "needs_human" as const, output: REVIEW_JOB_GATE, lastError: REVIEW_JOB_GATE, log: REVIEW_JOB_GATE },
      patch: { draftedMessage: null },
    };
  }
  const draft = draftReviewRequest({
    customerName: job.customerName,
    customerEmail: job.customerEmail,
    customerPhone: job.customerPhone,
    clientName: clientLabel(state, step.tenantId, step.clientId),
    jobLabel: job.jobLabel,
  });
  return {
    outcome: { status: "done" as const, output: draft.logLine, lastError: null, log: draft.logLine },
    patch: { draftedMessage: draft.body },
  };
}

function tickReviewRequests(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: ReviewsFlag & { runStep?: (step: ReviewRequestStep) => void } = {},
): { state: FulfillmentState; advanced: number } {
  if (!packagePipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { state, advanced: 0 };
  const tick = tickCadenceSteps({
    state,
    tenantId,
    now,
    steps: requestStepsOf(state),
    order: ["review-request"],
    groupId: (step) => step.jobId,
    inGroup: (row, step) => row.jobId === step.jobId,
    prepare: (step) => {
      const job = jobsOf(state).find((row) => row.id === step.jobId && row.tenantId === tenantId);
      const enrollment = job ? enrollmentFor(state, tenantId, job.enrollmentId) : null;
      if (!job || !enrollment) return { skip: true };
      return {
        skip: false,
        runnable: !workspace.reviewsKillSwitch && !enrollment.killSwitch && enrollment.status === "active",
      };
    },
    execute: (step) => {
      opts.runStep?.(step);
      return requestOutcome(state, step);
    },
    quietLine: QUIET,
    stopReason: `Stopped because an earlier step failed. Needs a person. ${QUIET}`,
    runs: usageFor(state, tenantId).pipelineRuns,
    allow: (runs) => assertPipelineRunAllowed(state, tenantId, runs),
  });
  if (tick.unchanged) return { state, advanced: 0 };
  const next = withPipelineCapNotice(
    writeUsage({ ...state, reviewRequestSteps: tick.steps }, { ...usageFor(state, tenantId), pipelineRuns: tick.runs }),
    tenantId,
    now,
    tick.blocked,
    `review_request_${now}`,
  );
  return { state: next, advanced: tick.advanced };
}

export function tickReviews(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: ReviewsFlag & { ids?: IdFactory; runStep?: (step: ReviewRequestStep) => void; runCareStep?: (step: PackageRunStep) => void } = {},
): { state: FulfillmentState; advanced: number } {
  const care = tickPackageRun(state, tenantId, now, SPEC, { enabled: opts.enabled, ids: opts.ids, runStep: opts.runCareStep });
  const requests = tickReviewRequests(care.state, tenantId, now, opts);
  return { state: requests.state, advanced: care.advanced + requests.advanced };
}

export function setReviewsKillSwitch(
  state: FulfillmentState,
  tenantId: string,
  on: boolean,
  now: string,
  options: ReviewsFlag = {},
): FulfillmentState {
  const next = setPackageWorkspaceKill(state, tenantId, on, now, SPEC, options);
  if (next === state || !on) return next;
  return {
    ...next,
    reviewRequestSteps: stampWorkspaceKill(requestStepsOf(next), tenantId, now, SPEC.killMessage, () => true),
  };
}
