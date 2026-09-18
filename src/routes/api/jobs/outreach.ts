import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/jobs/outreach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { allowOutreachJob, jobSecretFromRequest } = await import("@/lib/mail/job-auth");
        const { isWorkspacePreview } = await import("@/lib/env.server");
        const configured = process.env.OUTREACH_JOB_SECRET || process.env.CRON_SECRET;
        const gate = allowOutreachJob({
          secret: configured,
          header: jobSecretFromRequest(request.headers),
          production: !isWorkspacePreview(),
        });
        if (!gate.ok) return new Response(gate.body, { status: gate.status });
        const { tickOutreachWorker } = await import("@/lib/mail/live.server");
        await tickOutreachWorker("http");
        return Response.json({ ok: true });
      },
    },
  },
});
