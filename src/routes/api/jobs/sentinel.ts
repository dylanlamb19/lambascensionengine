import { createFileRoute } from "@tanstack/react-router";

/**
 * Lascengine Sentinel job endpoint.
 * Inspect-only. Same worker secret as outreach — does not send mail,
 * does not create Calendar events, does not change Test Mode.
 */
async function handleSentinelTick(request: Request): Promise<Response> {
  const { allowOutreachJob, jobSecretFromRequest } = await import("@/lib/mail/job-auth");
  const { isWorkspacePreview } = await import("@/lib/env.server");
  const gate = allowOutreachJob({
    secret: process.env.OUTREACH_JOB_SECRET,
    extraSecrets: [process.env.CRON_SECRET],
    header: jobSecretFromRequest(request.headers),
    production: !isWorkspacePreview(),
  });
  if (!gate.ok) return new Response(gate.body, { status: gate.status });

  let mode: "light" | "deep" | "post_deploy" = "light";
  try {
    const body = await request.json() as { mode?: string };
    if (body?.mode === "deep" || body?.mode === "post_deploy") mode = body.mode;
  } catch {
    const url = new URL(request.url);
    const q = url.searchParams.get("mode");
    if (q === "deep" || q === "post_deploy") mode = q;
  }

  const { listOwnerUserIds } = await import("@/lib/sentinel/sql.server");
  const { runSentinel } = await import("@/lib/sentinel/run.server");
  const users = await listOwnerUserIds();
  const userId = users[0] || "";
  if (!userId) {
    return Response.json({ ok: true, skipped: "no-owner", mode, mutated: false });
  }
  const result = await runSentinel({ userId, mode });
  return Response.json({
    ok: true,
    mode,
    overall: result.snapshot.overall,
    openIssues: result.snapshot.openIssues,
    productionSha: result.snapshot.productionSha,
    mutated: false,
    autoFix: false,
  });
}

export const Route = createFileRoute("/api/jobs/sentinel")({
  server: {
    handlers: {
      POST: async ({ request }) => handleSentinelTick(request),
      GET: async ({ request }) => handleSentinelTick(request),
    },
  },
});
