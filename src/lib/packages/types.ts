import type { PackageId } from "./catalog.ts";
import type { TestPlanId } from "./plans.ts";

export type EnrollmentStatus = "active" | "paused" | "cancelled";
export type PaymentRecord = "unrecorded" | "recorded" | "waived";
export type StepStatus = "pending" | "running" | "done" | "failed" | "needs_human";
export type DeliverableStatus = "not_started" | "in_progress" | "fulfilled" | "blocked";
export type StepSchedule = "immediate" | "weekly" | "monthly";
export type StepMode = "bookkeeping" | "external";

export type OnboardingStep = "workspace" | "plan" | "client" | "packages" | "connections" | "desk";
export type PlanStatus = "test_inactive" | "test_trial" | "test_active";
export type SubscriptionLifecycle = "trial" | "active" | "past_due" | "canceled";

/** One marketer workspace. `id` is the tenant key. Billing is test-mode only. */
export type Workspace = {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
  onboarding: OnboardingStep;
  planId: TestPlanId;
  planStatus: PlanStatus;
  subscriptionStatus: SubscriptionLifecycle;
  billingMode: "test";
  /** Stops every Lead Follow-Up lead in this workspace. Other workspaces are untouched. */
  leadFollowUpKillSwitch: boolean;
  /** Stops every Lead Generation run in this workspace. Other workspaces are untouched. */
  leadGenerationKillSwitch: boolean;
  /** Stops every AI Visibility run in this workspace. Other workspaces are untouched. */
  aiVisibilityKillSwitch: boolean;
  /** Stops every review request and Google Business Profile draft in this workspace. */
  reviewsKillSwitch: boolean;
  /** Stops every appointment reminder in this workspace. Other workspaces are untouched. */
  appointmentRemindersKillSwitch: boolean;
  /** Stops every estimate follow-up in this workspace. Other workspaces are untouched. */
  estimateFollowUpsKillSwitch: boolean;
  /** Stops every Google Ads draft in this workspace. Other workspaces are untouched. */
  googleAdsKillSwitch: boolean;
  /** Stops every Meta Ads draft in this workspace. Other workspaces are untouched. */
  metaAdsKillSwitch: boolean;
  /** Stops every Office Automation draft in this workspace. Other workspaces are untouched. */
  officeAutomationKillSwitch: boolean;
  /** Public https URL, or empty when a logo was stored for this workspace only. */
  logoUrl?: string;
  brandPrimary?: string;
  brandAccent?: string;
  senderDisplayName?: string;
  timezone?: string;
  /** Set while the owner has closed this workspace. Rows stay in place. */
  closedAt?: string | null;
  restoreUntil?: string | null;
};

export type ScaffoldPlanId = "starter" | "pro" | "agency";
export type ScaffoldStatus = "trialing" | "active" | "past_due" | "canceled";

/** Test-mode subscription recorded by the billing scaffold. Amounts stay at zero. */
export type ScaffoldSubscription = {
  tenantId: string;
  planId: ScaffoldPlanId;
  status: ScaffoldStatus;
  customerId: string;
  subscriptionId: string;
  graceUntil: string | null;
  billingMode: "test";
  updatedAt: string;
};

export type WebhookReceipt = {
  id: string;
  tenantId: string;
  type: string;
  at: string;
};

export type CheckoutSessionRecord = {
  id: string;
  tenantId: string;
  planId: ScaffoldPlanId;
  amountCents: 0;
  billingMode: "test";
  status: "open" | "complete";
  createdAt: string;
};

export type PortalSessionRecord = {
  id: string;
  tenantId: string;
  url: string;
  billingMode: "test";
  createdAt: string;
};

export type SeatInvite = {
  id: string;
  tenantId: string;
  email: string;
  role: "admin" | "member";
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  invitedByUserId: string;
  createdAt: string;
};

export type ClosureSnapshot = {
  id: string;
  tenantId: string;
  closedAt: string;
  restoreUntil: string;
  restoredAt: string | null;
  kills: {
    leadFollowUpKillSwitch: boolean;
    leadGenerationKillSwitch: boolean;
    aiVisibilityKillSwitch: boolean;
    reviewsKillSwitch: boolean;
    appointmentRemindersKillSwitch: boolean;
    estimateFollowUpsKillSwitch: boolean;
    googleAdsKillSwitch: boolean;
    metaAdsKillSwitch: boolean;
    officeAutomationKillSwitch: boolean;
  };
  enrollmentKills: { id: string; killSwitch: boolean }[];
};

export type ServiceClient = {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
};

export type Enrollment = {
  id: string;
  tenantId: string;
  clientId: string;
  packageId: PackageId;
  status: EnrollmentStatus;
  killSwitch: boolean;
  setupFeeCents: number;
  monthlyCents: number;
  pricingKind: "fixed" | "from";
  setupPayment: PaymentRecord;
  monthlyPayment: PaymentRecord;
  startedOn: string;
  renewsOn: string;
  includedPackageIds: PackageId[];
  /** Set when a bundle kill switch stopped this enrollment. Null when the kill belongs to this package. */
  cascadeFromEnrollmentId: string | null;
  createdAt: string;
};

export type StepRun = {
  id: string;
  tenantId: string;
  enrollmentId: string;
  clientId: string;
  packageId: PackageId;
  sourcePackageId: PackageId;
  stepId: string;
  title: string;
  group: string;
  schedule: StepSchedule;
  mode: StepMode;
  integration: string | null;
  doneOutput: string;
  missingOutput: string;
  unwiredOutput: string;
  status: StepStatus;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  logs: { at: string; message: string }[];
};

export type ConnectionKind =
  | "mailbox"
  | "google_ads"
  | "meta"
  | "gbp"
  | "cms"
  | "booking_calendar"
  | "job_feed"
  | "estimate_feed"
  | "tracking";

export type ConnectionStatus = "missing" | "stub_connected";

/** A workspace connection. Status only. No tokens, keys, or secrets. */
export type WorkspaceConnection = {
  tenantId: string;
  kind: ConnectionKind;
  label: string;
  status: ConnectionStatus;
  connectedAt: string | null;
};

/** A test-mode billing notice. amountCents is always 0. */
export type BillingEvent = {
  id: string;
  tenantId: string;
  type: string;
  planId: string | null;
  amountCents: 0;
  billingMode: "test";
  at: string;
};

export type TestInvoice = {
  id: string;
  tenantId: string;
  status: "open" | "paid" | "void";
  amountCents: 0;
  billingMode: "test";
  createdAt: string;
};

export type MarketerInvite = {
  id: string;
  tenantId: string;
  email: string;
  status: "pending" | "accepted" | "revoked";
  invitedByUserId: string;
  createdAt: string;
};

export type TenantUsage = {
  tenantId: string;
  pipelineRuns: number;
  enrollments: number;
};

export type WorkspaceMembership = {
  tenantId: string;
  userId: string;
  email: string;
  role: "owner" | "admin" | "member" | "marketer";
  status: "accepted";
};

export type LeadStatus = "active" | "needs_human" | "stopped";

export type LeadStepId = "captured" | "speed-to-lead" | "day-1" | "day-3" | "day-7";

/** One inquiry inside a workspace's Lead Follow-Up enrollment. Not a sales prospect. */
export type FollowUpLead = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  source: string;
  status: LeadStatus;
  capturedAt: string;
  repliedAt: string | null;
};

/** One cadence step for a captured lead. Drafts stay on the step. Nothing is sent. */
export type LeadStepRun = {
  id: string;
  tenantId: string;
  leadId: string;
  enrollmentId: string;
  clientId: string;
  stepId: LeadStepId;
  title: string;
  sends: boolean;
  status: StepStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  draftedMessage: string | null;
  logs: { at: string; message: string }[];
};

/** Stored intake for one client. Campaign briefs and profile audits read only this. */
export type ClientIntake = {
  tenantId: string;
  clientId: string;
  businessName: string;
  phone: string;
  address: string;
  website: string;
  offer: string;
  serviceArea: string;
  updatedAt: string;
};

export type PackageRunId = "lead-generation" | "ai-visibility" | "reviews-gbp" | "google-ads" | "meta-ads" | "office-automation";
export type PackageRunStatus = "active" | "needs_human" | "stopped";

/** One Lead Generation or AI Visibility run on a client's package. */
export type PackageRun = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  packageId: PackageRunId;
  status: PackageRunStatus;
  openedAt: string;
};

export type PackageRunStep = {
  id: string;
  tenantId: string;
  runId: string;
  enrollmentId: string;
  clientId: string;
  packageId: PackageRunId;
  stepId: string;
  title: string;
  status: StepStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  draft: string | null;
  logs: { at: string; message: string }[];
};

/** A lead captured by Lead Generation. Not a sales prospect. */
export type GeneratedLead = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  source: string;
  capturedAt: string;
  followUpLeadId: string | null;
  handoffNote: string;
};

/**
 * A job that actually finished for one client.
 * Review requests are created only from rows whose status is completed.
 * There is no star rating and no filter.
 */
export type CompletedJob = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  jobLabel: string;
  completedAt: string;
  recordedAt: string;
  status: "completed";
};

/** One dry-run review request tied to one completed job. Nothing is sent. */
export type ReviewRequestStep = {
  id: string;
  tenantId: string;
  jobId: string;
  enrollmentId: string;
  clientId: string;
  stepId: "review-request";
  title: string;
  status: StepStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  draftedMessage: string | null;
  logs: { at: string; message: string }[];
};

/** A review the marketer already has on file. Not read from Google. No star rating. */
export type StoredReview = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  reviewerName: string;
  body: string;
  recordedAt: string;
};

export type AppointmentStepId = "confirm" | "reminder-24h" | "reminder-2h" | "no-show";
export type AppointmentResponse = "none" | "confirmed" | "rescheduled";
export type AppointmentOutcome = "unset" | "attended" | "no_show";

/**
 * One booking on the client's own booking calendar.
 * calendar is always the workspace booking-calendar connection.
 */
export type ClientAppointment = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  startsAt: string;
  calendar: "booking_calendar";
  status: PackageRunStatus;
  response: AppointmentResponse;
  outcome: AppointmentOutcome;
  lastNote: string;
  recordedAt: string;
};

export type EstimateStepId = "day-2" | "day-5" | "day-10" | "close-out";
export type EstimateOutcome = "open" | "won" | "lost" | "replied" | "ambiguous";

/**
 * One open estimate for a client's customer.
 * Follow-up drafts are written only while outcome is open.
 */
export type OpenEstimate = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  label: string;
  openedAt: string;
  recordedAt: string;
  outcome: EstimateOutcome;
  status: PackageRunStatus;
  lastNote: string;
};

/** Day 2, day 5, day 10, and close-out drafts. Nothing is sent. */
export type EstimateStep = {
  id: string;
  tenantId: string;
  estimateId: string;
  enrollmentId: string;
  clientId: string;
  stepId: EstimateStepId;
  title: string;
  status: StepStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  draftedMessage: string | null;
  logs: { at: string; message: string }[];
};

/**
 * Figures a person stored for this workspace.
 * They are not read from Google Ads, and they are not a charge.
 */
export type AdsMetricSnapshot = {
  id: string;
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  periodLabel: string;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  spendCents: number | null;
  recordedAt: string;
  source: "stored";
};

/** A change that stays with a person until they approve it. Nothing is pushed. */
export type AdsChangeNote = {
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  summary: string;
  ambiguous: boolean;
  status: "open" | "approved";
  updatedAt: string;
};

/**
 * A proposed Meta budget for one enrollment.
 * It is checked against the test plan cap. It is not spent and it is not a charge.
 */
export type MetaBudgetNote = {
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  proposedCents: number | null;
  ambiguous: boolean;
  status: "open" | "approved";
  updatedAt: string;
};

export type OfficeWorkflowKind = "document-collection" | "sold-job-handoff" | "invoice-reminders";

/** The one office workflow a person agreed for this client. Dry-run only. */
export type OfficeWorkflow = {
  tenantId: string;
  clientId: string;
  enrollmentId: string;
  kind: OfficeWorkflowKind | "";
  ambiguous: boolean;
  scheduleNote: string;
  updatedAt: string;
};

/** Confirm, 24h, 2h, and no-show drafts. Nothing is sent. */
export type AppointmentStep = {
  id: string;
  tenantId: string;
  appointmentId: string;
  enrollmentId: string;
  clientId: string;
  stepId: AppointmentStepId;
  title: string;
  status: StepStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  output: string;
  draftedMessage: string | null;
  logs: { at: string; message: string }[];
};

export type FulfillmentState = {
  workspaces: Workspace[];
  clients: ServiceClient[];
  enrollments: Enrollment[];
  steps: StepRun[];
  connections: WorkspaceConnection[];
  billingEvents: BillingEvent[];
  invoices: TestInvoice[];
  invites: MarketerInvite[];
  memberships: WorkspaceMembership[];
  usage: TenantUsage[];
  leads: FollowUpLead[];
  leadSteps: LeadStepRun[];
  intakes: ClientIntake[];
  packageRuns: PackageRun[];
  packageRunSteps: PackageRunStep[];
  generatedLeads: GeneratedLead[];
  completedJobs: CompletedJob[];
  reviewRequestSteps: ReviewRequestStep[];
  storedReviews: StoredReview[];
  appointments: ClientAppointment[];
  appointmentSteps: AppointmentStep[];
  estimates: OpenEstimate[];
  estimateSteps: EstimateStep[];
  adsMetrics: AdsMetricSnapshot[];
  adsChangeNotes: AdsChangeNote[];
  metaBudgetNotes: MetaBudgetNote[];
  officeWorkflows: OfficeWorkflow[];
  scaffoldSubscriptions: ScaffoldSubscription[];
  webhookReceipts: WebhookReceipt[];
  checkoutSessions: CheckoutSessionRecord[];
  portalSessions: PortalSessionRecord[];
  seatInvites: SeatInvite[];
  closures: ClosureSnapshot[];
};

export const EMPTY_FULFILLMENT: FulfillmentState = {
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
  metaBudgetNotes: [],
  officeWorkflows: [],
  scaffoldSubscriptions: [],
  webhookReceipts: [],
  checkoutSessions: [],
  portalSessions: [],
  seatInvites: [],
  closures: [],
};

export type RecordPurchaseInput = {
  clientName: string;
  packageId: PackageId;
  setupPayment: PaymentRecord;
  monthlyPayment: PaymentRecord;
  startedOn?: string;
};

export type StepOutcome = {
  status: "done" | "needs_human" | "failed";
  output: string;
};

export type CredentialPort = {
  has(integration: string): boolean;
};

export const NO_CREDENTIALS: CredentialPort = {
  has: () => false,
};
