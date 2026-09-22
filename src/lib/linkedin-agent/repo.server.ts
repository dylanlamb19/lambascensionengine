/**
 * Server-only LinkedIn agent storage. Every query is scoped to verified userId.
 */
import { getSql } from "@/lib/db";
import { newUid } from "@/lib/prospects/ids";
import type {
  LinkedInAgentMessage,
  LinkedInAgentOrder,
  LinkedInAgentOrderKind,
  LinkedInAgentOrderStatus,
  LinkedInAgentRole,
} from "./types";

type MsgRow = {
  id: string;
  user_id: string;
  role: string;
  body: string;
  created_at: unknown;
  meta: Record<string, unknown> | string;
};

type OrderRow = {
  id: string;
  user_id: string;
  status: string;
  kind: string;
  payload: Record<string, unknown> | string;
  result: Record<string, unknown> | string;
  created_at: unknown;
  updated_at: unknown;
  claimed_at: unknown;
};

function iso(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value === "string") return value;
  return "";
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

function rowToMessage(row: MsgRow): LinkedInAgentMessage {
  return {
    id: row.id,
    user_id: row.user_id,
    role: row.role as LinkedInAgentRole,
    body: row.body || "",
    created_at: iso(row.created_at),
    meta: asRecord(row.meta),
  };
}

function rowToOrder(row: OrderRow): LinkedInAgentOrder {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as LinkedInAgentOrderStatus,
    kind: row.kind as LinkedInAgentOrderKind,
    payload: asRecord(row.payload),
    result: asRecord(row.result),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    claimed_at: iso(row.claimed_at) || null,
  };
}

export async function listMessages(userId: string, limit = 80): Promise<LinkedInAgentMessage[]> {
  const sql = await getSql();
  const cap = Math.min(200, Math.max(1, Math.floor(limit)));
  const rows = await sql<MsgRow>`
    select id, user_id, role, body, created_at, meta
    from linkedin_agent_messages
    where user_id = ${userId}
    order by created_at asc
    limit ${cap}
  `;
  return rows.map(rowToMessage);
}

export async function postMessage(
  userId: string,
  role: LinkedInAgentRole,
  body: string,
  meta: Record<string, unknown> = {},
): Promise<LinkedInAgentMessage> {
  const sql = await getSql();
  const id = newUid();
  const text = (body || "").slice(0, 8000);
  const rows = await sql<MsgRow>`
    insert into linkedin_agent_messages (id, user_id, role, body, meta)
    values (${id}, ${userId}, ${role}, ${text}, ${JSON.stringify(meta)}::jsonb)
    returning id, user_id, role, body, created_at, meta
  `;
  return rowToMessage(rows[0]!);
}

export async function listOrders(
  userId: string,
  opts: { status?: LinkedInAgentOrderStatus | "pending"; limit?: number } = {},
): Promise<LinkedInAgentOrder[]> {
  const sql = await getSql();
  const cap = Math.min(100, Math.max(1, Math.floor(opts.limit || 40)));
  if (opts.status === "pending") {
    const rows = await sql<OrderRow>`
      select id, user_id, status, kind, payload, result, created_at, updated_at, claimed_at
      from linkedin_agent_orders
      where user_id = ${userId} and status in ('queued', 'claimed')
      order by created_at asc
      limit ${cap}
    `;
    return rows.map(rowToOrder);
  }
  if (opts.status) {
    const status = opts.status;
    const rows = await sql<OrderRow>`
      select id, user_id, status, kind, payload, result, created_at, updated_at, claimed_at
      from linkedin_agent_orders
      where user_id = ${userId} and status = ${status}
      order by created_at desc
      limit ${cap}
    `;
    return rows.map(rowToOrder);
  }
  const rows = await sql<OrderRow>`
    select id, user_id, status, kind, payload, result, created_at, updated_at, claimed_at
    from linkedin_agent_orders
    where user_id = ${userId}
    order by created_at desc
    limit ${cap}
  `;
  return rows.map(rowToOrder);
}

export async function createOrder(
  userId: string,
  kind: LinkedInAgentOrderKind,
  payload: Record<string, unknown> = {},
): Promise<LinkedInAgentOrder> {
  const sql = await getSql();
  const id = newUid();
  const body = { ...payload };
  if (kind === "outreach" && !body.safety_note) {
    body.safety_note = "draft/request LinkedIn connects under soft caps";
    body.auto_send = false;
  }
  const rows = await sql<OrderRow>`
    insert into linkedin_agent_orders (id, user_id, status, kind, payload)
    values (${id}, ${userId}, ${"queued"}, ${kind}, ${JSON.stringify(body)}::jsonb)
    returning id, user_id, status, kind, payload, result, created_at, updated_at, claimed_at
  `;
  return rowToOrder(rows[0]!);
}

/** Claim the next queued order for any owner (job/drain) or a specific user. */
export async function claimNextOrder(opts: { userId?: string } = {}): Promise<LinkedInAgentOrder | null> {
  const sql = await getSql();
  const now = new Date().toISOString();
  const queued = opts.userId
    ? await sql<{ id: string }>`
        select id from linkedin_agent_orders
        where user_id = ${opts.userId} and status = ${"queued"}
        order by created_at asc
        limit 1
      `
    : await sql<{ id: string }>`
        select id from linkedin_agent_orders
        where status = ${"queued"}
        order by created_at asc
        limit 1
      `;
  const id = queued[0]?.id;
  if (!id) return null;
  const rows = await sql<OrderRow>`
    update linkedin_agent_orders
    set status = ${"claimed"}, claimed_at = ${now}, updated_at = ${now}
    where id = ${id} and status = ${"queued"}
    returning id, user_id, status, kind, payload, result, created_at, updated_at, claimed_at
  `;
  return rows[0] ? rowToOrder(rows[0]) : null;
}

export async function completeOrder(
  userId: string,
  orderId: string,
  opts: { status?: "done" | "failed" | "cancelled"; result?: Record<string, unknown> } = {},
): Promise<LinkedInAgentOrder | null> {
  const sql = await getSql();
  const status = opts.status || "done";
  const result = opts.result || {};
  const now = new Date().toISOString();
  const rows = await sql<OrderRow>`
    update linkedin_agent_orders
    set status = ${status},
        result = ${JSON.stringify(result)}::jsonb,
        updated_at = ${now}
    where user_id = ${userId} and id = ${orderId}
    returning id, user_id, status, kind, payload, result, created_at, updated_at, claimed_at
  `;
  return rows[0] ? rowToOrder(rows[0]) : null;
}

export async function countQueuedOrders(userId?: string): Promise<number> {
  const sql = await getSql();
  if (userId) {
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from linkedin_agent_orders
      where user_id = ${userId} and status = ${"queued"}
    `;
    return Number(rows[0]?.n || 0);
  }
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from linkedin_agent_orders where status = ${"queued"}
  `;
  return Number(rows[0]?.n || 0);
}
