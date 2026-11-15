import { getTestPlan, isTestPlanId, type TestPlanId } from "./plans.ts";
import type { FulfillmentState, OnboardingStep, Workspace } from "./types.ts";

const STEPS: readonly OnboardingStep[] = ["workspace", "plan", "client", "packages", "connections", "desk"];

export function onboardingStep(workspace: Workspace): OnboardingStep {
  const value = workspace.onboarding as string;
  if (value === "workspace_ready") return "plan";
  if (value === "test_plan_selected") return "client";
  if ((STEPS as readonly string[]).includes(value)) return value as OnboardingStep;
  return "workspace";
}

/** Stable tenant id for a verified marketer user id. Not a secret. */
export function workspaceIdForUser(userId: string): string | null {
  const clean = (userId || "").trim();
  if (!clean) return null;
  return `ws_${clean.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function workspaceFor(state: FulfillmentState, tenantId: string): Workspace | null {
  return state.workspaces.find((row) => row.id === tenantId) || null;
}

/** Rows for one marketer. Other workspaces are dropped. */
export function sliceTenant(state: FulfillmentState, tenantId: string): FulfillmentState {
  return {
    workspaces: (state.workspaces || []).filter((row) => row.id === tenantId).map((row) => ({ ...row, onboarding: onboardingStep(row) })),
    clients: (state.clients || []).filter((row) => row.tenantId === tenantId),
    enrollments: (state.enrollments || []).filter((row) => row.tenantId === tenantId),
    steps: (state.steps || []).filter((row) => row.tenantId === tenantId),
    connections: (state.connections || []).filter((row) => row.tenantId === tenantId),
    billingEvents: (state.billingEvents || []).filter((row) => row.tenantId === tenantId),
  };
}

/**
 * Replace one tenant's rows. A slice that claims another tenant is ignored,
 * so a caller cannot write a neighbor's clients into this workspace.
 */
export function replaceTenant(state: FulfillmentState, tenantId: string, slice: FulfillmentState): FulfillmentState {
  const safe = sliceTenant(slice, tenantId);
  return {
    workspaces: [...(state.workspaces || []).filter((row) => row.id !== tenantId), ...safe.workspaces],
    clients: [...(state.clients || []).filter((row) => row.tenantId !== tenantId), ...safe.clients],
    enrollments: [...(state.enrollments || []).filter((row) => row.tenantId !== tenantId), ...safe.enrollments],
    steps: [...(state.steps || []).filter((row) => row.tenantId !== tenantId), ...safe.steps],
    connections: [...(state.connections || []).filter((row) => row.tenantId !== tenantId), ...safe.connections],
    billingEvents: [...(state.billingEvents || []).filter((row) => row.tenantId !== tenantId), ...safe.billingEvents],
  };
}

export type OnboardingInput = {
  /** Verified session user id. Never a tenant id typed into a form. */
  userId: string;
  workspaceName: string;
  now: string;
};

export type OnboardingResult =
  | { ok: true; state: FulfillmentState; workspace: Workspace; created: boolean }
  | { ok: false; state: FulfillmentState; reason: string };

/**
 * Self-serve onboarding hook. Idempotent per marketer user id.
 * Public signup stays disabled; a future account flow calls this only after
 * the session user id is verified. This does not create a login and does not charge.
 */
export function startMarketerOnboarding(state: FulfillmentState, input: OnboardingInput): OnboardingResult {
  const tenantId = workspaceIdForUser(input.userId);
  if (!tenantId) return { ok: false, state, reason: "A signed-in marketer is required before a workspace can open." };
  const existing = workspaceFor(state, tenantId);
  if (existing) {
    if (existing.ownerUserId !== input.userId.trim()) {
      return { ok: false, state, reason: "That workspace belongs to a different marketer." };
    }
    return { ok: true, state, workspace: existing, created: false };
  }
  const name = input.workspaceName.trim() || "My workspace";
  const workspace: Workspace = {
    id: tenantId,
    ownerUserId: input.userId.trim(),
    name,
    createdAt: input.now,
    onboarding: "workspace",
    planId: "test_trial",
    planStatus: "test_inactive",
    billingMode: "test",
  };
  return {
    ok: true,
    created: true,
    workspace,
    state: { ...state, workspaces: [...state.workspaces, workspace] },
  };
}

export function selectTestPlan(
  state: FulfillmentState,
  tenantId: string,
  planId: string,
  now: string,
): OnboardingResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, state, reason: "Open a workspace before choosing a test plan." };
  if (!isTestPlanId(planId)) return { ok: false, state, reason: "That plan is not in the test catalog." };
  const plan = getTestPlan(planId);
  if (plan.billingMode !== "test") return { ok: false, state, reason: "Only test-mode plans can be recorded." };
  const step = onboardingStep(workspace);
  const next: Workspace = {
    ...workspace,
    planId: planId as TestPlanId,
    planStatus: "test_trial",
    onboarding: step === "workspace" || step === "plan" ? "client" : step,
    billingMode: "test",
    createdAt: workspace.createdAt || now,
  };
  return {
    ok: true,
    created: false,
    workspace: next,
    state: { ...state, workspaces: state.workspaces.map((row) => (row.id === tenantId ? next : row)) },
  };
}

export function confirmWorkspace(state: FulfillmentState, tenantId: string, name: string, now: string): OnboardingResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, state, reason: "Open a workspace before naming it." };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, state, reason: "The workspace needs a name." };
  const step = onboardingStep(workspace);
  const next: Workspace = {
    ...workspace,
    name: trimmed,
    onboarding: step === "workspace" ? "plan" : step,
    createdAt: workspace.createdAt || now,
  };
  return {
    ok: true,
    created: false,
    workspace: next,
    state: { ...state, workspaces: state.workspaces.map((row) => (row.id === tenantId ? next : row)) },
  };
}

export function finishOnboarding(state: FulfillmentState, tenantId: string): OnboardingResult {
  const workspace = workspaceFor(state, tenantId);
  if (!workspace) return { ok: false, state, reason: "Open a workspace first." };
  const step = onboardingStep(workspace);
  if (step !== "connections" && step !== "desk") {
    return { ok: false, state, reason: "Finish the workspace, test plan, first client, and a package before the checklist." };
  }
  const clients = state.clients.filter((row) => row.tenantId === tenantId);
  const enrollments = state.enrollments.filter((row) => row.tenantId === tenantId);
  if (clients.length === 0 || enrollments.length === 0) {
    return { ok: false, state, reason: "Add a client and a package before leaving the checklist." };
  }
  const next: Workspace = { ...workspace, onboarding: "desk" };
  return {
    ok: true,
    created: false,
    workspace: next,
    state: { ...state, workspaces: state.workspaces.map((row) => (row.id === tenantId ? next : row)) },
  };
}
