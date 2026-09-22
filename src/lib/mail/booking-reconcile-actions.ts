import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { env } from "@/lib/env.server";

export const repairBookingInvariantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { repairPipelineBookingMismatches } = await import("./booking-reconcile");
    const sha = (env("VERCEL_GIT_COMMIT_SHA") || env("GITHUB_SHA") || "").trim();
    const result = await repairPipelineBookingMismatches(context.userId, sha);
    return { ok: true as const, ...result, mutatedCalendar: false as const };
  });
