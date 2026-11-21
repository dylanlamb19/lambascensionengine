import { tickAiVisibility } from "./ai-visibility.ts";
import { recordAppointment, tickAppointments } from "./appointment-reminders.ts";
import { fakeBilling } from "./billing.ts";
import { stubConnect } from "./connections.ts";
import { recordOpenEstimate, tickEstimates } from "./estimate-follow-ups.ts";
import { recordAdsMetrics, tickGoogleAds } from "./google-ads.ts";
import { saveClientIntake, tickLeadGeneration } from "./lead-generation.ts";
import { captureLead, tickLeadFollowUp } from "./lead-follow-up.ts";
import { recordCompletedJob, recordStoredReview, tickReviews } from "./reviews-gbp.ts";
import { addDays, addMonthsIso, recordPurchase, tickFulfillment } from "./runner.ts";
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
      for (const item of [
        { clientName: marketer.client, packageId: "reviews-gbp" as const },
        { clientName: marketer.secondClient, packageId: "appointment-reminders" as const },
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
      const listed = tickFulfillment(state, tenantId, now, { enabled: true, credentials: credentialsFor(state, tenantId) });
      state = tickFulfillment(listed.state, tenantId, now, { enabled: true, credentials: credentialsFor(listed.state, tenantId) }).state;
    }
    state = seedServiceCare(state, tenantId, now, factory);
    state = seedEstimatesAndAds(state, tenantId, now, factory);
  }
  return {
    ...state,
    workspaces: state.workspaces.map((row) => ({ ...row, onboarding: "desk" as const })),
  };
}

const SAMPLE_APPOINTMENT = "2026-11-17T15:00:00.000Z";

/** Completed jobs, stored reviews, and booking-calendar reminders for the sample workspaces. */
function seedServiceCare(state: FulfillmentState, tenantId: string, now: string, factory: () => string): FulfillmentState {
  for (const kind of ["job_feed", "gbp", "booking_calendar"] as const) {
    const connected = stubConnect(state, tenantId, kind, now);
    if (connected.ok) state = connected.state;
  }
  const reviews = state.enrollments.find((row) => row.tenantId === tenantId && row.packageId === "reviews-gbp" && row.status === "active");
  if (reviews) {
    const client = state.clients.find((row) => row.id === reviews.clientId && row.tenantId === tenantId);
    const harbor = client?.name === "North Roofing";
    const intake = saveClientIntake(state, tenantId, {
      clientId: reviews.clientId,
      businessName: client?.name || "Client",
      phone: harbor ? "555-0142" : "555-0160",
      address: harbor ? "12 Harbor Ave" : "8 County Road",
      website: harbor ? "https://north.example" : "https://redbarn.example",
      offer: harbor ? "Roof inspections" : "Barn roof repair",
      serviceArea: harbor ? "Harbor County" : "Prairie County",
    }, now, { enabled: true });
    if (intake.ok) state = intake.state;
    const job = recordCompletedJob(state, tenantId, {
      enrollmentId: reviews.id,
      customerName: harbor ? "Riley Chen" : "Jordan Hale",
      customerEmail: harbor ? "riley@north.example" : "jordan@redbarn.example",
      jobLabel: harbor ? "Shingle replacement" : "Barn roof",
      completedAt: "2026-11-14T15:00:00.000Z",
      completed: true,
    }, now, { enabled: true, ids: factory });
    if (job.ok) state = job.state;
    const review = recordStoredReview(state, tenantId, {
      enrollmentId: reviews.id,
      reviewerName: harbor ? "Riley Chen" : "Jordan Hale",
      body: harbor ? "The crew kept the yard clean." : "The barn roof was finished on time.",
    }, now, { enabled: true, ids: factory });
    if (review.ok) state = review.state;
    for (let i = 0; i < 6; i += 1) state = tickReviews(state, tenantId, now, { enabled: true }).state;
    const month = addMonthsIso(now, 1);
    for (let i = 0; i < 4; i += 1) state = tickReviews(state, tenantId, month, { enabled: true }).state;
  }
  const reminders = state.enrollments.find((row) => row.tenantId === tenantId && row.packageId === "appointment-reminders" && row.status === "active");
  if (reminders) {
    const client = state.clients.find((row) => row.id === reminders.clientId && row.tenantId === tenantId);
    const harbor = client?.name === "Lakeside HVAC";
    const booked = recordAppointment(state, tenantId, {
      enrollmentId: reminders.id,
      customerName: harbor ? "Avery Cole" : "Morgan Diaz",
      customerEmail: harbor ? "avery@lakeside.example" : "morgan@mainstreet.example",
      startsAt: SAMPLE_APPOINTMENT,
      calendar: "booking_calendar",
    }, now, { enabled: true, ids: factory });
    if (booked.ok) state = booked.state;
    for (let i = 0; i < 4; i += 1) state = tickAppointments(state, tenantId, now, { enabled: true }).state;
  }
  return state;
}

/** Open estimates and stored Google Ads drafts for the sample workspaces. Nothing is sent or spent. */
function seedEstimatesAndAds(state: FulfillmentState, tenantId: string, now: string, factory: () => string): FulfillmentState {
  for (const kind of ["estimate_feed", "google_ads"] as const) {
    const connected = stubConnect(state, tenantId, kind, now);
    if (connected.ok) state = connected.state;
  }
  const harbor = state.workspaces.find((row) => row.id === tenantId)?.name === "Harbor Marketing";
  const estimateClient = harbor ? "North Roofing" : "Red Barn Roofing";
  const adsClient = harbor ? "Lakeside HVAC" : "Main Street Dental";
  const estimateOwner = state.clients.find((row) => row.tenantId === tenantId && row.name === estimateClient);
  if (estimateOwner) {
    const parent = state.enrollments.find((row) => row.tenantId === tenantId && row.clientId === estimateOwner.id && row.packageId === "lead-follow-up" && row.status === "active");
    if (!parent) {
      const bought = recordPurchase(state, tenantId, {
        clientName: estimateClient,
        packageId: "lead-follow-up",
        setupPayment: "recorded",
        monthlyPayment: "recorded",
        startedOn: "2026-11-01",
      }, now, factory);
      if (bought.ok) state = bought.state;
    }
    const hasEstimates = state.enrollments.some((row) => row.tenantId === tenantId && row.clientId === estimateOwner.id && row.packageId === "estimate-follow-ups" && row.status === "active");
    if (!hasEstimates) {
      const bought = recordPurchase(state, tenantId, {
        clientName: estimateClient,
        packageId: "estimate-follow-ups",
        setupPayment: "recorded",
        monthlyPayment: "recorded",
        startedOn: "2026-11-01",
      }, now, factory);
      if (bought.ok) state = bought.state;
    }
    const enrollment = state.enrollments.find((row) => row.tenantId === tenantId && row.clientId === estimateOwner.id && row.packageId === "estimate-follow-ups" && row.status === "active");
    if (enrollment) {
      const recorded = recordOpenEstimate(state, tenantId, {
        enrollmentId: enrollment.id,
        customerName: harbor ? "Pat Nguyen" : "Casey Brook",
        customerEmail: harbor ? "pat@north.example" : "casey@redbarn.example",
        label: harbor ? "Full roof replacement" : "Barn metal quote",
        openedAt: "2026-11-13T15:00:00.000Z",
      }, now, { enabled: true, ids: factory });
      if (recorded.ok) state = recorded.state;
      for (let i = 0; i < 4; i += 1) state = tickEstimates(state, tenantId, now, { enabled: true }).state;
    }
  }
  const adsOwner = state.clients.find((row) => row.tenantId === tenantId && row.name === adsClient);
  if (adsOwner) {
    let enrollment = state.enrollments.find((row) => row.tenantId === tenantId && row.clientId === adsOwner.id && row.packageId === "google-ads" && row.status === "active");
    if (!enrollment) {
      const bought = recordPurchase(state, tenantId, {
        clientName: adsClient,
        packageId: "google-ads",
        setupPayment: "waived",
        monthlyPayment: "recorded",
        startedOn: "2026-11-01",
      }, now, factory);
      if (bought.ok) state = bought.state;
      enrollment = state.enrollments.find((row) => row.tenantId === tenantId && row.clientId === adsOwner.id && row.packageId === "google-ads" && row.status === "active");
    }
    if (enrollment) {
      const intake = saveClientIntake(state, tenantId, {
        clientId: adsOwner.id,
        businessName: adsClient,
        phone: harbor ? "555-0190" : "555-0177",
        address: harbor ? "4 Lake St" : "1 Main St",
        website: harbor ? "https://lakeside.example" : "https://mainstreet.example",
        offer: harbor ? "Furnace repair" : "Cleanings",
        serviceArea: harbor ? "Lakeside" : "Prairie County",
      }, now, { enabled: true });
      if (intake.ok) state = intake.state;
      const metrics = recordAdsMetrics(intake.ok ? intake.state : state, tenantId, {
        enrollmentId: enrollment.id,
        periodLabel: harbor ? "Nov 9 to Nov 15" : "Nov 9 to Nov 15 prairie",
        impressions: harbor ? 120 : 40,
        clicks: harbor ? 9 : 3,
        conversions: harbor ? null : 1,
        spendCents: null,
      }, now, { enabled: true, ids: factory });
      if (metrics.ok) state = metrics.state;
      for (let i = 0; i < 6; i += 1) state = tickGoogleAds(state, tenantId, now, { enabled: true }).state;
      const week = addDays(now, 7);
      for (let i = 0; i < 4; i += 1) state = tickGoogleAds(state, tenantId, week, { enabled: true }).state;
    }
  }
  return state;
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
