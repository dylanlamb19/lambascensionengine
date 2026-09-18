import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { ResearchMode } from "./types.ts";

export const araWebResearchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { query: string; mode?: ResearchMode; url?: string; prospectUid?: string; prospectContext?: string }) => data)
  .handler(async ({ data, context }) => {
    const { runAraResearch } = await import("./runner");
    const mode = data.mode === "deep" || data.mode === "page" ? data.mode : "quick";
    try {
      const { logActivity } = await import("@/lib/prospects/repo.server");
      await logActivity(context.userId, "ara_web_research", `${mode}:${(data.query || data.url || "").slice(0, 120)}`, data.prospectUid, "VOICE");
    } catch {
      /* audit must not block research */
    }
    return runAraResearch(context.userId, {
      query: data.query || data.url || "",
      mode,
      url: data.url,
      prospectUid: data.prospectUid,
      prospectContext: data.prospectContext,
    });
  });
