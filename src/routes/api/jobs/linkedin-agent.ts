import { createFileRoute } from "@tanstack/react-router";
import { GROK_BOT_HANDOFF_NOTE, toJsonBag } from "@/lib/linkedin-agent/types";

/**
 * LinkedIn Grok Bot job.
 * Auth: OUTREACH_JOB_SECRET / CRON_SECRET (same as outreach + sentinel).
 * Does not scrape LinkedIn. Does not auto-send Gmail. Does not write emails onto prospects.
 *
 * mode=both|fill|drain — engine runs Places fill_leads only.
 * mode=bot — claim enrich/outreach/chat/custom for the external Grok Bot.
 * mode=complete — bot posts the outcome. Does not write emails onto prospects.
 */
async function handleLinkedInAgentTick(request: Request): Promise<Response> {
  const { allowOutreachJob, jobSecretFromRequest } = await import("@/lib/mail/job-auth");
  const { isWorkspacePreview } = await import("@/lib/env.server");
  const gate = allowOutreachJob({
    secret: process.env.OUTREACH_JOB_SECRET,
    extraSecrets: [process.env.CRON_SECRET],
    header: jobSecretFromRequest(request.headers),
    production: !isWorkspacePreview(),
  });
  if (!gate.ok) return new Response(gate.body, { status: gate.status });

  let mode: "fill" | "drain" | "both" | "bot" | "complete" = "both";
  let maxSearches = 4;
  let limit = 5;
  let orderId = "";
  let userId = "";
  let status: "done" | "failed" | "cancelled" = "done";
  let result = toJsonBag(undefined);
  let reply = "";
  try {
    const body = await request.json() as {
      mode?: string;
      maxSearches?: number;
      limit?: number;
      orderId?: string;
      userId?: string;
      status?: string;
      result?: unknown;
      reply?: string;
    };
    if (body?.mode === "fill" || body?.mode === "drain" || body?.mode === "both" || body?.mode === "bot" || body?.mode === "complete") {
      mode = body.mode;
    }
    if (typeof body?.maxSearches === "number") maxSearches = body.maxSearches;
    if (typeof body?.limit === "number") limit = body.limit;
    orderId = String(body?.orderId || "");
    userId = String(body?.userId || "");
    if (body?.status === "done" || body?.status === "failed" || body?.status === "cancelled") status = body.status;
    result = toJsonBag(body?.result);
    reply = String(body?.reply || "").slice(0, 4000);
  } catch {
    const url = new URL(request.url);
    const q = url.searchParams.get("mode");
    if (q === "fill" || q === "drain" || q === "both" || q === "bot" || q === "complete") mode = q;
    const lim = Number(url.searchParams.get("limit"));
    if (Number.isFinite(lim) && lim > 0) limit = lim;
    orderId = url.searchParams.get("orderId") || "";
    userId = url.searchParams.get("userId") || "";
    const st = url.searchParams.get("status");
    if (st === "done" || st === "failed" || st === "cancelled") status = st;
    reply = (url.searchParams.get("reply") || "").slice(0, 4000);
  }

  if (mode === "complete") {
    if (!orderId || !userId) {
      return Response.json({ ok: false, reason: "orderId and userId are required.", gmail_auto_send: false }, { status: 400 });
    }
    const { completeOrder, postMessage } = await import("@/lib/linkedin-agent/repo.server");
    const order = await completeOrder(userId, orderId, { status, result });
    if (!order) return Response.json({ ok: false, reason: "Order not found.", gmail_auto_send: false }, { status: 404 });
    const text = reply || `Grok Bot marked ${order.kind} ${status}.`;
    await postMessage(userId, "linkedin", text, { order_id: order.id, kind: order.kind, status });
    await postMessage(
      userId,
      "system",
      "No email was written onto the prospect. No Gmail was sent.",
      { order_id: order.id, kind: order.kind, email_written: false, gmail_auto_send: false },
    );
    return Response.json({
      ok: true,
      mode,
      linkedin_scrape: false,
      gmail_auto_send: false,
      email_written: false,
      order: { id: order.id, kind: order.kind, status: order.status },
    });
  }

  if (mode === "bot") {
    const { claimGrokBotOrders } = await import("@/lib/linkedin-agent/high-ticket-fill.server");
    const claimed = await claimGrokBotOrders({ limit });
    return Response.json({
      ok: true,
      mode,
      linkedin_scrape: false,
      gmail_auto_send: false,
      email_written: false,
      instructions: GROK_BOT_HANDOFF_NOTE,
      ...claimed,
    });
  }

  const { listOwnerUserIds } = await import("@/lib/sentinel/sql.server");
  const users = await listOwnerUserIds();
  const ownerId = users[0] || "";

  const out: Record<string, unknown> = {
    ok: true,
    mode,
    linkedin_scrape: false,
    gmail_auto_send: false,
    email_written: false,
  };

  if ((mode === "fill" || mode === "both") && ownerId) {
    const { runHighTicketFill } = await import("@/lib/linkedin-agent/high-ticket-fill.server");
    const fill = await runHighTicketFill({ userId: ownerId, maxSearches });
    out.fill = {
      imported: fill.imported,
      merged: fill.merged,
      searches: fill.searches,
      reason: fill.reason,
      skipped: fill.skipped,
      verticals: fill.verticals,
      cities: fill.cities,
    };
  } else if (mode === "fill" || mode === "both") {
    out.fill = { skipped: "no-owner" };
  }

  if (mode === "drain" || mode === "both") {
    const { drainLinkedInAgentOrders } = await import("@/lib/linkedin-agent/high-ticket-fill.server");
    out.drain = await drainLinkedInAgentOrders({ limit });
  }

  return Response.json(out);
}

export const Route = createFileRoute("/api/jobs/linkedin-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLinkedInAgentTick(request),
      GET: async ({ request }) => handleLinkedInAgentTick(request),
    },
  },
});