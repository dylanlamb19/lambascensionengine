import { getSql } from "@/lib/db";
import { newUid } from "@/lib/prospects/ids";
import { isTestWorkflowUid, TEST_WORKFLOW_UID } from "@/lib/mail/test-loop";
import type { SentinelCode, SentinelFeature, SentinelMode, SentinelSeverity } from "./codes.ts";
import { mergeOccurrence, serialEvidence } from "./ledger.ts";
import { EMPTY_INVARIANTS } from "./invariants.ts";
import type { InvariantSnapshot, SentinelBug, SentinelDeployment, SentinelFinding, SentinelRunRecord } from "./types.ts";

function iso(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value === "string") return value;
  return "";
}

export async function listOwnerUserIds(): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from (
      select distinct user_id from google_accounts
      union
      select distinct user_id from outreach_settings
    ) u
  `;
  return rows.map((r) => r.user_id);
}

export async function pingDatabase(): Promise<{ ok: boolean; source: "neon" | "pglite" | "none"; error?: string }> {
  try {
    const { dbSource } = await import("@/lib/db");
    const sql = await getSql();
    await sql`select 1 as ok`;
    return { ok: true, source: dbSource };
  } catch (err) {
    return { ok: false, source: "none", error: err instanceof Error ? err.message : "db" };
  }
}

export async function loadInvariantSnapshot(userId: string): Promise<InvariantSnapshot> {
  const sql = await getSql();
  const snap: InvariantSnapshot = { ...EMPTY_INVARIANTS, duplicatePlaceIds: [], bookedMissingEventId: [], bookedMissingPipeline: [], replyButFollowupScheduled: [], dncActiveSequence: [], bounceFutureSends: [], testInRevenue: [], testModeLeak: [], duplicateActivity: [] };

  try {
    const dupes = await sql<{ provider_place_id: string; uids: string }>`
      select provider_place_id, string_agg(uid, ',') as uids
      from prospects
      where user_id = ${userId} and provider_place_id is not null and provider_place_id <> ''
      group by provider_place_id
      having count(*) > 1
    `;
    snap.duplicatePlaceIds = dupes.map((r) => ({ placeId: r.provider_place_id, uids: (r.uids || "").split(",").filter(Boolean) }));
  } catch { /* table may be mid-migrate */ }

  try {
    const missing = await sql<{ id: string; prospect_uid: string }>`
      select id, prospect_uid from calendar_events
      where user_id = ${userId} and status = 'booked'
        and (google_event_id is null or google_event_id = '')
    `;
    snap.bookedMissingEventId = missing.map((r) => ({ id: r.id, prospectUid: r.prospect_uid }));
  } catch { /* ignore */ }

  try {
    const { repairPipelineBookingMismatches } = await import("@/lib/mail/booking-reconcile");
    await repairPipelineBookingMismatches(userId);
    const mismatch = await sql<{ google_event_id: string; prospect_uid: string }>`
      select ce.google_event_id, ce.prospect_uid
      from calendar_events ce
      join prospects p on p.user_id = ce.user_id and p.uid = ce.prospect_uid
      where ce.user_id = ${userId}
        and ce.status = 'booked'
        and ce.google_event_id is not null and ce.google_event_id <> ''
        and coalesce(p.stage, '') not in ('Call Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'Do Not Contact')
    `;
    const bookedNoEvent = await sql<{ google_event_id: string; prospect_uid: string }>`
      select '' as google_event_id, p.uid as prospect_uid
      from prospects p
      where p.user_id = ${userId} and p.stage = 'Call Booked'
        and not exists (
          select 1 from calendar_events ce
          where ce.user_id = p.user_id and ce.prospect_uid = p.uid
            and ce.status = 'booked'
            and ce.google_event_id is not null and ce.google_event_id <> ''
        )
    `;
    snap.bookedMissingPipeline = [...mismatch, ...bookedNoEvent].map((r) => ({
      googleEventId: r.google_event_id,
      prospectUid: r.prospect_uid,
    }));
  } catch { /* ignore */ }

  try {
    const replies = await sql<{ prospect_uid: string; followup_id: string }>`
      select f.prospect_uid, f.id as followup_id
      from scheduled_followups f
      where f.user_id = ${userId} and f.status = 'scheduled'
        and exists (
          select 1 from reply_events r
          where r.user_id = f.user_id and r.prospect_uid = f.prospect_uid
        )
    `;
    snap.replyButFollowupScheduled = replies.map((r) => ({ prospectUid: r.prospect_uid, followupId: r.followup_id }));
  } catch { /* ignore */ }

  try {
    const dnc = await sql<{ prospect_uid: string; sequence_id: string }>`
      select s.prospect_uid, s.id as sequence_id
      from outreach_sequences s
      join prospects p on p.user_id = s.user_id and p.uid = s.prospect_uid
      where s.user_id = ${userId} and s.status = 'active'
        and (p.suppressed = true or p.stage ilike '%do not contact%' or p.stage ilike '%skipped%')
    `;
    snap.dncActiveSequence = dnc.map((r) => ({ prospectUid: r.prospect_uid, sequenceId: r.sequence_id }));
  } catch { /* ignore */ }

  try {
    const bounce = await sql<{ prospect_uid: string; followup_id: string }>`
      select f.prospect_uid, f.id as followup_id
      from scheduled_followups f
      where f.user_id = ${userId} and f.status = 'scheduled'
        and exists (
          select 1 from email_messages m
          where m.user_id = f.user_id and m.prospect_uid = f.prospect_uid
            and (m.status ilike '%bounce%' or m.status = 'BOUNCED')
        )
    `;
    snap.bounceFutureSends = bounce.map((r) => ({ prospectUid: r.prospect_uid, followupId: r.followup_id }));
  } catch { /* ignore */ }

  try {
    const testRows = await sql<{ uid: string; stage: string }>`
      select uid, stage from prospects
      where user_id = ${userId}
        and (uid = ${TEST_WORKFLOW_UID} or uid ilike 'test-%')
        and stage in ('Call Booked', 'Won', 'Approved for Outreach')
    `;
    snap.testInRevenue = testRows
      .filter((r) => isTestWorkflowUid(r.uid))
      .filter((r) => r.stage === "Won")
      .map((r) => ({ uid: r.uid }));
  } catch { /* ignore */ }

  try {
    const { loadSettings } = await import("@/lib/mail/sql.server");
    const { isAllowlisted } = await import("@/lib/mail/test-mode");
    const settings = await loadSettings(userId);
    if (settings.testMode && settings.allowlist.length) {
      const sent = await sql<{ id: string; recipient: string }>`
        select id, recipient from email_messages
        where user_id = ${userId} and direction = 'out' and status = 'SENT'
        order by created_at desc
        limit 50
      `;
      snap.testModeLeak = sent
        .filter((m) => m.recipient && !isAllowlisted(m.recipient, settings.allowlist))
        .map((m) => ({ messageId: m.id, recipient: m.recipient }));
    }
  } catch { /* ignore */ }

  try {
    const dupActs = await sql<{ action: string; detail: string; n: number }>`
      select action, detail, count(*)::int as n
      from activity_log
      where user_id = ${userId}
        and created_at > now() - interval '20 minutes'
        and action in ('delete_owner_calendar_event', 'delete_owner_calendar_events_bulk', 'send_first_email')
      group by action, detail
      having count(*) > 1
    `;
    snap.duplicateActivity = dupActs.map((r) => ({ action: r.action, detail: r.detail, count: r.n }));
  } catch { /* ignore */ }

  try {
    const { listProspects } = await import("@/lib/prospects/repo.server");
    snap.prospects = await listProspects(userId);
  } catch { /* ignore */ }

  return snap;
}

export async function insertRun(row: {
  userId: string;
  mode: SentinelMode;
  environment: string;
  productionSha: string;
  previousSha: string;
  overall: string;
  summary: string;
  checkCount: number;
  findingCount: number;
  payload: unknown;
}): Promise<string> {
  const sql = await getSql();
  const id = newUid();
  const started = new Date().toISOString();
  await sql`
    insert into sentinel_runs (
      id, user_id, mode, environment, production_sha, previous_sha,
      started_at, finished_at, overall, summary, check_count, finding_count, payload
    ) values (
      ${id}, ${row.userId}, ${row.mode}, ${row.environment}, ${row.productionSha}, ${row.previousSha},
      ${started}, ${started}, ${row.overall}, ${row.summary}, ${row.checkCount}, ${row.findingCount},
      ${JSON.stringify(row.payload)}::jsonb
    )
  `;
  return id;
}

export async function upsertFindings(
  findings: SentinelFinding[],
  env: { environment: string; productionSha: string },
): Promise<SentinelBug[]> {
  const sql = await getSql();
  const out: SentinelBug[] = [];
  for (const f of findings) {
    const existing = await sql<{
      bug_id: string;
      occurrence_count: number;
      first_seen_at: unknown;
      status: string;
    }>`select bug_id, occurrence_count, first_seen_at, status from sentinel_bugs where signature = ${f.signature}`;
    const now = new Date().toISOString();
    if (existing[0]) {
      const count = mergeOccurrence(Number(existing[0].occurrence_count || 1));
      const status = existing[0].status === "resolved" ? "open" : existing[0].status;
      await sql`
        update sentinel_bugs set
          last_seen_at = ${now},
          occurrence_count = ${count},
          status = ${status},
          production_sha = ${env.productionSha},
          summary = ${f.summary},
          evidence = ${JSON.stringify(f.evidence || {})}::jsonb,
          resolved_at = null
        where signature = ${f.signature}
      `;
      out.push(await loadBug(f.signature) as SentinelBug);
      continue;
    }
    const bugId = `sen_${f.signature}`;
    await sql`
      insert into sentinel_bugs (
        bug_id, signature, first_seen_at, last_seen_at, status, severity, feature,
        environment, production_sha, error_code, summary, evidence, reproduction_steps,
        affected_records, occurrence_count
      ) values (
        ${bugId}, ${f.signature}, ${now}, ${now}, ${"open"}, ${f.severity}, ${f.feature},
        ${env.environment}, ${env.productionSha}, ${f.code}, ${f.summary},
        ${JSON.stringify(f.evidence || {})}::jsonb, ${f.reproduction || ""},
        ${JSON.stringify(f.affected || [])}::jsonb, ${1}
      )
    `;
    out.push(await loadBug(f.signature) as SentinelBug);
  }
  return out;
}

async function loadBug(signature: string): Promise<SentinelBug | null> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`select * from sentinel_bugs where signature = ${signature}`;
  const r = rows[0];
  if (!r) return null;
  return mapBug(r);
}

export async function resolveMissing(openSignatures: string[], productionSha: string): Promise<string[]> {
  const sql = await getSql();
  const open = await sql<{ signature: string; error_code: string; evidence: unknown }>`
    select signature, error_code, evidence from sentinel_bugs where status = 'open'
  `;
  const keep = new Set(openSignatures);
  const resolved: string[] = [];
  const now = new Date().toISOString();
  for (const row of open) {
    if (keep.has(row.signature)) continue;
    const prev = asRecord(row.evidence) || {};
    const evidence = {
      ...prev,
      resolved: true,
      resolved_at: now,
      fix_commit: productionSha,
      verification_status: "observed_clear",
    };
    await sql`
      update sentinel_bugs
      set status = ${"resolved"},
          verification_status = ${"observed_clear"},
          resolved_at = ${now},
          production_sha = ${productionSha},
          fix_commit = ${productionSha},
          evidence = ${JSON.stringify(evidence)}::jsonb
      where signature = ${row.signature} and status = 'open'
    `;
    resolved.push(row.error_code);
  }
  return resolved;
}

export async function listOpenBugs(): Promise<SentinelBug[]> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from sentinel_bugs where status in ('open', 'acknowledged') order by last_seen_at desc
  `;
  return rows.map(mapBug);
}

export async function latestRun(): Promise<SentinelRunRecord | null> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from sentinel_runs order by started_at desc limit 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id || ""),
    user_id: String(r.user_id || ""),
    mode: String(r.mode || "light") as SentinelMode,
    environment: String(r.environment || ""),
    production_sha: String(r.production_sha || ""),
    previous_sha: String(r.previous_sha || ""),
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at) || null,
    overall: (String(r.overall || "unknown") as SentinelRunRecord["overall"]),
    summary: String(r.summary || ""),
    check_count: Number(r.check_count || 0),
    finding_count: Number(r.finding_count || 0),
  };
}

export async function touchHeartbeat(name: string, ok: boolean, code: string, detail: string): Promise<void> {
  const sql = await getSql();
  const now = new Date().toISOString();
  if (ok) {
    await sql`
      insert into sentinel_heartbeats (name, last_ok_at, last_check_at, last_code, last_detail, observed_ok)
      values (${name}, ${now}, ${now}, ${code}, ${detail}, ${true})
      on conflict (name) do update set
        last_ok_at = excluded.last_ok_at,
        last_check_at = excluded.last_check_at,
        last_code = excluded.last_code,
        last_detail = excluded.last_detail,
        observed_ok = true
    `;
    return;
  }
  await sql`
    insert into sentinel_heartbeats (name, last_check_at, last_code, last_detail, observed_ok)
    values (${name}, ${now}, ${code}, ${detail}, ${false})
    on conflict (name) do update set
      last_check_at = excluded.last_check_at,
      last_code = excluded.last_code,
      last_detail = excluded.last_detail,
      observed_ok = false
  `;
}

export async function loadHeartbeats(): Promise<Record<string, { lastOkAt: string | null; observedOk: boolean; lastCheckAt: string | null; lastCode: string }>> {
  const sql = await getSql();
  const rows = await sql<{ name: string; last_ok_at: unknown; observed_ok: boolean; last_check_at: unknown; last_code: string }>`
    select name, last_ok_at, observed_ok, last_check_at, last_code from sentinel_heartbeats
  `;
  const out: Record<string, { lastOkAt: string | null; observedOk: boolean; lastCheckAt: string | null; lastCode: string }> = {};
  for (const r of rows) {
    out[r.name] = {
      lastOkAt: iso(r.last_ok_at) || null,
      observedOk: Boolean(r.observed_ok),
      lastCheckAt: iso(r.last_check_at) || null,
      lastCode: r.last_code || "",
    };
  }
  return out;
}

export async function recordDeployment(row: {
  previousSha: string;
  newSha: string;
  testResult: string;
  smokeResult: string;
  newErrors: string[];
  resolvedErrors: string[];
  rollbackRecommended: boolean;
  rollbackReason: string;
  knownGoodSha: string;
}): Promise<void> {
  const sql = await getSql();
  const id = newUid();
  await sql`
    insert into sentinel_deployments (
      id, previous_sha, new_sha, test_result, smoke_result, new_errors, resolved_errors,
      rollback_recommended, rollback_reason, known_good_sha
    ) values (
      ${id}, ${row.previousSha}, ${row.newSha}, ${row.testResult}, ${row.smokeResult},
      ${JSON.stringify(row.newErrors)}::jsonb, ${JSON.stringify(row.resolvedErrors)}::jsonb,
      ${row.rollbackRecommended}, ${row.rollbackReason}, ${row.knownGoodSha}
    )
  `;
}

export async function latestDeployment(): Promise<SentinelDeployment | null> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from sentinel_deployments order by recorded_at desc limit 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id || ""),
    previous_sha: String(r.previous_sha || ""),
    new_sha: String(r.new_sha || ""),
    recorded_at: iso(r.recorded_at),
    test_result: String(r.test_result || ""),
    smoke_result: String(r.smoke_result || ""),
    new_errors: asStringArray(r.new_errors),
    resolved_errors: asStringArray(r.resolved_errors),
    rollback_recommended: Boolean(r.rollback_recommended),
    rollback_reason: String(r.rollback_reason || ""),
    known_good_sha: String(r.known_good_sha || ""),
  };
}

export async function lastKnownGoodSha(): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ production_sha: string }>`
    select production_sha from sentinel_runs
    where overall = 'healthy' and production_sha <> ''
    order by started_at desc
    limit 1
  `;
  return rows[0]?.production_sha || "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  return {};
}

function asRecordArray(value: unknown): Array<Record<string, string>> {
  const raw = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const rec = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = String(v);
    return out;
  });
}

function mapBug(r: Record<string, unknown>): SentinelBug {
  return {
    bug_id: String(r.bug_id || ""),
    signature: String(r.signature || ""),
    first_seen_at: iso(r.first_seen_at),
    last_seen_at: iso(r.last_seen_at),
    status: (String(r.status || "open") as SentinelBug["status"]),
    severity: String(r.severity || "medium") as SentinelSeverity,
    feature: String(r.feature || "sentinel") as SentinelFeature,
    environment: String(r.environment || ""),
    production_sha: String(r.production_sha || ""),
    error_code: String(r.error_code || "SENTINEL_OK") as SentinelCode,
    summary: String(r.summary || ""),
    evidence: serialEvidence(asRecord(r.evidence)),
    reproduction_steps: String(r.reproduction_steps || ""),
    affected_records: asRecordArray(r.affected_records),
    suspected_commit: String(r.suspected_commit || ""),
    regression_test: String(r.regression_test || ""),
    fix_branch: String(r.fix_branch || ""),
    fix_commit: String(r.fix_commit || ""),
    verification_status: String(r.verification_status || ""),
    occurrence_count: Number(r.occurrence_count || 1),
    resolved_at: iso(r.resolved_at) || null,
  };
}
