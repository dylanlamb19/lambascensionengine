import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Prospect } from "@/lib/review-brief";
import { hitToProspect } from "./to-prospect";
import type { PlaceHit } from "./places";

export type FindInput = {
  vertical: string;
  location: string;
  limit: number;
  radiusM?: number;
  minRating?: number;
  minReviews?: number;
};

export { hitToProspect };

export const findClientsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: FindInput) => data)
  .handler(async ({ data, context }) => {
    const { env } = await import("@/lib/env.server");
    const { searchText, cacheKey, cacheSatisfiesSearch } = await import("./places");
    const { tryReserveDiscovery, cacheGet, cacheSet, EST_SEARCH_CENTS, EST_GEOCODE_CENTS } = await import("./usage.server");
    const { listProspects, importProspects, logActivity } = await import("@/lib/prospects/repo.server");
    const { nextClientId } = await import("@/lib/prospects/ids");

    const key = env("GOOGLE_PLACES_API_KEY");
    if (!key) {
      return {
        ok: false as const,
        reason: "Live Find Clients is off. Add a Google Places key on the server, or use Add Client for a company you already know. We will not invent businesses.",
        prospects: [] as Prospect[],
      };
    }

    const vertical = (data.vertical || "").trim() || "Other";
    const location = (data.location || "").trim();
    const limit = Math.min(50, Math.max(1, Math.floor(Number(data.limit) || 10)));
    if (!location) {
      return { ok: false as const, reason: "I need a city or market. Type Dallas, Fort Worth, or similar.", prospects: [] as Prospect[] };
    }

    const ck = cacheKey({ v: vertical, loc: location, n: limit, r: data.radiusM || 40000, min: data.minRating || 0, p: "places_v1" });
    const cached = await cacheGet(ck);
    let hits: PlaceHit[] = cacheSatisfiesSearch(cached) ? cached : [];

    if (!hits.length) {
      const found = await searchText({
        apiKey: key,
        vertical,
        location,
        radiusM: data.radiusM || 40000,
        limit,
        minRating: data.minRating || 0,
        reserve: async (kind) => {
          const cents = kind === "geocode" ? EST_GEOCODE_CENTS : EST_SEARCH_CENTS;
          return tryReserveDiscovery(context.userId, cents);
        },
      });
      if ("error" in found) {
        return { ok: false as const, reason: found.error.message, prospects: [] as Prospect[] };
      }
      hits = found.places;
      await cacheSet(ck, hits, 7);
    }

    const minReviews = data.minReviews || 0;
    const filtered = hits.filter((h) => h.review_count >= minReviews);
    const existing = await listProspects(context.userId);
    let nextId = nextClientId(existing);
    const incoming: Prospect[] = [];
    for (const hit of filtered) {
      incoming.push(hitToProspect(hit, nextId));
      nextId += 1;
    }
    const imported = await importProspects(context.userId, incoming);
    const prospects = imported.prospects;
    await logActivity(context.userId, "find_clients", `${incoming.length} from Places (${vertical} / ${location})`);
    return { ok: true as const, reason: `Saved ${incoming.length} real companies.`, prospects };
  });

export const discoveryStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { env } = await import("@/lib/env.server");
    const { placesKeyConfigured, discoverySpoken } = await import("./status");
    const configured = placesKeyConfigured((k) => env(k));
    return {
      ok: true as const,
      configured,
      code: configured ? "READY" : "NOT_CONFIGURED",
      spoken: discoverySpoken(configured),
    };
  });

