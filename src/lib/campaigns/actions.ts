/**
 * Server actions for Email Campaigns UI + Ara tools.
 * Keep .server imports behind dynamic import so client bundles stay clean.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const listEmailCampaignsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listCampaigns } = await import("./service.server");
    const campaigns = await listCampaigns(context.userId);
    return { ok: true as const, campaigns };
  });

export const getEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { getCampaignWithMembers } = await import("./service.server");
    const row = await getCampaignWithMembers(context.userId, data.id);
    if (!row) return { ok: false as const, reason: "Campaign not found." };
    return { ok: true as const, ...row };
  });

export const createEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    name: string;
    verticals?: string[];
    locations?: string[];
    requireUsableEmail?: boolean;
    minFit?: string;
    maxFirstContactsPerDay?: number;
    subjectTemplate?: string;
    bodyTemplate?: string;
  }) => data)
  .handler(async ({ data, context }) => {
    const { createCampaign, rebuildMembership } = await import("./service.server");
    const campaign = await createCampaign(context.userId, data);
    const membership = await rebuildMembership(context.userId, campaign.id);
    return { ok: true as const, campaign, membership };
  });

export const armEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { armCampaign } = await import("./service.server");
    return armCampaign(context.userId, data.id);
  });

export const pauseEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { pauseCampaign } = await import("./service.server");
    return pauseCampaign(context.userId, data.id);
  });

export const resumeEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { resumeCampaign } = await import("./service.server");
    return resumeCampaign(context.userId, data.id);
  });

export const cancelEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { cancelCampaign } = await import("./service.server");
    return cancelCampaign(context.userId, data.id);
  });

export const enableLiveEmailCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; confirm: string }) => data)
  .handler(async ({ data, context }) => {
    const { enableLive } = await import("./service.server");
    return enableLive(context.userId, data.id, data.confirm);
  });

export const emailCampaignStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id?: string }) => data)
  .handler(async ({ data, context }) => {
    const { listCampaigns, reportCampaign } = await import("./service.server");
    if (data.id) {
      const report = await reportCampaign(context.userId, data.id);
      if (!report) return { ok: false as const, reason: "Campaign not found." };
      return { ok: true as const, report };
    }
    const campaigns = await listCampaigns(context.userId);
    const reports = [];
    for (const c of campaigns.slice(0, 20)) {
      const r = await reportCampaign(context.userId, c.id);
      if (r) reports.push(r);
    }
    return { ok: true as const, reports };
  });
