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

export type WorkspaceMembership = {
  tenantId: string;
  userId: string;
  email: string;
  role: "owner" | "marketer";
  status: "accepted";
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
