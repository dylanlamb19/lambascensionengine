/**
 * Server orchestration: create + arm reach-out-all under Test Mode.
 * Never turns Test Mode off. Never enableLive.
 */
import { contentHash } from "@/lib/mail/snapshot";
import { readTestModeFlag } from "@/lib/mail/test-mode";
import { createCampaign } from "./service.server";
import * as db from "./sql.server";
import {
  REACH_OUT_ALL_CAMPAIGN_NAME,
  REACH_OUT_ALL_SOFT_CAP_DEFAULT,
  draftsArePersonalized,
  planReachOutToAll,
} from "./reach-out-all";

export type ReachOutAllResult =
  | {
      ok: true;
      campaignId: string;
      authorized: number;
      skipped: number;
      truncated: boolean;
      softCap: number;
      testModeOnly: true;
      liveEnabled: false;
      globalTestMode: boolean;
      personalized: boolean;
      spoken: string;
    }
  | { ok: false; reason: string };

export async function reachOutToAllContactable(
  userId: string,
  opts: { softCap?: number; name?: string } = {},
): Promise<ReachOutAllResult> {
  const softCap = opts.softCap || REACH_OUT_ALL_SOFT_CAP_DEFAULT;

  // Read global Test Mode — we do NOT turn it off; we refuse live enable either way.
  let globalTestMode = true;
  try {
    const { loadSettings } = await import("@/lib/mail/sql.server");
    const settings = await loadSettings(userId);
    globalTestMode = readTestModeFlag(settings.testMode);
  } catch {
    globalTestMode = true; // fail closed: assume Test Mode on
  }

  const { listProspects } = await import("@/lib/prospects/repo.server");
  const prospects = await listProspects(userId);
  const plan = planReachOutToAll(prospects, softCap);

  if (!plan.eligible.length) {
    return {
      ok: false,
      reason: "No EMAIL-contactable prospects to reach out to. Phone/LinkedIn alone do not count.",
    };
  }

  if (!draftsArePersonalized(plan.eligible)) {
    return {
      ok: false,
      reason: "Refusing identical blast — tailored drafts were not personalized enough.",
    };
  }

  const campaign = await createCampaign(userId, {
    name: (opts.name || REACH_OUT_ALL_CAMPAIGN_NAME).trim(),
    requireUsableEmail: true,
    maxFirstContactsPerDay: softCap,
    testModeOnly: true, // NEVER false here
    subjectTemplate: "Quick note for {{company}}",
    bodyTemplate:
      "Hi{{#decision_maker}} {{decision_maker}}{{/decision_maker}},\n\nWorth a short look?\n\n— Dylan",
  });

  // Freeze tailored per-member bodies BEFORE arm (arm rebuilds from template — so replace after rebuild path)
  // Strategy: rebuild membership for eligibility, then overwrite eligible members with tailored drafts, then authorize.
  const { rebuildMembership } = await import("./service.server");
  const rebuilt = await rebuildMembership(userId, campaign.id);
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason };

  const members = await db.listMembers(campaign.id);
  const byUid = new Map(plan.eligible.map((d) => [d.prospectUid, d]));
  const now = new Date().toISOString();

  const next = members.map((m) => {
    const draft = byUid.get(m.prospectUid);
    if (!draft || !draft.recipient || !draft.subject || !draft.body) {
      return {
        prospectUid: m.prospectUid,
        status: m.status === "eligible" ? ("skipped" as const) : m.status,
        skipReason: m.skipReason || (m.status === "eligible" ? "No tailored draft (fail closed)." : m.skipReason),
        recipient: m.recipient,
        messageSubject: m.messageSubject,
        messageBody: m.messageBody,
        messageHash: m.messageHash,
        eligibilitySnapshot: m.eligibilitySnapshot,
        authorizedAt: null as string | null,
        sendKey: "",
      };
    }
    const hash = contentHash(draft.recipient, draft.subject, draft.body);
    return {
      prospectUid: m.prospectUid,
      status: "authorized" as const,
      skipReason: "",
      recipient: draft.recipient,
      messageSubject: draft.subject,
      messageBody: draft.body,
      messageHash: hash,
      eligibilitySnapshot: {
        ...(m.eligibilitySnapshot || {}),
        tailored: true,
        factsUsed: draft.factsUsed,
        reachOutAll: true,
        testModeOnly: true,
      },
      authorizedAt: now,
      sendKey: `campaign:${campaign.id}:${m.prospectUid}:email`,
    };
  });

  await db.replaceMembers(campaign.id, next);
  await db.updateCampaignStatus(userId, campaign.id, "armed");

  // Belt-and-suspenders: ensure testModeOnly stays true / live stays false
  await db.updateCampaignStatus(userId, campaign.id, "armed", {
    testModeOnly: true,
    liveEnabled: false,
  });

  const authorized = next.filter((m) => m.status === "authorized").length;
  const skipped = next.filter((m) => m.status === "skipped" || m.status === "suppressed").length;

  const spoken = [
    `Reach-out-all armed under Test Mode: ${authorized} personalized draft${authorized === 1 ? "" : "s"} authorized`,
    plan.truncated ? `(soft-capped at ${softCap})` : "",
    `${skipped} skipped.`,
    "Worker may send only via Test Mode allowlist. Live sends stay off. Nothing was sent by this command alone.",
  ].filter(Boolean).join(" ");


  return {
    ok: true,
    campaignId: campaign.id,
    authorized,
    skipped: skipped + plan.skipped.length,
    truncated: plan.truncated,
    softCap,
    testModeOnly: true,
    liveEnabled: false,
    globalTestMode,
    personalized: true,
    spoken,
  };
}
