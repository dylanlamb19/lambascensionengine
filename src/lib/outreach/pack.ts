import { opportunities, recommendOffer, type Prospect } from "../review-brief.ts";
import type { FactKind } from "./types.ts";

export type PackedFact = { kind: FactKind; text: string; key: string };

export type PackedContext = {
  name: string;
  vertical: string;
  city: string;
  website: string;
  is_demo: boolean;
  suppressed: boolean;
  reviews: number;
  rating: string;
  phone: string;
  kind: string;
  readiness: string;
  research_status: string;
  contact_name: string;
  contact_title: string;
  contact_email: string;
  contact_profile: string;
  offer: string;
  offer_why: string;
  opportunities: { code: string; title: string; plain: string }[];
  facts: PackedFact[];
  unknown: string[];
  fingerprint: string;
};

function fp(parts: string[]): string {
  return parts.join("|").slice(0, 500);
}

export function packContext(p: Prospect): PackedContext {
  const opps = opportunities(p);
  const offer = recommendOffer(p);
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const dm = named[0];
  const facts: PackedFact[] = [];
  facts.push({ kind: "VERIFIED FACT", key: "identity", text: `${p.name} is a ${p.vertical || "company"} in ${p.city || "UNKNOWN city"}.` });
  if (p.review_count > 0) facts.push({ kind: "VERIFIED FACT", key: "reviews", text: `${p.review_count} public reviews.` });
  if (p.google_rating && p.google_rating !== "UNKNOWN") facts.push({ kind: "VERIFIED FACT", key: "rating", text: `Public rating ${p.google_rating}.` });
  if (p.phone && p.phone !== "UNKNOWN") facts.push({ kind: "VERIFIED FACT", key: "phone", text: `Public phone ${p.phone}.` });
  if (p.website) facts.push({ kind: "VERIFIED FACT", key: "website", text: `Website ${p.website}.` });
  if (p.locations_count && p.locations_count > 1) facts.push({ kind: "VERIFIED FACT", key: "locations", text: `${p.locations_count} locations on file.` });
  opps.forEach((o) => facts.push({ kind: "VERIFIED FACT", key: o.code, text: o.plain }));
  (p.findings || []).forEach((f) => {
    if (f.status === "ERROR") return;
    facts.push({ kind: f.status === "UNKNOWN" ? "UNKNOWN" : "VERIFIED FACT", key: f.id, text: f.result });
  });
  (p.facts || []).filter((f) => f.status === "OBSERVED" && f.value && f.value !== "UNKNOWN").forEach((f) => {
    facts.push({ kind: "VERIFIED FACT", key: f.key, text: f.value });
  });
  named.forEach((c) => facts.push({ kind: "VERIFIED FACT", key: "person", text: `${c.name}${c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : ""} (source: ${c.source}).` }));

  const unknown = [
    "Revenue",
    "Ad spend / marketing budget",
    "Employee count",
    "Whether they already have an agency",
    "ROAS, lead volume, and conversion rates",
    "Whether they can pay a $10K/month retainer",
  ];

  return {
    name: p.name,
    vertical: p.vertical,
    city: p.city,
    website: p.website,
    is_demo: Boolean(p.is_demo),
    suppressed: Boolean(p.suppressed || p.stage === "Do Not Contact"),
    reviews: p.review_count || 0,
    rating: p.google_rating || "UNKNOWN",
    phone: p.phone || "UNKNOWN",
    kind: p.company_kind || "",
    readiness: p.readiness || "",
    research_status: p.research_status,
    contact_name: dm?.name || "UNKNOWN",
    contact_title: dm?.title && dm.title !== "UNKNOWN" ? dm.title : "UNKNOWN",
    contact_email: dm?.email || "UNKNOWN",
    contact_profile: dm?.profile_url || "",
    offer: offer.name,
    offer_why: offer.why,
    opportunities: opps.map((o) => ({ code: o.code, title: o.title, plain: o.plain })),
    facts,
    unknown,
    fingerprint: fp([
      p.name, p.vertical, p.research_status, String(p.review_count),
      opps.map((o) => o.code).join(","),
      named.map((c) => c.name).join(","),
      p.readiness || "",
    ]),
  };
}
