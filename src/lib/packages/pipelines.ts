import { tickAppointments } from "./appointment-reminders.ts";
import { tickAiVisibility } from "./ai-visibility.ts";
import { packagePipelineEnabled } from "./cadence.ts";
import { tickEstimates } from "./estimate-follow-ups.ts";
import { tickGoogleAds } from "./google-ads.ts";
import { tickMetaAds } from "./meta-ads.ts";
import { tickOfficeAutomation } from "./office-automation.ts";
import { tickLeadFollowUp, type LeadFlag } from "./lead-follow-up.ts";
import { tickLeadGeneration } from "./lead-generation.ts";
import { tickReviews } from "./reviews-gbp.ts";
import { tickFulfillment, type TickOptions } from "./runner.ts";
import type { AppointmentStep, CredentialPort, EstimateStep, FollowUpLead, FulfillmentState, LeadStepRun, PackageRunStep, ReviewRequestStep } from "./types.ts";

/**
 * Tick every package pipeline for one workspace.
 * Returns the same state while PACKAGE_FULFILLMENT is off, unless a test passes enabled.
 * This is not a cron. No mailbox, ad account, model, Google API, booking API, or sales outreach sender is called.
 */
export function tickPackagePipelines(
  state: FulfillmentState,
  tenantId: string,
  now: string,
  opts: LeadFlag & {
    credentials?: CredentialPort;
    runLeadStep?: (step: LeadStepRun, lead: FollowUpLead) => void;
    runLeadGenStep?: (step: PackageRunStep) => void;
    runVisibilityStep?: (step: PackageRunStep) => void;
    runReviewStep?: (step: ReviewRequestStep) => void;
    runReviewsCareStep?: (step: PackageRunStep) => void;
    runAppointmentStep?: (step: AppointmentStep) => void;
    runEstimateStep?: (step: EstimateStep) => void;
    runAdsStep?: (step: PackageRunStep) => void;
    runMetaStep?: (step: PackageRunStep) => void;
    runOfficeStep?: (step: PackageRunStep) => void;
  } = {},
): { state: FulfillmentState; advanced: number } {
  if (!packagePipelineEnabled(opts.enabled)) return { state, advanced: 0 };
  const packageTick = tickFulfillment(state, tenantId, now, {
    enabled: true,
    credentials: opts.credentials,
  } satisfies TickOptions);
  const leadTick = tickLeadFollowUp(packageTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runLeadStep,
  });
  const generationTick = tickLeadGeneration(leadTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runLeadGenStep,
  });
  const visibilityTick = tickAiVisibility(generationTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runVisibilityStep,
  });
  const reviewsTick = tickReviews(visibilityTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runReviewStep,
    runCareStep: opts.runReviewsCareStep,
  });
  const appointmentTick = tickAppointments(reviewsTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runAppointmentStep,
  });
  const estimateTick = tickEstimates(appointmentTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runEstimateStep,
  });
  const adsTick = tickGoogleAds(estimateTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runAdsStep,
  });
  const metaTick = tickMetaAds(adsTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runMetaStep,
  });
  const officeTick = tickOfficeAutomation(metaTick.state, tenantId, now, {
    enabled: true,
    runStep: opts.runOfficeStep,
  });
  return {
    state: officeTick.state,
    advanced: packageTick.advanced + leadTick.advanced + generationTick.advanced + visibilityTick.advanced + reviewsTick.advanced + appointmentTick.advanced + estimateTick.advanced + adsTick.advanced + metaTick.advanced + officeTick.advanced,
  };
}
