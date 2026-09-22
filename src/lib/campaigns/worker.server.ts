/**
 * Process armed/running campaign members under daily caps + Test Mode.
 * One bad member does not abort the batch.
 * Caller must run reply sync BEFORE this (tickOutreachWorker order).
 */
import { loadSettings, saveSequence, audit } from "@/lib/mail/sql.server";
import { allowSendRecipient, effectiveCaps, readTestModeFlag } from "@/lib/mail/test-mode";
import { getProspectByUid } from "@/lib/prospects/repo.server";
import * as db from "./sql.server";

export type CampaignTickResult = {
  campaigns: number;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
};

function campaignMaySend(opts: {
  testModeOnly: boolean;
  liveEnabled: boolean;
  globalTestMode: boolean;
}): { ok: true } | { ok: false; reason: string } {
  // Global Test Mode OR campaign test_mode_only → allowlist path only (enforced at sendLive).
  if (opts.liveEnabled && !opts.testModeOnly && !opts.globalTestMode) {
    return { ok: true };
  }
  // Default: campaign stays on Test Mode rails.
  if (opts.testModeOnly || opts.globalTestMode || !opts.liveEnabled) {
    return { ok: true }; // still ok to attempt — allowlist gate inside sendLive
  }
  return { ok: false, reason: "Campaign live gate closed." };
}

export async function processArmedCampaignsForUser(userId: string): Promise<CampaignTickResult> {
  const result: CampaignTickResult = { campaigns: 0, attempted: 0, sent: 0, skipped: 0, failed: 0 };
  let campaigns;
  try {
    campaigns = await db.listProcessableCampaigns(userId);
  } catch {
    // Table may not be migrated yet.
    return result;
  }
  if (!campaigns.length) return result;

  const settings = await loadSettings(userId);
  const globalTestMode = readTestModeFlag(settings.testMode);
  const caps = effectiveCaps(settings);

  for (const campaign of campaigns) {
    result.campaigns += 1;
    const gate = campaignMaySend({
      testModeOnly: campaign.testModeOnly,
      liveEnabled: campaign.liveEnabled,
      globalTestMode,
    });
    if (!gate.ok) continue;

    // Fail closed: live_enabled false OR test_mode_only true means Test Mode allowlist only.
    // sendLive already enforces allowlist when settings.testMode is on.
    // If owner disabled global Test Mode but campaign still test_mode_only / !liveEnabled,
    // refuse live sends outside allowlist by forcing test check here.
    const forceAllowlist = campaign.testModeOnly || !campaign.liveEnabled || globalTestMode;

    const sentToday = await db.countSentToday(userId, campaign.id);
    const campaignCap = Math.max(1, campaign.maxFirstContactsPerDay || 15);
    const globalFirstCap = caps.maxFirst;
    const remaining = Math.max(0, Math.min(campaignCap - sentToday, globalFirstCap));
    if (remaining <= 0) continue;

    if (campaign.status === "armed") {
      await db.updateCampaignStatus(userId, campaign.id, "running");
    }

    const members = await db.claimAuthorizedMembers(campaign.id, remaining);
    for (const member of members) {
      result.attempted += 1;
      try {
        if (!member.recipient || !member.messageSubject || !member.messageBody) {
          await db.markMemberFailed(campaign.id, member.prospectUid, "Missing frozen recipient/subject/body.");
          result.skipped += 1;
          continue;
        }

        if (forceAllowlist) {
          const allow = allowSendRecipient({
            testMode: true,
            allowlist: settings.allowlist,
            recipient: member.recipient,
          });
          if (!allow.ok) {
            await db.markMemberFailed(campaign.id, member.prospectUid, allow.reason);
            result.skipped += 1;
            continue;
          }
        }

        const prospect = await getProspectByUid(userId, member.prospectUid);
        if (!prospect) {
          await db.markMemberFailed(campaign.id, member.prospectUid, "Prospect missing.");
          result.skipped += 1;
          continue;
        }
        if (prospect.suppressed || prospect.stage === "Do Not Contact") {
          await db.markMemberFailed(campaign.id, member.prospectUid, "DNC/suppressed.", true);
          result.skipped += 1;
          continue;
        }
        if (prospect.is_demo) {
          await db.markMemberFailed(campaign.id, member.prospectUid, "DEMO excluded from live.", true);
          result.skipped += 1;
          continue;
        }

        // Campaign Arm is the authorization — firstApproved true for this campaign send.
        const { sendLive } = await import("@/lib/mail/live.server");
        const sent = await sendLive({
          userId,
          prospect,
          kind: "email",
          method: "AUTOMATION",
          to: member.recipient,
          subject: member.messageSubject,
          body: member.messageBody,
          firstApproved: true,
          sequenceId: `campaign:${campaign.id}`,
        });

        if (!sent.ok) {
          const suppress = /do not contact|unsub|bounc|suppress/i.test(sent.reason);
          await db.markMemberFailed(campaign.id, member.prospectUid, sent.reason, suppress);
          if (sent.code === "NOT_ALLOWLISTED" || sent.code === "RATE_LIMIT" || sent.code === "NOT_APPROVED") {
            result.skipped += 1;
          } else {
            result.failed += 1;
          }
          continue;
        }

        await db.markMemberSent(campaign.id, member.prospectUid);

        // Schedule follow-ups from frozen first subject; bodies from prospect pack if present.
        const pack = prospect.outreach;
        const f1 = pack?.messages?.find((m) => m.kind === "followup1")?.body || `Following up on my note to ${prospect.name}.`;
        const f2 = pack?.messages?.find((m) => m.kind === "followup2")?.body || `Checking back with ${prospect.name}.`;
        const f3 = pack?.messages?.find((m) => m.kind === "followup3")?.body || `Last note for ${prospect.name} — happy to close the loop.`;
        const now = Date.now();
        try {
          await saveSequence(userId, member.prospectUid, "AUTOMATION", [
            { step: "followup1", dueAt: now + 3 * 86400000, idempotencyKey: `${userId}:${member.prospectUid}:campaign:${campaign.id}:followup1`, body: f1, subject: member.messageSubject, recipient: member.recipient, threadId: sent.threadId },
            { step: "followup2", dueAt: now + 7 * 86400000, idempotencyKey: `${userId}:${member.prospectUid}:campaign:${campaign.id}:followup2`, body: f2, subject: member.messageSubject, recipient: member.recipient, threadId: sent.threadId },
            { step: "followup3", dueAt: now + 12 * 86400000, idempotencyKey: `${userId}:${member.prospectUid}:campaign:${campaign.id}:followup3`, body: f3, subject: member.messageSubject, recipient: member.recipient, threadId: sent.threadId },
          ]);
        } catch {
          // Follow-up schedule failure must not undo the sent first contact.
        }

        await audit(userId, "campaign_first_sent", `Campaign ${campaign.id} first contact`, {
          prospectUid: member.prospectUid,
          method: "AUTOMATION",
          sequenceId: `campaign:${campaign.id}`,
          providerIds: sent.messageId,
        });
        result.sent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "member failed";
        try {
          await db.markMemberFailed(campaign.id, member.prospectUid, msg);
        } catch { /* ignore */ }
        result.failed += 1;
      }
    }

    try {
      await db.maybeCompleteCampaign(userId, campaign.id);
    } catch { /* ignore */ }
  }

  return result;
}

export async function processArmedCampaigns(): Promise<CampaignTickResult> {
  const { listGmailUsers } = await import("@/lib/mail/sql.server");
  const users = await listGmailUsers();
  const total: CampaignTickResult = { campaigns: 0, attempted: 0, sent: 0, skipped: 0, failed: 0 };
  for (const userId of users) {
    const r = await processArmedCampaignsForUser(userId);
    total.campaigns += r.campaigns;
    total.attempted += r.attempted;
    total.sent += r.sent;
    total.skipped += r.skipped;
    total.failed += r.failed;
  }
  return total;
}
