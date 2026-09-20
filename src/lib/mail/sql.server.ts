import { getSql, withSqlTransaction } from "@/lib/db";
import { decryptSecret, encryptSecret } from "./crypto";
import { mintOauthState, type OauthKind, type OauthStateRecord } from "./oauth-state";
import type { GoogleTokens } from "../google/oauth";
import { newUid } from "../prospects/ids";

export async function saveOauthState(userId: string, kind: OauthKind): Promise<OauthStateRecord> {
  const rec = mintOauthState(userId, kind);
  const sql = await getSql();
  await sql`
    insert into oauth_states (state, user_id, kind, nonce, expires_at)
    values (${rec.state}, ${userId}, ${kind}, ${rec.nonce}, ${new Date(rec.expiresAt).toISOString()})
  `;
  return rec;
}

export async function takeOauthState(state: string): Promise<OauthStateRecord | null> {
  const sql = await getSql();
  const rows = await sql<{ state: string; user_id: string; kind: OauthKind; nonce: string; expires_at: string; used_at: string | null }>`
    update oauth_states
    set used_at = now()
    where state = ${state} and used_at is null and expires_at > now()
    returning state, user_id, kind, nonce, expires_at, used_at
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    state: row.state,
    userId: row.user_id,
    kind: row.kind,
    nonce: row.nonce,
    expiresAt: new Date(row.expires_at).getTime(),
    usedAt: row.used_at ? new Date(row.used_at).getTime() : Date.now(),
  };
}

export async function saveGoogleAccount(userId: string, kind: OauthKind, tokens: GoogleTokens): Promise<void> {
  const blob = encryptSecret(JSON.stringify(tokens));
  const sql = await getSql();
  const id = `${userId}:${kind}`;
  await sql`
    insert into google_accounts (id, user_id, kind, google_sub, email, scopes, token_ciphertext, token_iv, token_tag, status, last_error)
    values (${id}, ${userId}, ${kind}, ${tokens.sub || ""}, ${tokens.email || ""}, ${tokens.scope || ""}, ${blob.ciphertext}, ${blob.iv}, ${blob.tag}, ${"connected"}, ${""})
    on conflict (user_id, kind) do update set
      google_sub = excluded.google_sub,
      email = excluded.email,
      scopes = excluded.scopes,
      token_ciphertext = excluded.token_ciphertext,
      token_iv = excluded.token_iv,
      token_tag = excluded.token_tag,
      status = 'connected',
      last_error = '',
      updated_at = now()
  `;
}

export async function googleStatus(userId: string): Promise<{
  gmail: "connected" | "missing" | "attention";
  calendar: "connected" | "missing" | "attention";
  gmailEmail: string;
  calendarEmail: string;
  error: string;
}> {
  const sql = await getSql();
  const rows = await sql<{ kind: string; status: string; email: string; last_error: string }>`
    select kind, status, email, last_error from google_accounts where user_id = ${userId}
  `;
  const gmail = rows.find((r) => r.kind === "gmail");
  const cal = rows.find((r) => r.kind === "calendar");
  return {
    gmail: !gmail ? "missing" : gmail.status === "connected" ? "connected" : "attention",
    calendar: !cal ? "missing" : cal.status === "connected" ? "connected" : "attention",
    gmailEmail: gmail?.email || "",
    calendarEmail: cal?.email || "",
    error: gmail?.last_error || cal?.last_error || "",
  };
}

export async function disconnectGoogle(userId: string, kind: OauthKind): Promise<void> {
  const sql = await getSql();
  await sql`delete from google_accounts where user_id = ${userId} and kind = ${kind}`;
}

export async function loadTokens(userId: string, kind: OauthKind): Promise<GoogleTokens | null> {
  const sql = await getSql();
  const rows = await sql<{ token_ciphertext: string; token_iv: string; token_tag: string; status: string }>`
    select token_ciphertext, token_iv, token_tag, status from google_accounts
    where user_id = ${userId} and kind = ${kind} limit 1
  `;
  const row = rows[0];
  if (!row || row.status !== "connected") return null;
  try {
    return JSON.parse(decryptSecret({ ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag })) as GoogleTokens;
  } catch {
    return null;
  }
}

export async function markGoogleError(userId: string, kind: OauthKind, message: string): Promise<void> {
  const sql = await getSql();
  await sql`update google_accounts set status = 'attention', last_error = ${message}, updated_at = now() where user_id = ${userId} and kind = ${kind}`;
}

export async function insertMessage(row: {
  userId: string;
  prospectUid: string;
  threadId?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  direction: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  kind: string;
  idempotencyKey: string;
  inputMethod: string;
  sequenceId?: string | null;
  sentAt?: string | null;
}): Promise<"ok" | "duplicate"> {
  const sql = await getSql();
  const id = newUid();
  try {
    await sql`
      insert into email_messages (
        id, user_id, prospect_uid, thread_id, gmail_message_id, gmail_thread_id, direction, recipient, subject, body, status, kind, idempotency_key, input_method, sequence_id, sent_at
      ) values (
        ${id}, ${row.userId}, ${row.prospectUid}, ${row.threadId || null}, ${row.gmailMessageId || null}, ${row.gmailThreadId || null},
        ${row.direction}, ${row.recipient}, ${row.subject}, ${row.body}, ${row.status}, ${row.kind}, ${row.idempotencyKey}, ${row.inputMethod}, ${row.sequenceId || null}, ${row.sentAt || null}
      )
    `;
    return "ok";
  } catch {
    return "duplicate";
  }
}

export async function updateMessageStatus(userId: string, idempotencyKey: string, status: string, gmailMessageId?: string, gmailThreadId?: string): Promise<void> {
  const sql = await getSql();
  await sql`
    update email_messages
    set status = ${status}, gmail_message_id = coalesce(${gmailMessageId || null}, gmail_message_id), gmail_thread_id = coalesce(${gmailThreadId || null}, gmail_thread_id), sent_at = case when ${status} = 'SENT' then now() else sent_at end
    where user_id = ${userId} and idempotency_key = ${idempotencyKey}
  `;
}

export async function hasKey(userId: string, key: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`select count(*)::int as n from email_messages where user_id = ${userId} and idempotency_key = ${key} and status in ('SENT','SENDING')`;
  return Number(rows[0]?.n || 0) > 0;
}

export async function audit(userId: string, action: string, detail: string, extra?: { prospectUid?: string; method?: string; sequenceId?: string; providerIds?: string }): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into outreach_audit (id, user_id, prospect_uid, action, detail, input_method, sequence_id, provider_ids)
    values (${newUid()}, ${userId}, ${extra?.prospectUid || null}, ${action}, ${detail}, ${extra?.method || "MANUAL"}, ${extra?.sequenceId || null}, ${extra?.providerIds || ""})
  `;
}

export async function bumpUsage(userId: string, kind: "first" | "followup"): Promise<void> {
  const sql = await getSql();
  const day = new Date().toISOString().slice(0, 10);
  if (kind === "first") {
    await sql`
      insert into outreach_usage (user_id, day, first_sends, followup_sends) values (${userId}, ${day}, 1, 0)
      on conflict (user_id, day) do update set first_sends = outreach_usage.first_sends + 1
    `;
  } else {
    await sql`
      insert into outreach_usage (user_id, day, first_sends, followup_sends) values (${userId}, ${day}, 0, 1)
      on conflict (user_id, day) do update set followup_sends = outreach_usage.followup_sends + 1
    `;
  }
}

export async function getUsage(userId: string): Promise<{ first: number; followups: number }> {
  const sql = await getSql();
  const day = new Date().toISOString().slice(0, 10);
  const rows = await sql<{ first_sends: number; followup_sends: number }>`
    select first_sends, followup_sends from outreach_usage where user_id = ${userId} and day = ${day}
  `;
  return { first: Number(rows[0]?.first_sends || 0), followups: Number(rows[0]?.followup_sends || 0) };
}

export async function saveSequence(userId: string, prospectUid: string, method: string, followups: { step: string; dueAt: number; idempotencyKey: string; body: string; subject: string; recipient: string; threadId?: string | null }[]): Promise<string> {
  const { contentHash } = await import("./snapshot");
  return withSqlTransaction(async (sql) => {
    await sql`update outreach_sequences set status = 'stopped' where user_id = ${userId} and prospect_uid = ${prospectUid} and status = 'active'`;
    await sql`update scheduled_followups set status = 'cancelled' where user_id = ${userId} and prospect_uid = ${prospectUid} and status in ('scheduled','sending')`;
    const id = `${userId}:${prospectUid}:seq:${Date.now()}`;
    await sql`
      insert into outreach_sequences (id, user_id, prospect_uid, status, approved_method)
      values (${id}, ${userId}, ${prospectUid}, ${"active"}, ${method})
    `;
    const approvedAt = new Date().toISOString();
    for (const f of followups) {
      const hash = contentHash(f.recipient, f.subject, f.body);
      await sql`
        insert into scheduled_followups (
          id, user_id, prospect_uid, sequence_id, step, due_at, status, attempt_count, idempotency_key, gmail_thread_id,
          recipient, subject, body, approved_at, content_hash
        ) values (
          ${newUid()}, ${userId}, ${prospectUid}, ${id}, ${f.step}, ${new Date(f.dueAt).toISOString()}, ${"scheduled"}, 0, ${f.idempotencyKey}, ${f.threadId || null},
          ${f.recipient}, ${f.subject}, ${f.body}, ${approvedAt}, ${hash}
        )
      `;
    }
    return id;
  });
}

export async function stopSequencesForProspect(userId: string, prospectUid: string): Promise<void> {
  const sql = await getSql();
  await sql`update outreach_sequences set status = 'stopped' where user_id = ${userId} and prospect_uid = ${prospectUid} and status = 'active'`;
  await sql`update scheduled_followups set status = 'cancelled' where user_id = ${userId} and prospect_uid = ${prospectUid} and status in ('scheduled','sending')`;
}

export async function claimDueFollowups(now = new Date()): Promise<{
  id: string;
  user_id: string;
  prospect_uid: string;
  sequence_id: string;
  step: string;
  idempotency_key: string;
  gmail_thread_id: string | null;
  recipient: string;
  subject: string;
  body: string;
  content_hash: string;
}[]> {
  return withSqlTransaction(async (sql) => {
    const rows = await sql<{
      id: string;
      user_id: string;
      prospect_uid: string;
      sequence_id: string;
      step: string;
      idempotency_key: string;
      gmail_thread_id: string | null;
      recipient: string;
      subject: string;
      body: string;
      content_hash: string;
    }>`
      select id, user_id, prospect_uid, sequence_id, step, idempotency_key, gmail_thread_id, recipient, subject, body, content_hash
      from scheduled_followups
      where status = 'scheduled' and due_at <= ${now.toISOString()}
      order by due_at asc
      limit 20
    `;
    const claimed = [];
    for (const r of rows) {
      const upd = await sql<{ id: string }>`
        update scheduled_followups
        set status = 'sending', claimed_at = now(), attempt_count = attempt_count + 1
        where id = ${r.id} and status = 'scheduled'
        returning id
      `;
      if (upd.length) claimed.push(r);
    }
    return claimed;
  });
}

export async function finishFollowup(id: string, status: "sent" | "failed" | "cancelled" | "scheduled", dueAt?: Date): Promise<void> {
  const sql = await getSql();
  if (status === "scheduled" && dueAt) {
    await sql`update scheduled_followups set status = 'scheduled', due_at = ${dueAt.toISOString()}, claimed_at = null where id = ${id}`;
    return;
  }
  await sql`update scheduled_followups set status = ${status} where id = ${id}`;
}

export async function activeSequence(userId: string, prospectUid: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`select count(*)::int as n from outreach_sequences where user_id = ${userId} and prospect_uid = ${prospectUid} and status = 'active'`;
  return Number(rows[0]?.n || 0) > 0;
}

export async function lastThread(userId: string, prospectUid: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{ gmail_thread_id: string | null }>`
    select gmail_thread_id from email_messages
    where user_id = ${userId} and prospect_uid = ${prospectUid} and gmail_thread_id is not null
    order by created_at desc limit 1
  `;
  return rows[0]?.gmail_thread_id || null;
}

export async function salesCounts(userId: string): Promise<{ ready: number; followups: number; replies: number; calls: number }> {
  const sql = await getSql();
  const ready = await sql<{ n: number }>`select count(*)::int as n from prospects where user_id = ${userId} and stage = 'Approved for Outreach' and suppressed = false and uid <> ${"test-sales-flow"}`;
  const followups = await sql<{ n: number }>`select count(*)::int as n from scheduled_followups where user_id = ${userId} and status = 'scheduled' and prospect_uid <> ${"test-sales-flow"}`;
  const replies = await sql<{ n: number }>`select count(*)::int as n from reply_events r where r.user_id = ${userId} and r.prospect_uid <> ${"test-sales-flow"}`;
  const calls = await sql<{ n: number }>`select count(*)::int as n from calendar_events where user_id = ${userId} and status = 'booked' and prospect_uid <> ${"test-sales-flow"}`;
  return {
    ready: Number(ready[0]?.n || 0),
    followups: Number(followups[0]?.n || 0),
    replies: Number(replies[0]?.n || 0),
    calls: Number(calls[0]?.n || 0),
  };
}

export async function insertReply(userId: string, prospectUid: string, gmailMessageId: string, classification: string, body: string): Promise<"ok" | "duplicate"> {
  const sql = await getSql();
  try {
    await sql`
      insert into reply_events (id, user_id, prospect_uid, gmail_message_id, classification, body)
      values (${newUid()}, ${userId}, ${prospectUid}, ${gmailMessageId}, ${classification}, ${body})
    `;
    return "ok";
  } catch {
    return "duplicate";
  }
}

export async function saveCalendarEvent(userId: string, prospectUid: string, googleEventId: string, title: string, start: Date, end: Date): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into calendar_events (id, user_id, prospect_uid, google_event_id, title, start_at, end_at, status)
    values (${newUid()}, ${userId}, ${prospectUid}, ${googleEventId}, ${title}, ${start.toISOString()}, ${end.toISOString()}, ${"booked"})
  `;
}

export async function createBookingLink(userId: string, prospectUid: string): Promise<string> {
  const sql = await getSql();
  const token = newUid();
  const expires = new Date(Date.now() + 14 * 86400000).toISOString();
  await sql`insert into booking_links (token, user_id, prospect_uid, status, expires_at) values (${token}, ${userId}, ${prospectUid}, ${"open"}, ${expires})`;
  return token;
}

export async function getBookingLink(token: string): Promise<{ user_id: string; prospect_uid: string; status: string; expires_at?: string } | null> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string; prospect_uid: string; status: string; expires_at: string | null }>`
    select user_id, prospect_uid, status, expires_at from booking_links where token = ${token}
  `;
  const row = rows[0];
  if (!row) return null;
  return { user_id: row.user_id, prospect_uid: row.prospect_uid, status: row.status, expires_at: row.expires_at || undefined };
}

export async function claimBookingLink(token: string): Promise<{ user_id: string; prospect_uid: string } | null> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string; prospect_uid: string }>`
    update booking_links
    set status = 'booking'
    where token = ${token} and status = 'open' and (expires_at is null or expires_at > now())
    returning user_id, prospect_uid
  `;
  return rows[0] || null;
}

export async function finishBookingLink(token: string, status: "used" | "open"): Promise<void> {
  const sql = await getSql();
  await sql`update booking_links set status = ${status} where token = ${token}`;
}

export async function listOpenThreads(userId: string): Promise<{ prospect_uid: string; gmail_thread_id: string }[]> {
  const sql = await getSql();
  return sql<{ prospect_uid: string; gmail_thread_id: string }>`
    select distinct prospect_uid, gmail_thread_id from email_messages
    where user_id = ${userId} and gmail_thread_id is not null and status = 'SENT'
  `;
}

export async function seenReplyIds(userId: string): Promise<Set<string>> {
  const sql = await getSql();
  const rows = await sql<{ gmail_message_id: string | null }>`select gmail_message_id from reply_events where user_id = ${userId}`;
  return new Set(rows.map((r) => r.gmail_message_id).filter(Boolean) as string[]);
}

export async function timeline(userId: string, prospectUid: string): Promise<{ at: string; action: string; detail: string }[]> {
  const sql = await getSql();
  const rows = await sql<{ created_at: string; action: string; detail: string }>`
    select created_at, action, detail from outreach_audit
    where user_id = ${userId} and prospect_uid = ${prospectUid}
    order by created_at asc
  `;
  return rows.map((r) => ({ at: r.created_at, action: r.action, detail: r.detail }));
}

export async function nextCall(userId: string): Promise<{ prospect_uid: string; start_at: string; title: string } | null> {
  const sql = await getSql();
  const rows = await sql<{ prospect_uid: string; start_at: string; title: string }>`
    select prospect_uid, start_at, title from calendar_events
    where user_id = ${userId} and status = 'booked' and start_at >= now()
    order by start_at asc limit 1
  `;
  return rows[0] || null;
}

export async function listCallsInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ id: string; prospect_uid: string; google_event_id: string | null; title: string; start_at: string; end_at: string; status: string }[]> {
  const sql = await getSql();
  return sql`
    select id, prospect_uid, google_event_id, title, start_at, end_at, status
    from calendar_events
    where user_id = ${userId}
      and start_at < ${to.toISOString()}
      and end_at > ${from.toISOString()}
    order by start_at asc
  `;
}

export async function outboundMessageIds(userId: string, prospectUid?: string): Promise<Set<string>> {
  const sql = await getSql();
  const rows = prospectUid
    ? await sql<{ gmail_message_id: string | null }>`
        select gmail_message_id from email_messages
        where user_id = ${userId} and prospect_uid = ${prospectUid} and direction = 'out' and gmail_message_id is not null
      `
    : await sql<{ gmail_message_id: string | null }>`
        select gmail_message_id from email_messages
        where user_id = ${userId} and direction = 'out' and gmail_message_id is not null
      `;
  return new Set(rows.map((r) => r.gmail_message_id).filter(Boolean) as string[]);
}

export async function listGmailUsers(): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`select distinct user_id from google_accounts where kind = 'gmail' and status = 'connected'`;
  return rows.map((r) => r.user_id);
}

export async function loadSettings(userId: string): Promise<{
  maxFirst: number;
  maxFollowups: number;
  minDelayMinutes: number;
  workStart: number;
  workEnd: number;
  workDays: number[];
  timezone: string;
  testMode: boolean;
  allowlist: string[];
}> {
  const sql = await getSql();
  await sql`
    insert into outreach_settings (user_id, max_first_per_day, max_followups_per_day, test_mode, test_allowlist)
    values (${userId}, 2, 3, true, '')
    on conflict (user_id) do nothing
  `;
  const rows = await sql<{
    max_first_per_day: number;
    max_followups_per_day: number;
    min_delay_minutes: number;
    work_start: number;
    work_end: number;
    work_days: string;
    timezone: string;
    test_mode: boolean;
    test_allowlist: string;
  }>`select * from outreach_settings where user_id = ${userId}`;
  const r = rows[0];
  const { parseAllowlist, readTestModeFlag } = await import("./test-mode");
  return {
    maxFirst: Number(r?.max_first_per_day ?? 2),
    maxFollowups: Number(r?.max_followups_per_day ?? 3),
    minDelayMinutes: Number(r?.min_delay_minutes ?? 20),
    workStart: Number(r?.work_start ?? 8),
    workEnd: Number(r?.work_end ?? 17),
    workDays: (r?.work_days || "1,2,3,4,5").split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n)),
    timezone: r?.timezone || "America/Chicago",
    testMode: readTestModeFlag(r?.test_mode),
    allowlist: parseAllowlist(r?.test_allowlist || ""),
  };
}

export async function saveTestSettings(userId: string, patch: { testMode?: boolean; allowlist?: string[] }): Promise<void> {
  const current = await loadSettings(userId);
  const testMode = patch.testMode ?? current.testMode;
  const allowlist = patch.allowlist ?? current.allowlist;
  const sql = await getSql();
  const capsFirst = testMode ? 2 : 15;
  const capsFollow = testMode ? 3 : 30;
  // Persist as 'true'/'false' text then cast — JS boolean false has been
  // dropped or misread by some drivers, which left Test Mode stuck on.
  const flag = testMode ? "true" : "false";
  await sql`
    insert into outreach_settings (user_id, max_first_per_day, max_followups_per_day, test_mode, test_allowlist)
    values (${userId}, ${capsFirst}, ${capsFollow}, ${flag}::boolean, ${allowlist.join(",")})
    on conflict (user_id) do update set
      test_mode = excluded.test_mode,
      test_allowlist = excluded.test_allowlist,
      max_first_per_day = excluded.max_first_per_day,
      max_followups_per_day = excluded.max_followups_per_day
  `;
}

export async function countScheduledFollowups(userId: string, prospectUid: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from scheduled_followups
    where user_id = ${userId} and prospect_uid = ${prospectUid} and status in ('scheduled','sending')
  `;
  return Number(rows[0]?.n || 0);
}

export type SalesTestState = {
  recipient: string;
  prospect_uid: string | null;
  message_id: string | null;
  thread_id: string | null;
  sequence_id: string | null;
  followups_before: number;
  reply_count: number;
  followups_after: number | null;
  booking_token: string | null;
  event_id: string | null;
  slots_offered: number;
  pipeline_stage: string | null;
  step: number;
  worker_run_id: string | null;
  worker_seen_at: string | null;
};

export async function loadTestState(userId: string): Promise<SalesTestState> {
  const sql = await getSql();
  const rows = await sql<SalesTestState>`select * from sales_test_state where user_id = ${userId}`;
  const r = rows[0];
  return {
    recipient: r?.recipient || "",
    prospect_uid: r?.prospect_uid || null,
    message_id: r?.message_id || null,
    thread_id: r?.thread_id || null,
    sequence_id: r?.sequence_id || null,
    followups_before: Number(r?.followups_before || 0),
    reply_count: Number(r?.reply_count || 0),
    followups_after: r?.followups_after == null ? null : Number(r.followups_after),
    booking_token: r?.booking_token || null,
    event_id: r?.event_id || null,
    slots_offered: Number(r?.slots_offered || 0),
    pipeline_stage: r?.pipeline_stage || null,
    step: Number(r?.step || 1),
    worker_run_id: r?.worker_run_id || null,
    worker_seen_at: r?.worker_seen_at || null,
  };
}

export async function saveTestState(userId: string, patch: Partial<SalesTestState>): Promise<SalesTestState> {
  const cur = await loadTestState(userId);
  const next: SalesTestState = { ...cur, ...patch };
  const sql = await getSql();
  await sql`
    insert into sales_test_state (
      user_id, recipient, prospect_uid, message_id, thread_id, sequence_id,
      followups_before, reply_count, followups_after, booking_token, event_id,
      slots_offered, pipeline_stage, step, worker_run_id, worker_seen_at, updated_at
    ) values (
      ${userId}, ${next.recipient}, ${next.prospect_uid}, ${next.message_id}, ${next.thread_id}, ${next.sequence_id},
      ${next.followups_before}, ${next.reply_count}, ${next.followups_after}, ${next.booking_token}, ${next.event_id},
      ${next.slots_offered}, ${next.pipeline_stage}, ${next.step}, ${next.worker_run_id}, ${next.worker_seen_at}, now()
    )
    on conflict (user_id) do update set
      recipient = excluded.recipient,
      prospect_uid = excluded.prospect_uid,
      message_id = excluded.message_id,
      thread_id = excluded.thread_id,
      sequence_id = excluded.sequence_id,
      followups_before = excluded.followups_before,
      reply_count = excluded.reply_count,
      followups_after = excluded.followups_after,
      booking_token = excluded.booking_token,
      event_id = excluded.event_id,
      slots_offered = excluded.slots_offered,
      pipeline_stage = excluded.pipeline_stage,
      step = excluded.step,
      worker_run_id = excluded.worker_run_id,
      worker_seen_at = excluded.worker_seen_at,
      updated_at = now()
  `;
  return next;
}

export async function reserveSendKey(userId: string, key: string, row: {
  prospectUid: string;
  recipient: string;
  subject: string;
  body: string;
  kind: string;
  inputMethod: string;
  sequenceId?: string | null;
}): Promise<"won" | "lost"> {
  const sql = await getSql();
  try {
    await sql`
      insert into email_messages (
        id, user_id, prospect_uid, direction, recipient, subject, body, status, kind, idempotency_key, input_method, sequence_id
      ) values (
        ${newUid()}, ${userId}, ${row.prospectUid}, ${"out"}, ${row.recipient}, ${row.subject}, ${row.body}, ${"SENDING"}, ${row.kind}, ${key}, ${row.inputMethod}, ${row.sequenceId || null}
      )
    `;
    return "won";
  } catch {
    return "lost";
  }
}

export async function reserveSendCap(userId: string, kind: "first" | "followup", caps: { maxFirst: number; maxFollowups: number; minDelayMinutes: number }): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  return withSqlTransaction(async (sql) => {
    await sql`
      insert into outreach_usage (user_id, day, first_sends, followup_sends)
      values (${userId}, ${day}, 0, 0)
      on conflict (user_id, day) do nothing
    `;
    const last = await sql<{ last_sent_at: string | null }>`select last_sent_at from outreach_usage where user_id = ${userId} and day = ${day}`;
    if (last[0]?.last_sent_at) {
      const lag = Date.now() - new Date(last[0].last_sent_at).getTime();
      if (lag < caps.minDelayMinutes * 60 * 1000) return false;
    }
    if (kind === "first") {
      const upd = await sql<{ first_sends: number }>`
        update outreach_usage set first_sends = first_sends + 1, last_sent_at = now()
        where user_id = ${userId} and day = ${day} and first_sends < ${caps.maxFirst}
        returning first_sends
      `;
      return upd.length > 0;
    }
    const upd = await sql<{ followup_sends: number }>`
      update outreach_usage set followup_sends = followup_sends + 1, last_sent_at = now()
      where user_id = ${userId} and day = ${day} and followup_sends < ${caps.maxFollowups}
      returning followup_sends
    `;
    return upd.length > 0;
  });
}

export async function startWorkerHeartbeat(runId: string, source: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    insert into outreach_worker_heartbeat (id, last_started_at, run_id, source, last_result, last_error, updated_at)
    values ('global', now(), ${runId}, ${source}, ${"running"}, ${""}, now())
    on conflict (id) do update set
      last_started_at = now(),
      run_id = excluded.run_id,
      source = excluded.source,
      last_result = 'running',
      last_error = '',
      updated_at = now()
    where outreach_worker_heartbeat.last_result is distinct from 'running'
       or outreach_worker_heartbeat.last_started_at < now() - interval '4 minutes'
    returning id
  `;
  return rows.length > 0;
}

export async function finishWorkerHeartbeat(runId: string, result: string, error = ""): Promise<void> {
  const sql = await getSql();
  await sql`
    update outreach_worker_heartbeat
    set last_completed_at = now(), last_result = ${result}, last_error = ${error}, run_id = ${runId}, updated_at = now()
    where id = 'global'
  `;
}

export async function loadWorkerHeartbeat(): Promise<{
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  lastResult: string;
  runId: string | null;
  source: string;
}> {
  const sql = await getSql();
  const rows = await sql<{
    last_started_at: string | null;
    last_completed_at: string | null;
    last_result: string;
    run_id: string | null;
    source: string;
  }>`select last_started_at, last_completed_at, last_result, run_id, source from outreach_worker_heartbeat where id = 'global'`;
  const r = rows[0];
  return {
    lastStartedAt: r?.last_started_at ? new Date(r.last_started_at).getTime() : null,
    lastCompletedAt: r?.last_completed_at ? new Date(r.last_completed_at).getTime() : null,
    lastResult: r?.last_result || "",
    runId: r?.run_id || null,
    source: r?.source || "",
  };
}

export async function loadTestLoop(userId: string): Promise<{
  recipient: string;
  allowlisted: boolean;
  initialSent: boolean;
  followupScheduled: boolean;
  followupDueAt: string | null;
  followupSent: boolean;
  pendingFollowups: number;
  replyCount: number;
  sequenceStopped: boolean;
  trail: { at: string; action: string; detail: string }[];
}> {
  const { isAllowlisted } = await import("./test-mode");
  const { TEST_WORKFLOW_UID } = await import("./test-loop");
  const settings = await loadSettings(userId);
  const state = await loadTestState(userId);
  const sql = await getSql();
  const uid = state.prospect_uid || TEST_WORKFLOW_UID;
  const sentFirst = await sql<{ n: number }>`
    select count(*)::int as n from email_messages
    where user_id = ${userId} and prospect_uid = ${uid} and kind = 'email' and status = 'SENT'
  `;
  const sentFollow = await sql<{ n: number }>`
    select count(*)::int as n from scheduled_followups
    where user_id = ${userId} and prospect_uid = ${uid} and status = 'sent'
  `;
  const pending = await sql<{ n: number }>`
    select count(*)::int as n from scheduled_followups
    where user_id = ${userId} and prospect_uid = ${uid} and status in ('scheduled','sending')
  `;
  const due = await sql<{ due_at: string | Date | null }>`
    select min(due_at) as due_at from scheduled_followups
    where user_id = ${userId} and prospect_uid = ${uid} and status = 'scheduled'
  `;
  const replies = await sql<{ n: number }>`
    select count(*)::int as n from reply_events
    where user_id = ${userId} and prospect_uid = ${uid}
  `;
  const stopped = await sql<{ n: number }>`
    select count(*)::int as n from outreach_sequences
    where user_id = ${userId} and prospect_uid = ${uid} and status = 'stopped'
  `;
  const recipient = state.recipient || "";
  return {
    recipient,
    allowlisted: Boolean(recipient) && isAllowlisted(recipient, settings.allowlist),
    initialSent: Number(sentFirst[0]?.n || 0) > 0 || Boolean(state.message_id),
    followupScheduled: Number(pending[0]?.n || 0) > 0 || Number(sentFollow[0]?.n || 0) > 0 || Boolean(state.sequence_id),
    followupDueAt: due[0]?.due_at ? new Date(due[0].due_at).toISOString() : null,
    followupSent: Number(sentFollow[0]?.n || 0) > 0,
    pendingFollowups: Number(pending[0]?.n || 0),
    replyCount: Number(replies[0]?.n || 0),
    sequenceStopped: Number(stopped[0]?.n || 0) > 0,
    trail: await timeline(userId, uid),
  };
}

export async function markTestWorkflowSeen(runId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select distinct user_id from scheduled_followups
    where prospect_uid = ${"test-sales-flow"} and status in ('scheduled','sending','sent','cancelled')
  `;
  const seq = await sql<{ user_id: string }>`
    select distinct user_id from outreach_sequences where prospect_uid = ${"test-sales-flow"}
  `;
  const users = new Set([...rows, ...seq].map((r) => r.user_id));
  const seenAt = new Date().toISOString();
  for (const userId of users) {
    await saveTestState(userId, { worker_run_id: runId, worker_seen_at: seenAt });
  }
  return users.size;
}


