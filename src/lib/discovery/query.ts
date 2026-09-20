import { VERTICAL_QUERY, cacheKey, mapSpokenVertical, type PlaceHit } from "./places.ts";

const IN_SPLIT = /\s+in\s+/i;

export type ParsedFindQuery = {
  vertical: string;
  location: string;
  textQuery: string;
  industryRaw: string;
};

/** Turn owner language into a Places text query. Never invent a market. */
export function parseFindQuery(opts: { vertical?: string; location?: string }): ParsedFindQuery {
  let industry = (opts.vertical || "").trim();
  let location = (opts.location || "").trim();
  if (IN_SPLIT.test(industry)) {
    const parts = industry.split(IN_SPLIT).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      industry = parts[0];
      if (!location) location = parts.slice(1).join(" in ");
    }
  }
  const vertical = mapSpokenVertical(industry || "Other");
  const spec = VERTICAL_QUERY[vertical];
  const phrase = vertical === "Other" && industry
    ? industry.replace(/\s+companies?$/i, "").trim() || industry
    : spec?.query || industry || "company";
  const textQuery = location ? `${phrase} in ${location}` : phrase;
  return { vertical, location, textQuery, industryRaw: industry };
}

export function normalizeMarket(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Statewide / country queries should not get a tight circle bias. */
export function useLocationBias(location: string): boolean {
  const t = normalizeMarket(location);
  if (!t) return false;
  if (/^(texas|tx|california|ca|united states|usa|us|oklahoma|ok)$/.test(t)) return false;
  return true;
}

export function radiusMeters(location: string, requested?: number): number {
  const cap = 50_000;
  if (requested && requested > 0) return Math.min(cap, Math.max(1_000, Math.floor(requested)));
  if (/\bdfw\b|dallas[- ]fort worth|metroplex/.test(normalizeMarket(location))) return cap;
  return 40_000;
}

export function discoveryCacheKey(opts: {
  vertical: string;
  location: string;
  limit: number;
  radiusM: number;
  minRating: number;
  textQuery: string;
}): string {
  return cacheKey({
    v: mapSpokenVertical(opts.vertical),
    loc: normalizeMarket(opts.location),
    q: opts.textQuery.trim().toLowerCase(),
    n: opts.limit,
    r: opts.radiusM,
    min: opts.minRating,
    p: "places_v2",
  });
}

export function dropClosedPlaces(hits: PlaceHit[]): PlaceHit[] {
  return hits.filter((h) => {
    const st = (h.business_status || "").toUpperCase();
    return st !== "CLOSED_PERMANENTLY";
  });
}

/** Usefulness rank. Reviews are a signal, never a hard gate. */
export function usefulnessScore(hit: PlaceHit): number {
  let n = 0;
  const st = (hit.business_status || "").toUpperCase();
  if (st === "OPERATIONAL") n += 20;
  else if (st === "CLOSED_TEMPORARILY") n += 4;
  if (hit.website && hit.website !== "UNKNOWN") n += 16;
  if (hit.phone && hit.phone !== "UNKNOWN") n += 8;
  if (hit.review_count >= 50) n += 10;
  else if (hit.review_count >= 15) n += 6;
  else if (hit.review_count > 0) n += 2;
  const rating = hit.google_rating === "UNKNOWN" ? 0 : Number(hit.google_rating);
  if (rating >= 4.5) n += 6;
  else if (rating >= 4) n += 3;
  return n;
}

export function rankPlaceHits(hits: PlaceHit[]): PlaceHit[] {
  return [...hits].sort((a, b) => {
    const d = usefulnessScore(b) - usefulnessScore(a);
    if (d) return d;
    return (b.review_count || 0) - (a.review_count || 0);
  });
}
