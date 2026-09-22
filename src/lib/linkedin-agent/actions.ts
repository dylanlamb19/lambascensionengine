import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  HIGH_TICKET_CITIES,
  HIGH_TICKET_VERTICALS,
  isAgentRole,
  isOrderKind,
  LINKEDIN_OUTREACH_SOFT_CAP_NOTE,
  type LinkedInAgentOrderKind,
  type LinkedInAgentRole,
  type JsonValue,
} from "./types";

export const listLinkedInAgentMessagesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listMessages } = await import("./repo.server");
    const messages = await listMessages(context.userId);
    return { ok: true as const, messages };
  });

export const postLinkedInAgentMessageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { body: string; role?: LinkedInAgentRole; meta?: { [key: string]: JsonValue } }) => data)
  .handler(async ({ data, context }) => {
    const { postMessage } = await import("./repo.server");
    const role: LinkedInAgentRole = data.role && isAgentRole(data.role) ? data.role : "user";
    const body = String(data.body || "").trim();
    if (!body) return { ok: false as const, reason: "Message is empty." };
    const message = await postMessage(context.userId, role, body, data.meta || {});
    return { ok: true as const, message };
  });

export const listLinkedInAgentOrdersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listOrders } = await import("./repo.server");
    const orders = await listOrders(context.userId, { limit: 30 });
    const pending = orders.filter((o) => o.status === "queued" || o.status === "claimed");
    return { ok: true as const, orders, pending };
  });

export const createLinkedInAgentOrderFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    kind: LinkedInAgentOrderKind | string;
    payload?: { [key: string]: JsonValue };
    note?: string;
  }) => data)
  .handler(async ({ data, context }) => {
    const kindRaw = String(data.kind || "").trim();
    if (!isOrderKind(kindRaw)) {
      return { ok: false as const, reason: "Unknown order kind." };
    }
    const payload: { [key: string]: JsonValue } = { ...(data.payload || {}) };
    if (data.note) payload.note = String(data.note).slice(0, 2000);
    if (kindRaw === "outreach") {
      payload.safety_note = LINKEDIN_OUTREACH_SOFT_CAP_NOTE;
      payload.auto_send = false;
      payload.gmail_auto_send = false;
    }
    if (kindRaw === "enrich") {
      payload.contactability = "email_only";
      payload.do_not_invent_email = true;
      payload.gmail_auto_send = false;
      if (!payload.focus) payload.focus = "NEEDS_CONTACT_INFORMATION";
    }
    if (kindRaw === "fill_leads" && !payload.verticals) {
      payload.verticals = [...HIGH_TICKET_VERTICALS];
      payload.cities = [...HIGH_TICKET_CITIES];
      payload.source = "owner_or_ara";
    }
    const { createOrder, postMessage } = await import("./repo.server");
    const order = await createOrder(context.userId, kindRaw, payload);
    await postMessage(
      context.userId,
      "system",
      `Order queued: ${kindRaw} (${order.id.slice(0, 8)}…). LinkedIn Grok Bot will pick it up under soft caps. Nothing is sent.`,
      { order_id: order.id, kind: kindRaw },
    );
    return { ok: true as const, order };
  });

export const completeLinkedInAgentOrderFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    orderId: string;
    status?: "done" | "failed" | "cancelled";
    result?: { [key: string]: JsonValue };
  }) => data)
  .handler(async ({ data, context }) => {
    const { completeOrder } = await import("./repo.server");
    const order = await completeOrder(context.userId, String(data.orderId || ""), {
      status: data.status || "done",
      result: data.result || {},
    });
    if (!order) return { ok: false as const, reason: "Order not found." };
    return { ok: true as const, order };
  });

/** Owner Desk / Pipeline: run one capped high-ticket Places fill now. */
export const fillHighTicketLeadsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { maxSearches?: number; perSearchLimit?: number } = {}) => data || {})
  .handler(async ({ data, context }) => {
    const { runHighTicketFill } = await import("./high-ticket-fill.server");
    const result = await runHighTicketFill({
      userId: context.userId,
      maxSearches: data?.maxSearches,
      perSearchLimit: data?.perSearchLimit,
    });
    return result;
  });
