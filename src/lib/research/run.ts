import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { DeepInput } from "./types";

export const deepResearchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: DeepInput) => data)
  .handler(async ({ data, context }) => {
    const { env } = await import("@/lib/env.server");
    const { runDeepResearch } = await import("./orchestrate");
    const { tryReserveEnrichment } = await import("./usage.server");
    const { hunterDomainSearch } = await import("./hunter");
    const { fetchPublicPage } = await import("./fetch-page");

    const hunterKey = env("HUNTER_API_KEY");

    const result = await runDeepResearch(
      data,
      {
        minScoreForEnrichment: 65,
        dailyEnrichmentUsed: 0,
        dailyEnrichmentCap: 1,
        hunterKey,
      },
      fetchPublicPage,
      async (domain) => {
        // Qualify already passed inside orchestrate. Reserve BEFORE Hunter.
        // No key / no domain: skip without consuming a slot (no provider call).
        if (!hunterKey) {
          return { ran: false, skipped_reason: "Hunter is turned off (no key). We will not invent emails.", contacts: [], cents: 0 };
        }
        if (!domain || domain.includes("localhost")) {
          return { ran: false, skipped_reason: "No public domain to search.", contacts: [], cents: 0 };
        }
        const reserved = await tryReserveEnrichment(context.userId);
        if (!reserved.ok) {
          return { ran: false, skipped_reason: reserved.reason, contacts: [], cents: 0 };
        }
        // Slot is spent even if Hunter 401/timeouts — cost safety, no refund.
        return hunterDomainSearch(domain, hunterKey, new Date().toISOString());
      },
    );

    return result;
  });
