/**
 * Server-only Industry Attack + owner goal storage.
 * Every query is scoped to the verified userId — never a client-supplied user_id.
 */
import { getSql } from "@/lib/db";
import type { IndustryAttack, OwnerGoal } from "./types.ts";

type AttackRow = {
  id: string;
  user_id: string;
  industry: string;
  geography: string;
  status: string;
  payload: IndustryAttack | string;
  created_at: string;
  updated_at: string;
};

type GoalRow = {
  user_id: string;
  monthly_mrr_target: number | null;
  average_retainer_target: number | null;
  payload: OwnerGoal | string;
  updated_at: string;
};

function asAttack(row: AttackRow): IndustryAttack {
  const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as IndustryAttack) : row.payload;
  return {
    ...payload,
    id: row.id,
    industry: row.industry || payload.industry,
    geography: row.geography || payload.geography || "",
    status: (row.status || payload.status || "researching") as IndustryAttack["status"],
    created_at: payload.created_at || String(row.created_at),
    updated_at: payload.updated_at || String(row.updated_at),
  };
}

export async function listAttacks(userId: string): Promise<IndustryAttack[]> {
  const sql = await getSql();
  const rows = await sql<AttackRow>`
    select id, user_id, industry, geography, status, payload, created_at, updated_at
    from industry_attacks
    where user_id = ${userId}
    order by updated_at desc
  `;
  return rows.map(asAttack);
}

export async function getAttack(userId: string, id: string): Promise<IndustryAttack | null> {
  const sql = await getSql();
  const rows = await sql<AttackRow>`
    select id, user_id, industry, geography, status, payload, created_at, updated_at
    from industry_attacks
    where user_id = ${userId} and id = ${id}
    limit 1
  `;
  return rows[0] ? asAttack(rows[0]) : null;
}

export async function upsertAttack(userId: string, attack: IndustryAttack): Promise<IndustryAttack> {
  const sql = await getSql();
  const now = new Date().toISOString();
  const next: IndustryAttack = { ...attack, updated_at: now };
  const payload = JSON.stringify(next);
  await sql`
    insert into industry_attacks (id, user_id, industry, geography, status, payload, created_at, updated_at)
    values (
      ${next.id},
      ${userId},
      ${next.industry},
      ${next.geography || ""},
      ${next.status},
      ${payload}::jsonb,
      ${next.created_at || now},
      ${now}
    )
    on conflict (user_id, id) do update set
      industry = excluded.industry,
      geography = excluded.geography,
      status = excluded.status,
      payload = excluded.payload,
      updated_at = now()
  `;
  return next;
}

export async function getGoal(userId: string): Promise<OwnerGoal> {
  const sql = await getSql();
  const rows = await sql<GoalRow>`
    select user_id, monthly_mrr_target, average_retainer_target, payload, updated_at
    from owner_goals
    where user_id = ${userId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { monthly_mrr_target: null, average_retainer_target: null };
  const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as OwnerGoal) : row.payload;
  return {
    monthly_mrr_target: row.monthly_mrr_target ?? payload?.monthly_mrr_target ?? null,
    average_retainer_target: row.average_retainer_target ?? payload?.average_retainer_target ?? null,
  };
}

export async function setGoal(userId: string, goal: OwnerGoal): Promise<OwnerGoal> {
  const sql = await getSql();
  const payload = JSON.stringify(goal);
  await sql`
    insert into owner_goals (user_id, monthly_mrr_target, average_retainer_target, payload, updated_at)
    values (${userId}, ${goal.monthly_mrr_target}, ${goal.average_retainer_target}, ${payload}::jsonb, now())
    on conflict (user_id) do update set
      monthly_mrr_target = excluded.monthly_mrr_target,
      average_retainer_target = excluded.average_retainer_target,
      payload = excluded.payload,
      updated_at = now()
  `;
  return goal;
}
