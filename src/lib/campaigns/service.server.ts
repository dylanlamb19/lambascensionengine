/**
 * Campaign lifecycle: create / list / get / buildMembership / arm / pause / resume / cancel / report.
 * Arm = campaign-level authorization (freeze subject/body per member). Does not send.
 */
import { contentHash } from "@/lib/mail/snapshot";
import { newUid } from "@/lib/prospects/ids";
import { buildMembership } from "./membership";
import { mergeFieldsFromProspect, mergeTemplate } from "./merge";
import * as db from "./sql.server";
import {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  type CampaignReport,
  type EmailCampaign,
} from "./types";

export type CreateCampaignInput = {
  name: string;
  verticals?: string[];
  locations?: string[];
  requireUsableEmail?: boolean;
  minFit?: string;
  maxFirstContactsPerDay?: number;
  subjectTemplate?: string;
  bodyTemplate?: string;
  /** Kept true by default — owner must explicitly enable live later. */
  testModeOnly?: boolean;
};

async function loadCooldowns(userId: string): Promise<Map<string, string>> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ prospect_uid: string; cooldown_until: string | Date }>`
      select prospect_uid, cooldown_until
      from prospect_contact_cooldown
      where user_id = ${userId} and cooldown_until > now()
    `;
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.prospect_uid, new Date(r.cooldown_until).toISOString());
    return map;
  } catch {
    return new Map();
  }
}

async function loadActiveOutreach(userId: string): Promise<Set<string>> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ prospect_uid: string }>`
      select distinct prospect_uid from outreach_sequences
      where user_id = ${userId} and status = 'active'
    `;
    return new Set(rows.map((r) => r.prospect_uid));
  } catch {
    return new Set();
  }
}

export async function createCampaign(userId: string, input: CreateCampaignInput): Promise<EmailCampaign> {
  const now = new Date().toISOString();
  const name = (input.name || "").trim() || "Untitled campaign";
  const campaign: EmailCampaign = {
    id: newUid(),
    userId,
    name,
    status: "draft",
    verticals: (input.verticals || []).map((v) => v.trim()).filter(Boolean),
    locations: (input.locations || []).map((v) => v.trim()).filter(Boolean),
    requireUsableEmail: input.requireUsableEmail !== false,
    minFit: input.minFit || "possible",
    maxFirstContactsPerDay: Math.max(1, Math.min(50, input.maxFirstContactsPerDay || 15)),
    testModeOnly: input.testModeOnly !== false,
    liveEnabled: false,
    subjectTemplate: (input.subjectTemplate || DEFAULT_SUBJECT).trim(),
    bodyTemplate: (input.bodyTemplate || DEFAULT_BODY).trim(),
    createdAt: now,
    updatedAt: now,
  };
  await db.insertCampaign(campaign);
  return campaign;
}

export async function listCampaigns(userId: string): Promise<EmailCampaign[]> {
  return db.listCampaigns(userId);
}

export async function getCampaign(userId: string, id: string): Promise<EmailCampaign | null> {
  return db.getCampaign(userId, id);
}

export async function rebuildMembership(userId: string, campaignId: string): Promise<{
  ok: true;
  eligible: number;
  skipped: number;
  suppressed: number;
} | { ok: false; reason: string }> {
  const campaign = await db.getCampaign(userId, campaignId);
  if (!campaign) return { ok: false, reason: "Campaign not found." };
  if (campaign.status === "cancelled") return { ok: false, reason: "Campaign is cancelled." };

  const { listProspects } = await import("@/lib/prospects/repo.server");
  const prospects = await listProspects(userId);
  const cooldowns = await loadCooldowns(userId);
  const activeOutreachUids = await loadActiveOutreach(userId);

  const rows = buildMembership({
    prospects,
    verticals: campaign.verticals,
    locations: campaign.locations,
    requireUsableEmail: campaign.requireUsableEmail,
    minFit: campaign.minFit,
    cooldowns,
    activeOutreachUids,
  });

  const members = rows.map((r) => {
    const p = prospects.find((x) => x.uid === r.prospectUid);
    let subject = "";
    let body = "";
    let hash = "";
    if (r.status === "eligible" && p) {
      const fields = mergeFieldsFromProspect(p);
      subject = mergeTemplate(campaign.subjectTemplate, fields);
      body = mergeTemplate(campaign.bodyTemplate, fields);
      if (!subject || !body || !r.recipient) {
        return {
          prospectUid: r.prospectUid,
          status: "skipped" as const,
          skipReason: !r.recipient
            ? "No usable email after merge."
            : "Subject/body empty after merge — refusing invent.",
          recipient: r.recipient,
          messageSubject: "",
          messageBody: "",
          messageHash: "",
          eligibilitySnapshot: r.eligibilitySnapshot,
          authorizedAt: null,
          sendKey: "",
        };
      }
      hash = contentHash(r.recipient, subject, body);
    }
    return {
      prospectUid: r.prospectUid,
      status: r.status,
      skipReason: r.skipReason,
      recipient: r.recipient,
      messageSubject: subject,
      messageBody: body,
      messageHash: hash,
      eligibilitySnapshot: r.eligibilitySnapshot,
      authorizedAt: null,
      sendKey: "",
    };
  });

  await db.replaceMembers(campaignId, members);
  const eligible = members.filter((m) => m.status === "eligible").length;
  const skipped = members.filter((m) => m.status === "skipped").length;
  const suppressed = members.filter((m) => m.status === "suppressed").length;
  return { ok: true, eligible, skipped, suppressed };
}

/**
 * Arm = authorize campaign once. Freezes messages for eligible members.
 * Does NOT send — worker + Test Mode / live gates still apply.
 */
export async function armCampaign(userId: string, campaignId: string): Promise<{
  ok: true;
  authorized: number;
  skipped: number;
  testModeOnly: boolean;
  liveEnabled: boolean;
} | { ok: false; reason: string }> {
  const campaign = await db.getCampaign(userId, campaignId);
  if (!campaign) return { ok: false, reason: "Campaign not found." };
  if (campaign.status === "cancelled") return { ok: false, reason: "Cancelled campaigns cannot be armed." };
  if (campaign.status === "paused") return { ok: false, reason: "Resume before arming again, or create a new campaign." };

  const rebuilt = await rebuildMembership(userId, campaignId);
  if (!rebuilt.ok) return rebuilt;

  const members = await db.listMembers(campaignId);
  const now = new Date().toISOString();
  const next = members.map((m) => {
    if (m.status !== "eligible" || !m.recipient || !m.messageSubject || !m.messageBody) {
      return {
        prospectUid: m.prospectUid,
        status: m.status === "eligible" ? ("skipped" as const) : m.status,
        skipReason: m.skipReason || (m.status === "eligible" ? "Missing frozen message or recipient." : m.skipReason),
        recipient: m.recipient,
        messageSubject: m.messageSubject,
        messageBody: m.messageBody,
        messageHash: m.messageHash,
        eligibilitySnapshot: m.eligibilitySnapshot,
        authorizedAt: null,
        sendKey: "",
      };
    }
    return {
      prospectUid: m.prospectUid,
      status: "authorized" as const,
      skipReason: "",
      recipient: m.recipient,
      messageSubject: m.messageSubject,
      messageBody: m.messageBody,
      messageHash: m.messageHash || contentHash(m.recipient, m.messageSubject, m.messageBody),
      eligibilitySnapshot: m.eligibilitySnapshot,
      authorizedAt: now,
      sendKey: `campaign:${campaignId}:${m.prospectUid}:email`,
    };
  });

  await db.replaceMembers(campaignId, next);
  await db.updateCampaignStatus(userId, campaignId, "armed");
  const authorized = next.filter((m) => m.status === "authorized").length;
  const skipped = next.filter((m) => m.status === "skipped" || m.status === "suppressed").length;
  return {
    ok: true,
    authorized,
    skipped,
    testModeOnly: campaign.testModeOnly,
    liveEnabled: campaign.liveEnabled,
  };
}

export async function pauseCampaign(userId: string, campaignId: string) {
  const c = await db.getCampaign(userId, campaignId);
  if (!c) return { ok: false as const, reason: "Campaign not found." };
  if (c.status === "cancelled" || c.status === "completed") {
    return { ok: false as const, reason: `Cannot pause a ${c.status} campaign.` };
  }
  await db.updateCampaignStatus(userId, campaignId, "paused");
  return { ok: true as const, status: "paused" as const };
}

export async function resumeCampaign(userId: string, campaignId: string) {
  const c = await db.getCampaign(userId, campaignId);
  if (!c) return { ok: false as const, reason: "Campaign not found." };
  if (c.status !== "paused") return { ok: false as const, reason: "Only paused campaigns can be resumed." };
  const members = await db.listMembers(campaignId);
  const hasAuth = members.some((m) => m.status === "authorized");
  await db.updateCampaignStatus(userId, campaignId, hasAuth ? "running" : "armed");
  return { ok: true as const, status: hasAuth ? "running" as const : "armed" as const };
}

export async function cancelCampaign(userId: string, campaignId: string) {
  const c = await db.getCampaign(userId, campaignId);
  if (!c) return { ok: false as const, reason: "Campaign not found." };
  await db.updateCampaignStatus(userId, campaignId, "cancelled");
  return { ok: true as const, status: "cancelled" as const };
}

/** Explicit live enable — never inferred. Keeps test_mode_only false only when requested. */
export async function enableLive(userId: string, campaignId: string, confirm: string) {
  if ((confirm || "").trim() !== "ENABLE LIVE") {
    return { ok: false as const, reason: 'Type ENABLE LIVE to turn on live sends for this campaign. Default stays off.' };
  }
  const c = await db.getCampaign(userId, campaignId);
  if (!c) return { ok: false as const, reason: "Campaign not found." };
  await db.updateCampaignStatus(userId, campaignId, c.status, {
    liveEnabled: true,
    testModeOnly: false,
  });
  return { ok: true as const, liveEnabled: true, testModeOnly: false };
}

export async function reportCampaign(userId: string, campaignId: string): Promise<CampaignReport | null> {
  return db.campaignReport(userId, campaignId);
}

export async function getCampaignWithMembers(userId: string, campaignId: string) {
  const campaign = await db.getCampaign(userId, campaignId);
  if (!campaign) return null;
  const members = await db.listMembers(campaignId);
  const report = await db.campaignReport(userId, campaignId);
  return { campaign, members, report };
}
