import { FIT, STAGE } from "../pipeline-copy.ts";
import type { Prospect } from "../review-brief.ts";
import { newUid } from "../prospects/ids.ts";
import type { PlaceHit } from "./places.ts";

export function hitToProspect(hit: PlaceHit, id: number): Prospect {
  const hasWeb = hit.website && hit.website !== "UNKNOWN";
  const reviews = hit.review_count;
  const rating = hit.google_rating === "UNKNOWN" ? 0 : Number(hit.google_rating);
  let score = 40;
  if (hasWeb) score += 8;
  if (reviews >= 50) score += 15;
  else if (reviews >= 15) score += 8;
  if (rating >= 4.5) score += 8;
  else if (rating >= 4) score += 4;
  const fit = score >= 70 ? "strong" : score >= 55 ? "possible" : "low";
  const checked = new Date().toISOString();
  return {
    id,
    uid: newUid(),
    provider: "google_places",
    provider_place_id: hit.provider_place_id,
    provider_source_url: hit.source_url,
    provider_category: hit.category,
    address: hit.address,
    business_status: hit.business_status,
    lat: hit.lat,
    lng: hit.lng,
    discovered_at: checked,
    name: hit.name,
    vertical: hit.vertical,
    city: hit.city === "UNKNOWN" ? hit.city : `${hit.city}${hit.state && hit.state !== "UNKNOWN" ? ", " + hit.state : ""}`,
    website: hit.website,
    phone: hit.phone,
    google_rating: hit.google_rating,
    review_count: hit.review_count,
    job_value_est: hit.job_value_est,
    job_value_kind: "INDUSTRY_ESTIMATE",
    score,
    fit,
    fit_plain: FIT[fit] || FIT.possible,
    stage: "New",
    stage_plain: STAGE.New,
    research_status: hasWeb ? "queued" : "none",
    findings: [],
    facts: [
      { key: "provider", value: "google_places", source: "Google Places Text Search", checked_at: checked, confidence: "high", status: "VERIFIED" },
      { key: "place_id", value: hit.provider_place_id || "UNKNOWN", source: "Google Places", checked_at: checked, confidence: "high", status: hit.provider_place_id ? "VERIFIED" : "UNKNOWN" },
      { key: "maps_url", value: hit.source_url || "UNKNOWN", source: "Google Places googleMapsUri", checked_at: checked, confidence: "high", status: hit.source_url && hit.source_url !== "UNKNOWN" ? "VERIFIED" : "UNKNOWN" },
      { key: "address", value: hit.address || "UNKNOWN", source: "Google Places formattedAddress", checked_at: checked, confidence: "high", status: hit.address && hit.address !== "UNKNOWN" ? "VERIFIED" : "UNKNOWN" },
      { key: "category", value: hit.category || "UNKNOWN", source: "Google Places primaryType", checked_at: checked, confidence: "medium", status: hit.category && hit.category !== "UNKNOWN" ? "VERIFIED" : "UNKNOWN" },
      { key: "business_status", value: hit.business_status || "UNKNOWN", source: "Google Places businessStatus", checked_at: checked, confidence: "medium", status: hit.business_status && hit.business_status !== "UNKNOWN" ? "VERIFIED" : "UNKNOWN" },
      { key: "coordinates", value: hit.lat || hit.lng ? `${hit.lat},${hit.lng}` : "UNKNOWN", source: "Google Places location", checked_at: checked, confidence: "high", status: hit.lat || hit.lng ? "VERIFIED" : "UNKNOWN" },
      { key: "job_value_est", value: String(hit.job_value_est), source: "INDUSTRY_ESTIMATE (Lamb Ascension category guess — not provided by Google Places)", checked_at: checked, confidence: "low", status: "OBSERVED" },
    ],
    history: [{ at: checked, action: "discovered", detail: `Google Places ${hit.provider_place_id}` }],
  };
}
