import { createFileRoute } from "@tanstack/react-router";

async function handleOutreachTick(request: Request): Promise<Response> {
  const { allowOutreachJob, jobSecretFromRequest } = await import("@/lib/mail/job-auth");
  const { isWorkspacePreview } = await import("@/lib/env.server");
  const gate = allowOutreachJob({
    secret: process.env.OUTREACH_JOB_SECRET,
    extraSecrets: [process.env.CRON_SECRET],
    header: jobSecretFromRequest(request.headers),
    production: !isWorkspacePreview(),
  });
  if (!gate.ok) return new Response(gate.body, { status: gate.status });
  const { tickOutreachWorker } = await import("@/lib/mail/live.server");
  const result = await tickOutreachWorker("http");
  return Response.json({
    ok: true,
    runId: result.runId,
    skipped: result.skippedReason || null,
    sent: result.sent,
    followupsSkipped: result.followupsSkipped,
    rescheduled: result.rescheduled,
  });
}

export const Route = createFileRoute("/api/jobs/outreach")({
  server: {
    handlers: {
      POST: async ({ request }) => handleOutreachTick(request),
    },
  },
});
