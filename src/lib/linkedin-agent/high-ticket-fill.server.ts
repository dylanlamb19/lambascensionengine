/**
 * Capped Google Places fill for high-ticket TX metros.
 * Respects discovery accounting. Does NOT scrape LinkedIn.
 */
import type { Prospect } from "@/lib/review-brief";
import { HIGH_TICKET_CITIES, HIGH_TICKET_VERTICALS } from "./types";

export type HighTicketFillResult = {
  ok: boolean;
  reason: string;
  imported: number;
  merged: number;
  searches: number;
  skipped: string[];
  verticals: string[];
  cities: string[];
  prospects?: Prospect[];
};

/** Map CRE label onto Places search (Other + custom text). */
function placesVertical(label: string): { vertical: string; textQuery?: string } {
  if (/commercial real estate|^cre$/i.test(label)) {
    return { vertical: "Other", textQuery: "commercial real estate office" };
  }
  return { vertical: label };
}

/**
 * Soft per-tick caps on top of DAILY_DISCOVERY_* env caps.
 * Default: a few searches so cron stays cheap.
 */
export async function runHighTicketFill(opts: {
  userId: string;
  maxSearches?: number;
  perSearchLimit?: number;
  verticals?: string[];
  cities?: string[];
}): Promise<HighTicketFillResult> {
  const { env } = await import("@/lib/env.server");
  const { searchText } = await import("@/lib/discovery/places");
  const {
    parseFindQuery,
    discoveryCacheKey,
    dropClosedPlaces,
    rankPlaceHits,
    radiusMeters,
    useLocationBias: locationBiasEnabled,
  } = await import("@/lib/discovery/query");
  const { tryReserveDiscovery, cacheGet, cacheSet, EST_SEARCH_CENTS, EST_GEOCODE_CENTS } = await import("@/lib/discovery/usage.server");
  const { listProspects, importProspects, logActivity } = await import("@/lib/prospects/repo.server");
  const { nextClientId } = await import("@/lib/prospects/ids");
  const { hitToProspect } = await import("@/lib/discovery/to-prospect");
  const { cacheSatisfiesSearch } = await import("@/lib/discovery/places");

  const key = env("GOOGLE_PLACES_API_KEY");
  if (!key) {
    return {
      ok: false,
      reason: "Live Find Clients is off. Add GOOGLE_PLACES_API_KEY. We will not invent businesses.",
      imported: 0,
      merged: 0,
      searches: 0,
      skipped: ["no_places_key"],
      verticals: [],
      cities: [],
    };
  }

  const verticals = (opts.verticals?.length ? opts.verticals : [...HIGH_TICKET_VERTICALS]).slice(0, 8);
  const cities = (opts.cities?.length ? opts.cities : [...HIGH_TICKET_CITIES]).slice(0, 8);
  const maxSearches = Math.min(12, Math.max(1, Math.floor(opts.maxSearches ?? 4)));
  const perSearchLimit = Math.min(12, Math.max(1, Math.floor(opts.perSearchLimit ?? 6)));

  const pairs: { vertical: string; location: string }[] = [];
  for (const v of verticals) {
    for (const c of cities) pairs.push({ vertical: v, location: c });
  }
  const daySeed = new Date().toISOString().slice(0, 10);
  let start = 0;
  for (let i = 0; i < daySeed.length; i += 1) start = (start + daySeed.charCodeAt(i)) % pairs.length;
  const rotated = [...pairs.slice(start), ...pairs.slice(0, start)];

  let searches = 0;
  let importedTotal = 0;
  let mergedTotal = 0;
  const skipped: string[] = [];
  const usedVerticals = new Set<string>();
  const usedCities = new Set<string>();

  for (const pair of rotated) {
    if (searches >= maxSearches) break;
    const mapped = placesVertical(pair.vertical);
    const parsed = parseFindQuery({
      vertical: mapped.vertical,
      location: pair.location,
    });
    const vertical = parsed.vertical;
    const location = parsed.location;
    const textQuery = mapped.textQuery
      ? `${mapped.textQuery} in ${location}`
      : parsed.textQuery;
    const limit = perSearchLimit;
    const radiusM = radiusMeters(location);
    const skipGeocode = !locationBiasEnabled(location);
    const ck = discoveryCacheKey({
      vertical,
      location,
      limit,
      radiusM: skipGeocode ? 0 : radiusM,
      minRating: 0,
      textQuery,
    });

    const cached = await cacheGet(ck);
    let hits = cacheSatisfiesSearch(cached) ? cached : [];
    if (!hits.length) {
      const found = await searchText({
        apiKey: key,
        vertical,
        location,
        radiusM,
        limit,
        minRating: 0,
        textQuery,
        skipGeocode,
        collect: Math.min(20, Math.max(limit, 8)),
        reserve: async (kind) => {
          const cents = kind === "geocode" ? EST_GEOCODE_CENTS : EST_SEARCH_CENTS;
          return tryReserveDiscovery(opts.userId, cents);
        },
      });
      if ("error" in found) {
        skipped.push(`${pair.vertical}@${pair.location}:${found.error.code}`);
        if (found.error.code === "quota") break;
        continue;
      }
      hits = found.places;
      await cacheSet(ck, hits, 7);
      searches += 1;
    } else {
      searches += 1;
    }

    const filtered = rankPlaceHits(dropClosedPlaces(hits)).slice(0, limit);
    if (!filtered.length) {
      skipped.push(`${pair.vertical}@${pair.location}:zero`);
      continue;
    }

    const existing = await listProspects(opts.userId);
    let nextId = nextClientId(existing);
    const incoming: Prospect[] = [];
    for (const hit of filtered) {
      const p = hitToProspect(hit, nextId);
      if (/commercial real estate|^cre$/i.test(pair.vertical)) {
        p.vertical = "Commercial real estate";
      }
      incoming.push(p);
      nextId += 1;
    }
    const imported = await importProspects(opts.userId, incoming);
    importedTotal += imported.imported;
    mergedTotal += imported.merged;
    usedVerticals.add(pair.vertical);
    usedCities.add(pair.location);
  }

  const reason = searches === 0 && skipped.length
    ? `High-ticket fill skipped: ${skipped[0]}`
    : `High-ticket fill: ${importedTotal} new, ${mergedTotal} already on list across ${searches} search(es). No LinkedIn scraping.`;

  await logActivity(
    opts.userId,
    "high_ticket_fill",
    `${reason} skipped=${skipped.length}`,
    undefined,
    "AUTOMATION",
  );

  const prospects = await listProspects(opts.userId);
  return {
    ok: true,
    reason,
    imported: importedTotal,
    merged: mergedTotal,
    searches,
    skipped,
    verticals: [...usedVerticals],
    cities: [...usedCities],
    prospects,
  };
}

/** Engine only runs Places fills. Enrich / outreach / chat stay queued for the Grok Bot. */
export async function drainLinkedInAgentOrders(opts: { limit?: number } = {}): Promise<{
  claimed: number;
  orderIds: string[];
  completed: number;
}> {
  const { claimNextOrder, completeOrder, postMessage, releaseStaleClaims } = await import("./repo.server");
  const limit = Math.min(20, Math.max(1, Math.floor(opts.limit ?? 5)));
  const orderIds: string[] = [];
  let completed = 0;
  await releaseStaleClaims({ kind: "fill_leads" });
  for (let i = 0; i < limit; i += 1) {
    const order = await claimNextOrder({ kind: "fill_leads" });
    if (!order) break;
    orderIds.push(order.id);
    try {
      const fill = await runHighTicketFill({
        userId: order.user_id,
        maxSearches: Number(order.payload.maxSearches) || 3,
        perSearchLimit: Number(order.payload.perSearchLimit) || 5,
        verticals: stringList(order.payload.verticals),
        cities: stringList(order.payload.cities),
      });
      await completeOrder(order.user_id, order.id, {
        status: fill.ok ? "done" : "failed",
        result: {
          imported: fill.imported,
          merged: fill.merged,
          searches: fill.searches,
          reason: fill.reason,
          skipped: fill.skipped,
        },
      });
      await postMessage(order.user_id, "system", fill.reason, { order_id: order.id, kind: "fill_leads" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Places fill failed.";
      await completeOrder(order.user_id, order.id, {
        status: "failed",
        result: { reason: reason.slice(0, 500), kind: "fill_leads" },
      });
      await postMessage(
        order.user_id,
        "system",
        `Places fill failed for order ${order.id.slice(0, 8)}. Nothing was sent.`,
        { order_id: order.id, kind: "fill_leads" },
      );
    }
    completed += 1;
  }
  return { claimed: orderIds.length, orderIds, completed };
}

/** Claim enrich / outreach / chat / custom orders for the external LinkedIn Grok Bot. */
export async function claimGrokBotOrders(opts: { limit?: number } = {}): Promise<{
  claimed: number;
  released_stale: number;
  orders: Array<{ id: string; user_id: string; kind: string; payload: { [key: string]: import("./types").JsonValue } }>;
}> {
  const { claimNextOrder, releaseStaleClaims } = await import("./repo.server");
  const limit = Math.min(10, Math.max(1, Math.floor(opts.limit ?? 5)));
  const released_stale = await releaseStaleClaims({ exceptKind: "fill_leads" });
  const orders: Array<{ id: string; user_id: string; kind: string; payload: { [key: string]: import("./types").JsonValue } }> = [];
  for (let i = 0; i < limit; i += 1) {
    const order = await claimNextOrder({ exceptKind: "fill_leads" });
    if (!order) break;
    orders.push({
      id: order.id,
      user_id: order.user_id,
      kind: order.kind,
      payload: order.payload,
    });
  }
  return { claimed: orders.length, released_stale, orders };
}

function stringList(value: import("./types").JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length ? out : undefined;
}
