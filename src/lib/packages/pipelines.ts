import { tickAiVisibility } from "./ai-visibility.ts";
import { packagePipelineEnabled } from "./cadence.ts";
import { tickLeadFollowUp, type LeadFlag } from "./lead-follow-up.ts";
import { tickLeadGeneration } from "./lead-generation.ts";
import { tickFulfillment, type TickOptions } from "./runner.ts";
import type { CredentialPort, FollowUpLead, FulfillmentState, LeadStepRun, PackageRunStep } from "./types.ts";

/**
 * Tick every package pipeline for one workspace.
 * Returns the same state while PACKAGE_FULFILLMENT is off, unless a test passes enabled.
 * This is not a cron. No mailbox, ad account, model, or sales outreach sender is called.
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
  return {
    state: visibilityTick.state,
    advanced: packageTick.advanced + leadTick.advanced + generationTick.advanced + visibilityTick.advanced,
  };
}
