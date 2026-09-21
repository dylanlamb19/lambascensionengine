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
  query?: string;
};

export { hitToProspect };

export const findClientsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: FindInput) => data)
  .handler(async ({ data, context }) => {
    const { env } = await import("@/lib/env.server");
    const { searchText } = await import("./places");
    const {
      parseFindQuery,
      discoveryCacheKey,
      dropClosedPlaces,
      rankPlaceHits,
      radiusMeters,
      useLocationBias,
    } = await import("./query");
    const { tryReserveDiscovery, cacheGet, cacheSet, EST_SEARCH_CENTS, EST_GEOCODE_CENTS } = await import("./usage.server");
    const { listProspects, importProspects, logActivity } = await import("@/lib/prospects/repo.server");
    const { nextClientId } = await import("@/lib/prospects/ids");

    const key = env("GOOGLE_PLACES_API_KEY");
    if (!key) {
      return {
        ok: false as const,
        reason: "Live Find Clients is off. Add GOOGLE_PLACES_API_KEY on the server (Places API New + Geocoding API), or use Add Client for a company you already know. We will not invent businesses.",
        prospects: [] as Prospect[],
        imported: 0,
        merged: 0,
      };
    }

    const parsed = parseFindQuery({
      vertical: (data.query || data.vertical || "").trim() || "Other",
      location: (data.location || "").trim(),
    });
    const vertical = parsed.vertical;
    const location = parsed.location;
    const limit = Math.min(20, Math.max(1, Math.floor(Number(data.limit) || 8)));
    if (!location) {
      return {
        ok: false as const,
        reason: "I need a city or market. Type Dallas, Fort Worth, or similar.",
        prospects: [] as Prospect[],
        imported: 0,
        merged: 0,
      };
    }

    const radiusM = radiusMeters(location, data.radiusM);
    const skipGeocode = !useLocationBias(location);
    const ck = discoveryCacheKey({
      vertical,
      location,
      limit,
      radiusM: skipGeocode ? 0 : radiusM,
      minRating: data.minRating || 0,
      textQuery: parsed.textQuery,
    });
    const cached = await cacheGet(ck);
    const { cacheSatisfiesSearch } = await import("./places");
    let hits: PlaceHit[] = cacheSatisfiesSearch(cached) ? cached : [];

    if (!hits.length) {
      const found = await searchText({
        apiKey: key,
        vertical,
        location,
        radiusM,
        limit,
        minRating: data.minRating || 0,
        textQuery: parsed.textQuery,
        skipGeocode,
        collect: Math.min(20, Math.max(limit, 10)),
        reserve: async (kind) => {
          const cents = kind === "geocode" ? EST_GEOCODE_CENTS : EST_SEARCH_CENTS;
          return tryReserveDiscovery(context.userId, cents);
        },
      });
      if ("error" in found) {
        return {
          ok: false as const,
          reason: found.error.message,
          prospects: [] as Prospect[],
          imported: 0,
          merged: 0,
        };
      }
      hits = found.places;
      await cacheSet(ck, hits, 7);
    }

    const minReviews = Math.max(0, data.minReviews || 0);
    const filtered = rankPlaceHits(
      dropClosedPlaces(hits).filter((h) => h.review_count >= minReviews),
    ).slice(0, limit);
    if (!filtered.length) {
      return {
        ok: false as const,
        reason: "No real businesses came back for that search. We did not invent any.",
        prospects: [] as Prospect[],
        imported: 0,
        merged: 0,
      };
    }
    const existing = await listProspects(context.userId);
    let nextId = nextClientId(existing);
    const incoming: Prospect[] = [];
    for (const hit of filtered) {
      incoming.push(hitToProspect(hit, nextId));
      nextId += 1;
    }
    const imported = await importProspects(context.userId, incoming);
    const prospects = imported.prospects;
    const placeIds = incoming.map((p) => p.provider_place_id).filter((id): id is string => Boolean(id));
    const matched = prospects.filter((p) => p.provider_place_id && placeIds.includes(p.provider_place_id));
    const lastDiscovery = {
      query: `${vertical} in ${location}`,
      vertical,
      location,
      requested: limit,
      matched: matched.length,
      prospectUids: matched.map((p) => p.uid || "").filter(Boolean),
      placeIds,
      timestamp: new Date().toISOString(),
    };
    const reason = imported.imported === 0 && imported.merged > 0
      ? `Those ${matched.length} ${vertical} companies in ${location} are already on your list. Showing them on Pipeline.`
      : `Saved ${imported.imported} new companies${imported.merged ? `, ${imported.merged} already on your list` : ""}. Showing them on Pipeline.`;
    await logActivity(context.userId, "find_clients", `${filtered.length} from Places (${vertical} / ${location}); imported ${imported.imported}, merged ${imported.merged}`);
    return { ok: true as const, reason, prospects, imported: imported.imported, merged: imported.merged, lastDiscovery };
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
      missing: configured ? [] as string[] : ["GOOGLE_PLACES_API_KEY"],
      apis: configured ? [] as string[] : ["Places API (New)", "Geocoding API"],
    };
  });
