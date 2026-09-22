import { opportunities, whyConsider, type Prospect } from "../review-brief.ts";
import { blankish, listingPhone, namedPeople, usefulEmail, verifiedWebsite } from "./reach.ts";

export type FitHeadline = "GOOD FIT" | "POSSIBLE FIT" | "NEED MORE INFORMATION";

export type OwnerQualify = {
  headline: FitHeadline;
  who: string;
  sells: string;
  why: string[];
  found: string[];
  unknown: string[];
  next: string;
  websiteResearch: "done" | "unavailable" | "not_started";
};

export function websiteResearchState(p: Prospect): OwnerQualify["websiteResearch"] {
  if (p.research_status === "blocked" || p.research_status === "failed") return "unavailable";
  if (p.research_status === "complete" || p.research_status === "partial") return "done";
  return "not_started";
}

export function fitHeadline(p: Prospect): FitHeadline {
  if (p.readiness === "STRONG CANDIDATE FOR FURTHER QUALIFICATION") return "GOOD FIT";
  if (p.readiness === "POSSIBLE CANDIDATE") return "POSSIBLE FIT";
  if (p.fit === "strong" && (p.research_status === "complete" || p.research_status === "partial")) return "GOOD FIT";
  if (p.fit === "possible" || p.fit === "strong") return "POSSIBLE FIT";
  return "NEED MORE INFORMATION";
}

export function ownerQualify(p: Prospect): OwnerQualify {
  const site = verifiedWebsite(p);
  const phone = listingPhone(p);
  const named = namedPeople(p);
  const email = usefulEmail(p);
  const form = (p.findings || []).find((f) => f.id === "contact_form" || f.id === "contact_form_inner");
  const formOk = Boolean(form && !/^(no |missing)/i.test(form.result || "") && form.status !== "ERROR");
  const webState = websiteResearchState(p);
  const why: string[] = [];
  if (p.vertical) why.push(`Sells ${p.vertical.toLowerCase()} — a high-value service type we work with (category, not revenue).`);
  if (p.city && !blankish(p.city)) why.push(`Operates in ${p.city}.`);
  if (p.provider_place_id) why.push("Real Google listing (Place ID on file).");
  if (site) why.push("Public website on file.");
  if (p.review_count > 0) why.push(`${p.review_count} public reviews — a demand signal, not a gate.`);
  if (phone) why.push("Listing phone on file.");
  if (named.length) why.push(`Decision maker on file: ${named[0].name}.`);
  else if (email) why.push("A published email is on file (not guessed).");
  if (formOk) why.push("A contact form was observed on a page we opened.");
  const opps = opportunities(p);
  if (opps.length) why.push(`Observable website gap: ${opps[0].title.toLowerCase()}.`);
  if (!why.length) why.push(whyConsider(p));

  const unknown = [
    "Revenue",
    "Profit",
    "Advertising spend",
    "Whether they can pay a $2,500–$10,000/month retainer",
  ];
  if (!named.length) unknown.unshift("Decision maker not yet verified");
  if (!email) unknown.push("Verified decision-maker email");
  if (webState === "unavailable") unknown.push("Website research (unavailable — listing evidence kept)");
  if (webState === "not_started") unknown.push("Website research not opened yet");

  const found: string[] = [];
  if (p.provider_place_id) found.push(`Google Place ID ${p.provider_place_id}`);
  if (p.address && !blankish(p.address)) found.push(p.address);
  if (p.provider_category && !blankish(p.provider_category)) found.push(p.provider_category);
  if (webState === "unavailable") found.push("Website research unavailable");
  else if (p.website_note) found.push(p.website_note);
  if (named.length) {
    found.push(named.map((c) => `${c.name}${c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : ""}`).join("; "));
  } else {
    found.push("Decision maker unknown");
  }

  let next = "Find decision maker";
  if (named.length || email) next = "Draft outreach — nothing sends until you approve.";
  else if (phone && site) next = "Find decision maker, or call the listing number / open the website.";
  else if (phone) next = "Call the listing number and ask for the owner. Do not guess an email.";
  else if (site) next = "Open the website or find a real contact. Do not invent an email.";
  else next = "Keep the Google listing. Find a real contact path before outreach.";

  const sells = [
    p.vertical,
    p.provider_category && p.provider_category !== "UNKNOWN" ? p.provider_category : "",
  ].filter(Boolean).join(" · ") || "UNKNOWN";

  return {
    headline: fitHeadline(p),
    who: `${p.name}${p.city && !blankish(p.city) ? ` — ${p.city}` : ""}`,
    sells,
    why,
    found,
    unknown,
    next,
    websiteResearch: webState,
  };
}

export function contactSummary(p: Prospect): string {
  const bits: string[] = [];
  const phone = listingPhone(p);
  const email = usefulEmail(p);
  const named = namedPeople(p);
  if (named.length) {
    const c = named[0];
    const src = /owner provided/i.test(c.name_source || c.source || "") ? "OWNER PROVIDED" : (c.source || "public page");
    bits.push(`Person: ${c.name}${c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : ""} (source: ${src}; not invented).`);
  } else bits.push("Decision maker unknown. Do not invent a name.");
  if (email) bits.push(`Email: ${email.value} (${email.status}${email.source ? ` · ${email.source}` : ""}).`);
  else bits.push("Email: UNKNOWN. Do not guess one from a naming pattern.");
  if (phone) bits.push(`Phone: ${phone.value} (${phone.status}).`);
  else bits.push("Phone: UNKNOWN.");
  const li = (p.socials || []).find((s) => s.network === "linkedin");
  if (li) bits.push(`Company LinkedIn: ${li.url} (${/owner provided/i.test(li.source) ? "OWNER PROVIDED" : "FOUND PUBLICLY"}).`);
  const form = (p.findings || []).find((f) => (f.id === "contact_form" || f.id === "contact_form_inner") && f.status === "VERIFIED");
  if (form) bits.push("Website contact form observed.");
  if (p.contact_page) bits.push(`Contact page: ${p.contact_page} (${/owner provided/i.test(p.contact_page_source || "") ? "OWNER PROVIDED" : "on file"}).`);
  if (p.owner_notes) bits.push(`Owner note: ${p.owner_notes} (OWNER PROVIDED — not a public research claim).`);
  return bits.join(" ");
}
