import type { AdObservation, DecisionMaker, EvidenceFact, Readiness } from "./research/types.ts";

export type Finding = {
  id: string;
  result: string;
  status: "VERIFIED" | "OBSERVED" | "UNKNOWN" | "ERROR";
  source?: string;
  checked_at?: string;
  confidence?: string;
};

export type Prospect = {
  id: number;
  uid?: string;
  provider?: string;
  provider_place_id?: string;
  provider_source_url?: string;
  provider_category?: string;
  address?: string;
  business_status?: string;
  lat?: number;
  lng?: number;
  discovered_at?: string;
  name: string;
  vertical: string;
  city: string;
  website: string;
  review_count: number;
  google_rating: string;
  phone: string;
  job_value_est: number;
  /** Internal category guess — NOT Google-provided, NOT verified revenue. */
  job_value_kind?: "INDUSTRY_ESTIMATE" | "UNKNOWN";
  score: number;
  fit: string;
  fit_plain: string;
  stage: string;
  stage_plain: string;
  research_status: string;
  findings: Finding[];
  facts?: EvidenceFact[];
  contacts?: DecisionMaker[];
  ads?: AdObservation[];
  socials?: { network: string; url: string; source: string }[];
  readiness?: Readiness;
  readiness_why?: string[];
  company_kind?: string;
  website_note?: string;
  hunter_skipped_reason?: string;
  deep_at?: string;
  locations_count?: number;
  years_in_business?: number;
  estimated_cents?: number;
  pages_fetched?: number;
  is_demo?: boolean;
  suppressed?: boolean;
  outreach?: import("./outreach/types").OutreachPack;
  discovery?: import("./outreach/types").DiscoveryAnswers;
  history?: { at: string; action: string; detail: string; field?: string; previous?: string; next?: string; source?: string; actor?: string }[];
  attack_id?: string;
  get_clients_skipped?: boolean;
  opportunity_codes?: string[];
  priority?: string;
  priority_why?: string[];
  monthly_fee?: number;
  owner_notes?: string;
  phone_source?: string;
  website_source?: string;
  contact_page?: string;
  contact_page_source?: string;
  meeting_at?: string;
  meeting_event_id?: string;
  sales_outcome?: "" | "SHOWED" | "NO_SHOW" | "FOLLOW_UP_NEEDED" | "WON" | "LOST";
  client_value?: number | null;
  billing_type?: "" | "one-time" | "monthly";
  lost_reason?: string;
  outcome_note?: string;
  follow_up_at?: string;
  follow_up_reason?: string;
  call_notes?: import("./autonomy/sales").CallNotes;
  followup_draft?: string;
  proposal_draft?: string;
  client_record?: import("./autonomy/sales").ClientRecord;
};

export type Opportunity = {
  code: string;
  title: string;
  plain: string;
  evidence_id: string;
};

export type OfferPick = {
  name: "Acquire" | "Convert" | "System" | "Unknown";
  why: string;
};

const FINDING_PLAIN: Record<string, string> = {
  resolves: "Website loaded",
  https: "Secure website (https)",
  click_to_call: "Click-to-call",
  phone_visible: "Phone number on the homepage",
  contact_form: "Contact form on the homepage",
  contact_form_inner: "Contact form on an inside page",
  booking: "Online booking",
  primary_cta: "Clear “get a quote” button near the top",
  service_pages: "Service pages linked from the homepage",
  location_pages: "Location / service-area pages",
  testimonials: "Reviews or testimonials on the homepage",
  financing: "Financing mentioned",
  chat: "Chat widget",
  gtag: "Google tag snippet",
  gtm: "Google Tag Manager snippet",
  meta_pixel: "Meta / Facebook tracking snippet",
  ads_conversion_tag: "Google Ads conversion tag",
  pagespeed_mobile: "Phone speed check",
  title: "Page title",
  h1: "Main headline",
};

function byId(findings: Finding[], id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

function absent(f?: Finding): boolean {
  if (!f) return false;
  const r = (f.result || "").toLowerCase();
  return r.startsWith("no ") || r.startsWith("missing");
}

function present(f?: Finding): boolean {
  if (!f) return false;
  if (f.status === "ERROR" || f.status === "UNKNOWN") return false;
  return !absent(f);
}

export function importantFindings(p: Prospect): { label: string; plain: string; status: string }[] {
  if (p.research_status === "blocked") {
    return [{ label: "Website research", plain: "Their site blocked our research bot. We did not sneak around it, and we did not invent findings.", status: "UNKNOWN" }];
  }
  if (p.research_status === "failed") {
    return [{ label: "Website research", plain: "The site didn’t finish loading (timeout or error). We did not invent findings.", status: "ERROR" }];
  }
  if (p.research_status !== "complete" && p.research_status !== "partial") {
    return [{ label: "Website research", plain: "We have not opened their website yet.", status: "UNKNOWN" }];
  }
  const ids = [
    "resolves", "https", "click_to_call", "phone_visible", "contact_form", "contact_form_inner",
    "primary_cta", "booking", "testimonials", "financing", "gtm", "meta_pixel", "ads_conversion_tag", "pagespeed_mobile",
  ];
  const out: { label: string; plain: string; status: string }[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const f = byId(p.findings, id);
    if (!f) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    let plain = f.result;
    if (id === "meta_pixel") {
      plain = present(f)
        ? "A Meta/Facebook tracking snippet is on a page we checked. That is not proof they run Facebook ads."
        : "No Meta/Facebook tracking snippet on the pages we checked. That is not proof they don’t advertise.";
    }
    if (id === "gtm" || id === "gtag") {
      plain = present(f)
        ? "A Google tracking snippet is on a page we checked. That is not proof of active Google Ads."
        : "No Google tracking snippet on the pages we checked.";
    }
    if (id === "pagespeed_mobile" && f.status === "ERROR") {
      plain = "Phone speed is unknown. The speed check failed, so we are not calling the site slow.";
    }
    out.push({ label: FINDING_PLAIN[id] || id, plain, status: f.status });
  }
  return out;
}

export function opportunities(p: Prospect): Opportunity[] {
  const opps: Opportunity[] = [];
  if (p.research_status !== "complete" && p.research_status !== "partial") return opps;
  const form = byId(p.findings, "contact_form");
  const inner = byId(p.findings, "contact_form_inner");
  const cta = byId(p.findings, "primary_cta");
  const tel = byId(p.findings, "click_to_call");
  const services = byId(p.findings, "service_pages");
  const pixel = byId(p.findings, "meta_pixel");
  const gtm = byId(p.findings, "gtm");
  const gtag = byId(p.findings, "gtag");
  const ads = byId(p.findings, "ads_conversion_tag");
  const psi = byId(p.findings, "pagespeed_mobile");

  if (form && absent(form)) {
    opps.push({
      code: "NO_HOMEPAGE_FORM",
      title: "Homepage is hard to inquire from",
      plain: inner && present(inner)
        ? "No contact form on the homepage, but a form showed up on an inside page. Someone landing on the home page may have to click around to ask for help."
        : "No contact form on the homepage. That is a weak first step if ads send people there.",
      evidence_id: "contact_form",
    });
  }
  if (cta && absent(cta)) {
    opps.push({
      code: "NO_HOMEPAGE_CTA",
      title: "No clear “get a quote” near the top",
      plain: "We did not see common quote/estimate wording in the first screen of content. Ads often waste money when the next step isn’t obvious.",
      evidence_id: "primary_cta",
    });
  }
  if (tel && absent(tel) && tel.status === "VERIFIED") {
    opps.push({
      code: "NO_CLICK_TO_CALL",
      title: "No click-to-call",
      plain: "No tap-to-call link on the homepage. On phones, that makes it harder to call right now.",
      evidence_id: "click_to_call",
    });
  }
  if (services && absent(services)) {
    opps.push({
      code: "WEAK_SERVICE_NAV",
      title: "Homepage doesn’t clearly route to services",
      plain: "We didn’t see service-page links on the homepage in the paths we check for. Visitors may not know which job they should click.",
      evidence_id: "service_pages",
    });
  }
  if (psi && psi.status === "VERIFIED") {
    const n = parseInt(String(psi.result).split(" ")[0], 10);
    if (!Number.isNaN(n) && n < 50) {
      opps.push({
        code: "SLOW_MOBILE",
        title: "Slow on phones",
        plain: `The phone speed score we received was ${n}/100.`,
        evidence_id: "pagespeed_mobile",
      });
    }
  }
  if (pixel && gtm && gtag && absent(pixel) && absent(gtm) && absent(gtag)) {
    opps.push({
      code: "NO_TRACKING",
      title: "No common tracking snippets on pages we checked",
      plain: "We did not see Meta Pixel, Google Tag Manager, or gtag on those pages. Missing tags does not prove they never advertise.",
      evidence_id: "meta_pixel",
    });
  }
  if (ads && absent(ads) && ads.status === "VERIFIED") {
    opps.push({
      code: "NO_ADS_CONVERSION_TAG",
      title: "No Google Ads conversion tag on checked pages",
      plain: "We did not see a Google Ads conversion tag. That does not prove they are not running Google Ads — only that we didn’t see that tag where we looked.",
      evidence_id: "ads_conversion_tag",
    });
  }
  if (p.review_count >= 80 && form && absent(form)) {
    opps.push({
      code: "DEMAND_WEAK_FUNNEL",
      title: "Lots of public reviews, weak homepage ask",
      plain: `${p.review_count} public reviews suggest people already know them, but the homepage still doesn’t make it easy to submit a form.`,
      evidence_id: "contact_form",
    });
  }
  return opps;
}

export function whyConsider(p: Prospect): string {
  const bits: string[] = [];
  bits.push(`${p.name} is a ${p.vertical.toLowerCase()} company in ${p.city || "an unknown city"}.`);
  if (p.review_count > 0) bits.push(`They have ${p.review_count} public reviews.`);
  if (p.google_rating && p.google_rating !== "UNKNOWN") bits.push(`Public rating: ${p.google_rating}.`);
  if (p.website_note) bits.push(p.website_note);
  else if (p.research_status === "blocked") {
    bits.push("Website research unavailable. Public listing information is still kept.");
  } else if (p.research_status === "failed") {
    bits.push("Website research failed, so we only know the public listing facts above.");
  } else if (p.research_status === "complete" || p.research_status === "partial") {
    const opps = opportunities(p);
    if (opps.length) bits.push(`Website research found ${opps.length} observable gap${opps.length === 1 ? "" : "s"} Lamb Ascension could talk about.`);
    else bits.push("Website research finished; we did not find a clear on-page gap we can honestly pitch yet.");
  } else {
    bits.push("We have not opened their website yet.");
  }
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  if (named.length) bits.push(`We identified ${named.map((c) => `${c.name}${c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : ""}`).join("; ")}.`);
  return bits.join(" ");
}

export function highValueTake(p: Prospect): { verdict: string; evidence: string[]; unknown: string[] } {
  const evidence: string[] = [...(p.readiness_why || [])];
  const unknown = [
    "Revenue",
    "Profit",
    "Advertising budget",
    "Whether they can pay a $2,500–$10,000/month retainer",
  ];
  if (!evidence.length) {
    if (p.vertical) evidence.push(`Category on file: ${p.vertical} (type signal, not revenue).`);
    if (p.review_count > 0) evidence.push(`${p.review_count} public reviews — one optional demand signal, not a requirement.`);
    if (p.job_value_est) evidence.push(`Typical job size we use for this category is about $${p.job_value_est.toLocaleString()} — an estimate, not verified.`);
    const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
    if (named.length) evidence.push(`Decision-maker on file: ${named.map((c) => c.name).join(", ")}.`);
  }
  if (p.google_rating === "UNKNOWN" || !p.google_rating) unknown.push("Google rating");
  const verdict = p.readiness || "NOT ENOUGH INFORMATION";
  return { verdict, evidence, unknown };
}

export function recommendOffer(p: Prospect): OfferPick {
  if (p.research_status !== "complete" && p.research_status !== "partial") {
    return {
      name: "Unknown",
      why: "We don’t have a finished website review, so picking Acquire / Convert / System would be a guess. Don’t sell a package until research completes or you look at the site yourself.",
    };
  }
  const opps = opportunities(p);
  const funnel = opps.some((o) => ["NO_HOMEPAGE_FORM", "NO_HOMEPAGE_CTA", "NO_CLICK_TO_CALL", "DEMAND_WEAK_FUNNEL"].includes(o.code));
  const noTrack = opps.some((o) => o.code === "NO_TRACKING");
  const tagsPresent = present(byId(p.findings, "meta_pixel")) || present(byId(p.findings, "gtm"));
  if (funnel && p.review_count >= 80 && tagsPresent) {
    return {
      name: "Convert",
      why: "They already look busy in public and tracking snippets are on the site, but the homepage still makes it hard to inquire. Convert (ads + landing/form path + tracking hygiene) matches what we actually saw — not System, because we don’t have proof they need a full $7.5K–$10K machine.",
    };
  }
  if (funnel) {
    return {
      name: "Convert",
      why: "The on-page path to call or submit a form is weak. Sending more traffic before that is fixed is a poor first sale. Convert matches the gaps we saw.",
    };
  }
  if (noTrack) {
    return {
      name: "Acquire",
      why: "We didn’t see common tracking snippets on the pages we checked, and we don’t have a strong funnel-gap pitch. Acquire (getting customers via Google + Meta) is the honest starting offer — still not a promise they will buy it.",
    };
  }
  return {
    name: "Acquire",
    why: "Research finished without a strong conversion-gap pitch. Acquire is the conservative offer: help them get customers. We still don’t know if they already buy ads.",
  };
}

export function explainCompany(p: Prospect): string {
  const opps = opportunities(p);
  const offer = recommendOffer(p);
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const lines = [
    whyConsider(p),
    `We do NOT know their revenue or advertising budget, so this does not prove they can afford a $10K/month retainer.`,
  ];
  if (p.readiness) lines.push(`Research class (not ability-to-pay): ${p.readiness}.`);
  if (opps.length) lines.push(`Opportunities we can point to: ${opps.map((o) => o.title.toLowerCase()).join("; ")}.`);
  if (named.length) {
    const c = named[0];
    lines.push(`Recommended next step: contact ${c.name}${c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : ""}${c.email ? ` (${c.email} — ${c.email_status})` : ""}.`);
  } else {
    lines.push("We do not have a verified person to email yet. Do not guess an address.");
  }
  if (p.research_status === "complete" || p.research_status === "partial" || named.length || (p.review_count >= 80)) {
    lines.push(`If you talk, suggested offer: ${offer.name}.`);
  }
  return lines.join("\n\n");
}

export function nextStepLabel(p: Prospect): string {
  if (p.stage === "Approved for Outreach") return "You already approved them. Draft outreach next — nothing sends until you confirm.";
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const email = (p.contacts || []).some((c) => c.email && c.email.includes("@") && c.email_status !== "none");
  if (named.length || email) return "Draft outreach — nothing sends until you approve.";
  if (p.research_status === "blocked" || p.research_status === "failed") {
    return "Website research unavailable. Find a decision maker from the listing phone or website, or skip. Do not invent an email.";
  }
  if (!named.length) return "Find decision maker. You can still open the website or call the listing number.";
  return "Approve if you want to talk. Skip if they’re not worth your time.";
}

export function approveIsPrimary(p: Prospect): boolean {
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  if (p.readiness === "NOT ENOUGH INFORMATION" || p.readiness === "LOW PRIORITY") return false;
  if (p.research_status === "blocked" && !named.length) return false;
  return Boolean(named.length || p.readiness === "STRONG CANDIDATE FOR FURTHER QUALIFICATION");
}
