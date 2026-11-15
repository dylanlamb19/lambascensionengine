import type { PackageId } from "./catalog.ts";
import type { TestPlanId } from "./plans.ts";

export type EnrollmentStatus = "active" | "paused" | "cancelled";
export type PaymentRecord = "unrecorded" | "recorded" | "waived";
export type StepStatus = "pending" | "running" | "done" | "failed" | "needs_human";
export type DeliverableStatus = "not_started" | "in_progress" | "fulfilled" | "blocked";
export type StepSchedule = "immediate" | "weekly" | "monthly";
export type StepMode = "bookkeeping" | "external";

export type OnboardingStatus = "workspace_ready" | "test_plan_selected";
export type PlanStatus = "test_inactive" | "test_trial" | "test_active";

/** One marketer workspace. `id` is the tenant key. Billing is test-mode only. */
export type Workspace = {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
  onboarding: OnboardingStatus;
  planId: TestPlanId;
  planStatus: PlanStatus;
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

export type FulfillmentState = {
  workspaces: Workspace[];
  clients: ServiceClient[];
  enrollments: Enrollment[];
  steps: StepRun[];
};

export const EMPTY_FULFILLMENT: FulfillmentState = {
  workspaces: [],
  clients: [],
  enrollments: [],
  steps: [],
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
