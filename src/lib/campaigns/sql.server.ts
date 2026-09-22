import { getSql } from "@/lib/db";
import type { CampaignMember, CampaignMemberStatus, CampaignReport, CampaignStatus, EmailCampaign } from "./types";

function asIso(v: string | Date | null | undefined): string {
  if (!v) return "";
  return new Date(v).toISOString();
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

type CampaignRow = {
  id: string;
  user_id: string;
  name: string;
  status: string;
  verticals: unknown;
  locations: unknown;
  require_usable_email: boolean;
  min_fit: string;
  max_first_contacts_per_day: number;
  test_mode_only: boolean;
  live_enabled: boolean;
  subject_template: string;
  body_template: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function mapCampaign(r: CampaignRow): EmailCampaign {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    status: r.status as CampaignStatus,
    verticals: parseJsonArray(r.verticals),
    locations: parseJsonArray(r.locations),
    requireUsableEmail: Boolean(r.require_usable_email),
    minFit: r.min_fit,
    maxFirstContactsPerDay: Number(r.max_first_contacts_per_day) || 15,
    testModeOnly: r.test_mode_only !== false,
    liveEnabled: Boolean(r.live_enabled),
    subjectTemplate: r.subject_template || "",
    bodyTemplate: r.body_template || "",
    createdAt: asIso(r.created_at),
    updatedAt: asIso(r.updated_at),
  };
}

export async function insertCampaign(c: EmailCampaign): Promise<EmailCampaign> {
  const sql = await getSql();
  await sql`
    insert into email_campaigns (
      id, user_id, name, status, verticals, locations,
      require_usable_email, min_fit, max_first_contacts_per_day,
      test_mode_only, live_enabled, subject_template, body_template,
      created_at, updated_at
    ) values (
      ${c.id}, ${c.userId}, ${c.name}, ${c.status},
      ${JSON.stringify(c.verticals)}::jsonb,
      ${JSON.stringify(c.locations)}::jsonb,
      ${c.requireUsableEmail}, ${c.minFit}, ${c.maxFirstContactsPerDay},
      ${c.testModeOnly}, ${c.liveEnabled},
      ${c.subjectTemplate}, ${c.bodyTemplate},
      ${c.createdAt}::timestamptz, ${c.updatedAt}::timestamptz
    )
  `;
  return c;
}

export async function listCampaigns(userId: string): Promise<EmailCampaign[]> {
  const sql = await getSql();
  const rows = await sql<CampaignRow>`
    select * from email_campaigns
    where user_id = ${userId}
    order by updated_at desc
    limit 100
  `;
  return rows.map(mapCampaign);
}

export async function getCampaign(userId: string, id: string): Promise<EmailCampaign | null> {
  const sql = await getSql();
  const rows = await sql<CampaignRow>`
    select * from email_campaigns where user_id = ${userId} and id = ${id} limit 1
  `;
  return rows[0] ? mapCampaign(rows[0]) : null;
}

export async function updateCampaignStatus(
  userId: string,
  id: string,
  status: CampaignStatus,
  extra?: { liveEnabled?: boolean; testModeOnly?: boolean },
): Promise<EmailCampaign | null> {
  const sql = await getSql();
  const now = new Date().toISOString();
  if (extra && (extra.liveEnabled !== undefined || extra.testModeOnly !== undefined)) {
    await sql`
      update email_campaigns set
        status = ${status},
        live_enabled = coalesce(${extra.liveEnabled ?? null}::boolean, live_enabled),
        test_mode_only = coalesce(${extra.testModeOnly ?? null}::boolean, test_mode_only),
        updated_at = ${now}::timestamptz
      where user_id = ${userId} and id = ${id}
    `;
  } else {
    await sql`
      update email_campaigns set status = ${status}, updated_at = ${now}::timestamptz
      where user_id = ${userId} and id = ${id}
    `;
  }
  return getCampaign(userId, id);
}

export async function replaceMembers(
  campaignId: string,
  members: Array<{
    prospectUid: string;
    status: CampaignMemberStatus;
    skipReason: string;
    recipient: string;
    messageSubject: string;
    messageBody: string;
    messageHash: string;
    eligibilitySnapshot: Record<string, unknown>;
    authorizedAt: string | null;
    sendKey: string;
  }>,
): Promise<void> {
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`delete from email_campaign_members where campaign_id = ${campaignId}`;
  for (const m of members) {
    await sql`
      insert into email_campaign_members (
        campaign_id, prospect_uid, status, skip_reason,
        message_subject, message_body, message_hash,
        eligibility_snapshot, authorized_at, send_key, recipient,
        created_at, updated_at
      ) values (
        ${campaignId}, ${m.prospectUid}, ${m.status}, ${m.skipReason},
        ${m.messageSubject}, ${m.messageBody}, ${m.messageHash},
        ${JSON.stringify(m.eligibilitySnapshot)}::jsonb,
        ${m.authorizedAt}::timestamptz, ${m.sendKey}, ${m.recipient},
        ${now}::timestamptz, ${now}::timestamptz
      )
    `;
  }
}

type MemberRow = {
  campaign_id: string;
  prospect_uid: string;
  status: string;
  skip_reason: string;
  message_subject: string;
  message_body: string;
  message_hash: string;
  eligibility_snapshot: unknown;
  authorized_at: string | Date | null;
  send_key: string;
  recipient: string;
  sent_at: string | Date | null;
  last_error: string;
};

function mapMember(r: MemberRow): CampaignMember {
  let snap: Record<string, unknown> = {};
  if (r.eligibility_snapshot && typeof r.eligibility_snapshot === "object") {
    snap = r.eligibility_snapshot as Record<string, unknown>;
  }
  return {
    campaignId: r.campaign_id,
    prospectUid: r.prospect_uid,
    status: r.status as CampaignMemberStatus,
    skipReason: r.skip_reason || "",
    messageSubject: r.message_subject || "",
    messageBody: r.message_body || "",
    messageHash: r.message_hash || "",
    eligibilitySnapshot: snap,
    authorizedAt: r.authorized_at ? asIso(r.authorized_at) : null,
    sendKey: r.send_key || "",
    recipient: r.recipient || "",
    sentAt: r.sent_at ? asIso(r.sent_at) : null,
    lastError: r.last_error || "",
  };
}

export async function listMembers(campaignId: string): Promise<CampaignMember[]> {
  const sql = await getSql();
  const rows = await sql<MemberRow>`
    select * from email_campaign_members
    where campaign_id = ${campaignId}
    order by prospect_uid
  `;
  return rows.map(mapMember);
}

export async function campaignReport(userId: string, campaignId: string): Promise<CampaignReport | null> {
  const c = await getCampaign(userId, campaignId);
  if (!c) return null;
  const sql = await getSql();
  const rows = await sql<{ status: string; n: string | number }>`
    select status, count(*)::int as n
    from email_campaign_members
    where campaign_id = ${campaignId}
    group by status
  `;
  const counts = {
    total: 0,
    queued: 0,
    eligible: 0,
    skipped: 0,
    authorized: 0,
    sent: 0,
    replied: 0,
    suppressed: 0,
    failed: 0,
  };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    counts.total += n;
    if (r.status in counts) (counts as Record<string, number>)[r.status] = n;
  }
  return {
    campaignId: c.id,
    name: c.name,
    status: c.status,
    testModeOnly: c.testModeOnly,
    liveEnabled: c.liveEnabled,
    counts,
  };
}

export async function listProcessableCampaigns(userId: string): Promise<EmailCampaign[]> {
  const sql = await getSql();
  const rows = await sql<CampaignRow>`
    select * from email_campaigns
    where user_id = ${userId}
      and status in ('armed', 'running')
    order by updated_at asc
  `;
  return rows.map(mapCampaign);
}

export async function claimAuthorizedMembers(
  campaignId: string,
  limit: number,
): Promise<CampaignMember[]> {
  const sql = await getSql();
  const rows = await sql<MemberRow>`
    select * from email_campaign_members
    where campaign_id = ${campaignId}
      and status = 'authorized'
    order by authorized_at asc nulls last, prospect_uid
    limit ${limit}
  `;
  return rows.map(mapMember);
}

export async function markMemberSent(
  campaignId: string,
  prospectUid: string,
): Promise<void> {
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`
    update email_campaign_members set
      status = 'sent',
      sent_at = ${now}::timestamptz,
      updated_at = ${now}::timestamptz,
      last_error = ''
    where campaign_id = ${campaignId} and prospect_uid = ${prospectUid}
  `;
}

export async function markMemberFailed(
  campaignId: string,
  prospectUid: string,
  error: string,
  asSuppressed = false,
): Promise<void> {
  const sql = await getSql();
  const now = new Date().toISOString();
  const status = asSuppressed ? "suppressed" : "failed";
  await sql`
    update email_campaign_members set
      status = ${status},
      last_error = ${error.slice(0, 500)},
      updated_at = ${now}::timestamptz
    where campaign_id = ${campaignId} and prospect_uid = ${prospectUid}
  `;
}

export async function markMemberReplied(userId: string, prospectUid: string): Promise<void> {
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`
    update email_campaign_members m set
      status = 'replied',
      updated_at = ${now}::timestamptz
    from email_campaigns c
    where m.campaign_id = c.id
      and c.user_id = ${userId}
      and m.prospect_uid = ${prospectUid}
      and m.status in ('authorized', 'sent')
  `;
}

export async function countSentToday(userId: string, campaignId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: string | number }>`
    select count(*)::int as n
    from email_campaign_members m
    join email_campaigns c on c.id = m.campaign_id
    where c.user_id = ${userId}
      and m.campaign_id = ${campaignId}
      and m.status = 'sent'
      and m.sent_at >= date_trunc('day', now() at time zone 'America/Chicago')
        at time zone 'America/Chicago'
  `;
  return Number(rows[0]?.n) || 0;
}

export async function maybeCompleteCampaign(userId: string, campaignId: string): Promise<void> {
  const sql = await getSql();
  const rows = await sql<{ left: string | number }>`
    select count(*)::int as left
    from email_campaign_members
    where campaign_id = ${campaignId}
      and status in ('authorized', 'eligible', 'queued')
  `;
  if ((Number(rows[0]?.left) || 0) === 0) {
    await updateCampaignStatus(userId, campaignId, "completed");
  }
}
