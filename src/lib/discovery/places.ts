/** Google Places (New) Text Search. Real businesses only — never fabricate. */

export type PlaceHit = {
  provider: "google_places";
  provider_place_id: string;
  source_url: string;
  name: string;
  website: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  google_rating: string;
  review_count: number;
  category: string;
  lat: number;
  lng: number;
  vertical: string;
  job_value_est: number;
  business_status: string;
};

export type PlacesError = { code: "disabled" | "invalid_key" | "quota" | "timeout" | "zero" | "provider"; message: string };
export type ReserveKind = "geocode" | "text_search";
export type ReserveFn = (kind: ReserveKind) => Promise<{ ok: boolean; reason: string }>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";
const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location",
  "places.types", "places.primaryType", "places.primaryTypeDisplayName",
  "places.googleMapsUri", "places.rating", "places.userRatingCount",
  "places.nationalPhoneNumber", "places.internationalPhoneNumber",
  "places.websiteUri", "places.businessStatus", "nextPageToken",
].join(",");

export const VERTICAL_QUERY: Record<string, { query: string; includedType: string; job: number }> = {
  Roofing: { query: "roofing contractor", includedType: "roofing_contractor", job: 15000 },
  HVAC: { query: "HVAC contractor", includedType: "hvac_contractor", job: 7500 },
  "Plumbing / sewer": { query: "plumber sewer drain", includedType: "plumber", job: 8000 },
  "Foundation repair": { query: "foundation repair contractor", includedType: "general_contractor", job: 12000 },
  "Remodeling / general contractors": { query: "remodeling general contractor", includedType: "general_contractor", job: 18000 },
  Solar: { query: "solar installer", includedType: "electrician", job: 20000 },
  "Med spa / cosmetic": { query: "med spa", includedType: "spa", job: 2500 },
  Dental: { query: "dental implants dentist", includedType: "dentist", job: 8000 },
  "Law / personal injury": { query: "personal injury lawyer", includedType: "lawyer", job: 15000 },
  "B2B consulting": { query: "B2B consulting firm", includedType: "", job: 8000 },
  "SaaS / software": { query: "SaaS software company", includedType: "", job: 5000 },
  Other: { query: "company", includedType: "", job: 5000 },
};

export function mapSpokenVertical(raw: string): string {
  const t = (raw || "").toLowerCase();
  if (/saas|software/.test(t)) return "SaaS / software";
  if (/roof/.test(t)) return "Roofing";
  if (/hvac|air cond/.test(t)) return "HVAC";
  if (/plumb|sewer|drain/.test(t)) return "Plumbing / sewer";
  if (/foundat/.test(t)) return "Foundation repair";
  if (/remod|general contract/.test(t)) return "Remodeling / general contractors";
  if (/solar/.test(t)) return "Solar";
  if (/spa|med spa|cosmetic/.test(t)) return "Med spa / cosmetic";
  if (/dent/.test(t)) return "Dental";
  if (/law|injur|attorney/.test(t)) return "Law / personal injury";
  if (/consult|b2b/.test(t)) return "B2B consulting";
  if (/high-?ticket/.test(t)) return "B2B consulting";
  return Object.keys(VERTICAL_QUERY).find((k) => k.toLowerCase() === t) || "Other";
}

export function cacheKey(parts: Record<string, string | number>): string {
  const raw = Object.keys(parts).sort().map((k) => `${k}=${parts[k]}`).join("|");
  return raw;
}

export function cacheSatisfiesSearch(cached: unknown): cached is PlaceHit[] {
  return Array.isArray(cached) && cached.length > 0;
}

export function splitCityState(addr: string, market: string): { city: string; state: string } {
  if (!addr) {
    const parts = market.split(",").map((p) => p.trim());
    return { city: parts[0] || "UNKNOWN", state: parts[1] || "TX" };
  }
  const bits = addr.split(",").map((b) => b.trim());
  if (bits.length >= 3) {
    const last = bits[bits.length - 1];
    const stateZip = /USA/i.test(last) || /^\d/.test(last) ? bits[bits.length - 2] : last;
    const city = /USA/i.test(last) || /^\d/.test(last) ? bits[bits.length - 3] : bits[bits.length - 2];
    return { city: city || "UNKNOWN", state: (stateZip.split(/\s+/)[0] || "UNKNOWN") };
  }
  return { city: market.split(",")[0]?.trim() || "UNKNOWN", state: "TX" };
}

export function normalizePlace(raw: Record<string, unknown>, vertical: string, market: string): PlaceHit {
  const display = raw.displayName as { text?: string } | undefined;
  const loc = (raw.location as { latitude?: number; longitude?: number } | undefined) || {};
  const types = (raw.types as string[]) || [];
  const addr = String(raw.formattedAddress || "");
  const { city, state } = splitCityState(addr, market);
  const pid = String(raw.id || "");
  const maps = String(raw.googleMapsUri || "") || (pid ? `https://www.google.com/maps/place/?q=place_id:${pid}` : "");
  let primary = "";
  const ptd = raw.primaryTypeDisplayName;
  if (ptd && typeof ptd === "object" && "text" in ptd) primary = String((ptd as { text?: string }).text || "");
  else primary = String(raw.primaryType || "");
  const rating = raw.rating;
  const reviews = raw.userRatingCount;
  const spec = VERTICAL_QUERY[vertical] || VERTICAL_QUERY.Other;
  return {
    provider: "google_places",
    provider_place_id: pid || "",
    source_url: maps || "UNKNOWN",
    name: display?.text || "UNKNOWN",
    website: String(raw.websiteUri || "") || "UNKNOWN",
    phone: String(raw.nationalPhoneNumber || raw.internationalPhoneNumber || "") || "UNKNOWN",
    address: addr || "UNKNOWN",
    city: city || "UNKNOWN",
    state: state || "UNKNOWN",
    google_rating: rating == null ? "UNKNOWN" : String(rating),
    review_count: Number(reviews || 0),
    category: primary || types[0] || "UNKNOWN",
    lat: Number(loc.latitude || 0),
    lng: Number(loc.longitude || 0),
    vertical,
    job_value_est: spec.job,
    business_status: String(raw.businessStatus || "UNKNOWN"),
  };
}

export async function geocode(
  location: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ lat: number; lng: number } | { error: PlacesError }> {
  try {
    const url = `${GEOCODE}?address=${encodeURIComponent(location)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const data = (await res.json()) as { status?: string; error_message?: string; results?: { geometry?: { location?: { lat: number; lng: number } } }[] };
    if (data.status === "REQUEST_DENIED") return { error: { code: "invalid_key", message: data.error_message || "Geocoding request denied" } };
    if (data.status === "OVER_QUERY_LIMIT") return { error: { code: "quota", message: "Geocoding quota exceeded" } };
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc) return { error: { code: "zero", message: `Could not find that area: ${location}` } };
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return { error: { code: "timeout", message: "Map lookup timed out." } };
  }
}

export async function searchText(opts: {
  apiKey: string;
  vertical: string;
  location: string;
  radiusM: number;
  limit: number;
  minRating: number;
  reserve: ReserveFn;
  fetchImpl?: FetchLike;
}): Promise<{ places: PlaceHit[]; calls: { geocode: number; text_search: number } } | { error: PlacesError; calls: { geocode: number; text_search: number } }> {
  const fetchImpl = opts.fetchImpl || fetch;
  const spec = VERTICAL_QUERY[opts.vertical] || { query: opts.vertical, includedType: "", job: 5000 };
  const calls = { geocode: 0, text_search: 0 };

  const geoReserve = await opts.reserve("geocode");
  if (!geoReserve.ok) {
    return { error: { code: "quota", message: geoReserve.reason }, calls };
  }
  calls.geocode += 1;
  const geo = await geocode(opts.location, opts.apiKey, fetchImpl);
  const bias = "error" in geo ? null : geo;
  const collected: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  const textQuery = `${spec.query} in ${opts.location}`;

  while (collected.length < opts.limit && pages < 5) {
    const pageReserve = await opts.reserve("text_search");
    if (!pageReserve.ok) {
      if (!collected.length) return { error: { code: "quota", message: pageReserve.reason }, calls };
      break;
    }
    calls.text_search += 1;
    pages += 1;
    const body: Record<string, unknown> = {
      textQuery,
      regionCode: "US",
      languageCode: "en",
      maxResultCount: Math.min(20, opts.limit - collected.length),
    };
    if (bias) {
      body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: Math.max(1000, opts.radiusM) } };
    }
    if (spec.includedType) {
      body.includedType = spec.includedType;
      body.strictTypeFiltering = false;
    }
    if (opts.minRating >= 0.5) body.minRating = Math.min(5, Math.round(opts.minRating * 2) / 2);
    if (pageToken) body.pageToken = pageToken;

    let res: Response;
    try {
      res = await fetchImpl(TEXT_SEARCH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": opts.apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { error: { code: "timeout", message: "Places API timed out" }, calls };
    }
    if (res.status === 401 || res.status === 403) return { error: { code: "invalid_key", message: "The Places key was rejected. We did not invent companies." }, calls };
    if (res.status === 429) return { error: { code: "quota", message: "Places quota exceeded. Try again tomorrow." }, calls };
    if (!res.ok) return { error: { code: "provider", message: `Places HTTP ${res.status}. We did not invent companies.` }, calls };
    const data = (await res.json()) as { places?: Record<string, unknown>[]; nextPageToken?: string };
    const batch = data.places || [];
    collected.push(...batch);
    pageToken = data.nextPageToken;
    if (!pageToken || !batch.length) break;
  }

  const hits = collected.slice(0, opts.limit).map((raw) => normalizePlace(raw, opts.vertical, opts.location)).filter((h) => h.provider_place_id);
  if (!hits.length) return { error: { code: "zero", message: "No real businesses came back for that search. We did not invent any." }, calls };
  return { places: hits, calls };
}
