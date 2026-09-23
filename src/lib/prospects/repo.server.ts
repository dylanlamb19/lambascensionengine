/**
 * Server-only prospect storage. Every query is scoped to the verified userId
 * argument — never a client-supplied user_id column from the request body.
 */
import { getSql } from "@/lib/db";
import type { Prospect } from "@/lib/review-brief";
import { promotedStageForBooking } from "@/lib/mail/booking-stage";
import { isTestWorkflowUid } from "@/lib/mail/test-loop";
import { importWithoutDuplicates } from "./dedupe";
import { ensureUid, websiteDomain } from "./ids";

type Row = {
  uid: string;
  user_id: string;
  client_id: number;
  provider: string;
  provider_place_id: string | null;
  website_domain: string | null;
  name: string;
  vertical: string;
  city: string;
  stage: string;
  research_status: string;
  suppressed: boolean;
  payload: Prospect | string;
};

function rowToProspect(row: Row): Prospect {
  const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Prospect) : row.payload;
  return {
    ...payload,
    id: Number(row.client_id),
    uid: row.uid,
    provider: row.provider || payload.provider || "manual",
    provider_place_id: row.provider_place_id || payload.provider_place_id || "",
    name: row.name || payload.name,
    vertical: row.vertical || payload.vertical,
    city: row.city || payload.city,
    stage: row.stage || payload.stage,
    research_status: row.research_status || payload.research_status,
    suppressed: Boolean(row.suppressed),
  };
}

export async function listProspects(userId: string): Promise<Prospect[]> {
  const sql = await getSql();
  const rows = await sql<Row>`
    select uid, user_id, client_id, provider, provider_place_id, website_domain, name, vertical, city, stage, research_status, suppressed, payload
    from prospects
    where user_id = ${userId}
    order by client_id asc
  `;
  return rows.map(rowToProspect);
}

export async function getProspectByUid(userId: string, uid: string): Promise<Prospect | null> {
  const sql = await getSql();
  const rows = await sql<Row>`
    select uid, user_id, client_id, provider, provider_place_id, website_domain, name, vertical, city, stage, research_status, suppressed, payload
    from prospects
    where user_id = ${userId} and uid = ${uid}
    limit 1
  `;
  return rows[0] ? rowToProspect(rows[0]) : null;
}

async function hasBookedGoogleEvent(userId: string, uid: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql<{ n: number }>`
      select 1 as n from calendar_events
      where user_id = ${userId} and prospect_uid = ${uid}
        and status = 'booked'
        and google_event_id is not null and google_event_id <> ''
      limit 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function writeOne(userId: string, p: Prospect): Promise<void> {
  let ready = ensureUid(p);
  const promoted = promotedStageForBooking(ready.stage);
  if (promoted && await hasBookedGoogleEvent(userId, ready.uid)) {
    ready = {
      ...ready,
      stage: promoted,
      stage_plain: isTestWorkflowUid(ready.uid) ? "Test call booked" : "Call is on the calendar",
    };
  }
  const sql = await getSql();
  const payload = JSON.stringify({ ...ready, uid: ready.uid });
  await sql`
    insert into prospects (
      uid, user_id, client_id, provider, provider_place_id, website_domain, name, vertical, city, stage, research_status, suppressed, payload, updated_at
    ) values (
      ${ready.uid},
      ${userId},
      ${ready.id},
      ${ready.provider || "manual"},
      ${ready.provider_place_id || null},
      ${websiteDomain(ready.website) || null},
      ${ready.name},
      ${ready.vertical || ""},
      ${ready.city || ""},
      ${ready.stage || "New"},
      ${ready.research_status || "none"},
      ${Boolean(ready.suppressed)},
      ${payload}::jsonb,
      now()
    )
    on conflict (user_id, uid) do update set
      client_id = excluded.client_id,
      provider = excluded.provider,
      provider_place_id = excluded.provider_place_id,
      website_domain = excluded.website_domain,
      name = excluded.name,
      vertical = excluded.vertical,
      city = excluded.city,
      stage = excluded.stage,
      research_status = excluded.research_status,
      suppressed = excluded.suppressed,
      payload = excluded.payload,
      updated_at = now()
  `;
}

export async function upsertProspects(userId: string, incoming: Prospect[]): Promise<Prospect[]> {
  for (const p of incoming) {
    await writeOne(userId, p);
  }
  return listProspects(userId);
}

export async function importProspects(userId: string, incoming: Prospect[]): Promise<{ prospects: Prospect[]; imported: number; merged: number }> {
  const existing = await listProspects(userId);
  const { next, imported, merged } = importWithoutDuplicates(existing, incoming);
  for (const p of next) {
    await writeOne(userId, p);
  }
  const prospects = await listProspects(userId);
  return { prospects, imported: imported.length, merged: merged.length };
}

export async function logActivity(
  userId: string,
  action: string,
  detail: string,
  prospectUid?: string,
  inputMethod: "MANUAL" | "VOICE" | "AUTOMATION" = "MANUAL",
): Promise<void> {
  const sql = await getSql();
  const id = `${userId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await sql`
    insert into activity_log (id, user_id, prospect_uid, action, detail, input_method)
    values (${id}, ${userId}, ${prospectUid || null}, ${action}, ${detail}, ${inputMethod})
  `;
}
