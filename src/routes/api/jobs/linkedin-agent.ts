import { createFileRoute } from "@tanstack/react-router";

/**
 * LinkedIn agent job: high-ticket Places fill + claim/drain fill_leads orders.
 * Auth: OUTREACH_JOB_SECRET / CRON_SECRET (same as outreach + sentinel).
 * Does not scrape LinkedIn. Does not auto-send Gmail.
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

  let mode: "fill" | "drain" | "both" = "both";
  let maxSearches = 4;
  try {
    const body = await request.json() as { mode?: string; maxSearches?: number };
    if (body?.mode === "fill" || body?.mode === "drain" || body?.mode === "both") mode = body.mode;
    if (typeof body?.maxSearches === "number") maxSearches = body.maxSearches;
  } catch {
    const url = new URL(request.url);
    const q = url.searchParams.get("mode");
    if (q === "fill" || q === "drain" || q === "both") mode = q;
  }

  const { listOwnerUserIds } = await import("@/lib/sentinel/sql.server");
  const users = await listOwnerUserIds();
  const userId = users[0] || "";

  const out: Record<string, unknown> = {
    ok: true,
    mode,
    linkedin_scrape: false,
    gmail_auto_send: false,
  };

  if ((mode === "fill" || mode === "both") && userId) {
    const { runHighTicketFill } = await import("@/lib/linkedin-agent/high-ticket-fill.server");
    const fill = await runHighTicketFill({ userId, maxSearches });
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
    const drain = await drainLinkedInAgentOrders({ limit: 5 });
    out.drain = drain;
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
