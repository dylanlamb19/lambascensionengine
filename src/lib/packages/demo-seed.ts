import { tickAiVisibility } from "./ai-visibility.ts";
import { fakeBilling } from "./billing.ts";
import { stubConnect } from "./connections.ts";
import { saveClientIntake, tickLeadGeneration } from "./lead-generation.ts";
import { captureLead, tickLeadFollowUp } from "./lead-follow-up.ts";
import { recordPurchase, tickFulfillment } from "./runner.ts";
import { startMarketerOnboarding, workspaceIdForUser } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type FulfillmentState } from "./types.ts";
import { credentialsFor } from "./connections.ts";

export const DEMO_MARKETERS = [
  { userId: "demo-harbor", workspaceName: "Harbor Marketing", client: "North Roofing", packageId: "lead-follow-up" as const, secondClient: "Lakeside HVAC", secondPackage: "google-ads" as const },
  { userId: "demo-prairie", workspaceName: "Prairie Studio", client: "Red Barn Roofing", packageId: "reviews-gbp" as const, secondClient: "Main Street Dental", secondPackage: "appointment-reminders" as const },
];

const DEMO_NOW = "2026-11-15T15:00:00.000Z";

export function demoSeedAllowed(env: { VERCEL_ENV?: string | null } = {}): boolean {
  return env.VERCEL_ENV !== "production";
}

function ids() {
  let n = 0;
  return () => `demo-${++n}`;
}

/** Sample workspaces for a local demo. This function does not touch a database. */
export function buildDemoSeed(now = DEMO_NOW): FulfillmentState {
  const factory = ids();
  let state: FulfillmentState = EMPTY_FULFILLMENT;
  for (const marketer of DEMO_MARKETERS) {
    const opened = startMarketerOnboarding(state, { userId: marketer.userId, workspaceName: marketer.workspaceName, now });
    if (!opened.ok) return state;
    state = opened.state;
    const tenantId = opened.workspace.id;
    if (marketer.userId === "demo-harbor") {
      const checked = fakeBilling.checkout(state, tenantId, "test_operator", now, `demo-chk-${tenantId}`);
      if (checked.ok) state = checked.state;
    }
    for (const item of [
      { clientName: marketer.client, packageId: marketer.packageId },
      { clientName: marketer.secondClient, packageId: marketer.secondPackage },
    ]) {
      const bought = recordPurchase(state, tenantId, {
        clientName: item.clientName,
        packageId: item.packageId,
        setupPayment: "recorded",
        monthlyPayment: "recorded",
        startedOn: "2026-11-01",
      }, now, factory);
      if (bought.ok) state = bought.state;
    }
    const connected = stubConnect(state, tenantId, "mailbox", now);
    if (connected.ok) state = connected.state;
    const first = tickFulfillment(state, tenantId, now, { enabled: true, credentials: credentialsFor(state, tenantId) });
    const second = tickFulfillment(first.state, tenantId, now, { enabled: true, credentials: credentialsFor(first.state, tenantId) });
    state = second.state;
    const followUp = state.enrollments.find((row) => row.tenantId === tenantId && row.packageId === "lead-follow-up" && row.status === "active");
    if (followUp) {
      const captured = captureLead(state, tenantId, {
        enrollmentId: followUp.id,
        contactName: "Sam Ellis",
        contactEmail: "sam.ellis@northroofing.example",
        source: "website form",
      }, "2026-11-13T15:00:00.000Z", { enabled: true, ids: factory });
      if (captured.ok) {
        let next = captured.state;
        for (let i = 0; i < 8; i += 1) {
          next = tickLeadFollowUp(next, tenantId, now, { enabled: true }).state;
        }
        state = next;
      }
    }
    if (marketer.userId === "demo-harbor") {
      const roofing = state.clients.find((row) => row.tenantId === tenantId && row.name === marketer.client);
      const hvac = state.clients.find((row) => row.tenantId === tenantId && row.name === marketer.secondClient);
      if (roofing) {
        const intake = saveClientIntake(state, tenantId, {
          clientId: roofing.id,
          businessName: "North Roofing",
          phone: "555-0142",
          address: "12 Harbor Ave",
          website: "https://north.example",
          offer: "Roof inspections",
          serviceArea: "Harbor County",
        }, now, { enabled: true });
        if (intake.ok) state = intake.state;
        const bought = recordPurchase(state, tenantId, {
          clientName: marketer.client,
          packageId: "lead-generation",
          setupPayment: "recorded",
          monthlyPayment: "recorded",
          startedOn: "2026-11-01",
        }, now, factory);
        if (bought.ok) state = bought.state;
      }
      if (hvac) {
        const intake = saveClientIntake(state, tenantId, {
          clientId: hvac.id,
          businessName: "Lakeside HVAC",
          phone: "555-0190",
          address: "4 Lake St",
          website: "https://lakeside.example",
          offer: "Furnace repair",
          serviceArea: "Lakeside",
        }, now, { enabled: true });
        if (intake.ok) state = intake.state;
        const bought = recordPurchase(state, tenantId, {
          clientName: marketer.secondClient,
          packageId: "ai-visibility",
          setupPayment: "waived",
          monthlyPayment: "recorded",
          startedOn: "2026-11-01",
        }, now, factory);
        if (bought.ok) state = bought.state;
      }
      const first = tickFulfillment(state, tenantId, now, { enabled: true, credentials: credentialsFor(state, tenantId) });
      state = tickFulfillment(first.state, tenantId, now, { enabled: true, credentials: credentialsFor(first.state, tenantId) }).state;
      for (let i = 0; i < 8; i += 1) {
        state = tickLeadGeneration(state, tenantId, now, { enabled: true }).state;
        state = tickAiVisibility(state, tenantId, now, { enabled: true }).state;
      }
    }
  }
  return {
    ...state,
    workspaces: state.workspaces.map((row) => ({ ...row, onboarding: "desk" as const })),
  };
}

export type DemoLoad =
  | { ok: true; state: FulfillmentState }
  | { ok: false; reason: string; state: FulfillmentState };

/** Refuse the sample when this process is production. Never writes to a database. */
export function loadDemoSeed(env: { VERCEL_ENV?: string | null } = {}, now = DEMO_NOW): DemoLoad {
  if (!demoSeedAllowed(env)) {
    return { ok: false, reason: "Sample workspaces are not loaded in production.", state: EMPTY_FULFILLMENT };
  }
  return { ok: true, state: buildDemoSeed(now) };
}

export function demoTenantId(userId: string): string | null {
  return workspaceIdForUser(userId);
}
