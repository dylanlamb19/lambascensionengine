import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { env } from "@/lib/env.server";

/**
 * Batch repair for PIPELINE_STATE_MISMATCH.
 * Owner Desk auto-calls this on hydrate when a PIPELINE_STATE_MISMATCH alert is open.
 * Never creates Calendar events (mutatedCalendar: false).
 */
export const repairBookingInvariantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { repairPipelineBookingMismatches } = await import("./booking-reconcile");
    const sha = (env("VERCEL_GIT_COMMIT_SHA") || env("GITHUB_SHA") || "").trim();
    const result = await repairPipelineBookingMismatches(context.userId, sha);
    return { ok: true as const, ...result, mutatedCalendar: false as const };
  });

/** Alias — same batch repair; available for explicit Owner Desk / Ara batch calls. */
export const batchRepairBookingInvariantFn = repairBookingInvariantFn;
