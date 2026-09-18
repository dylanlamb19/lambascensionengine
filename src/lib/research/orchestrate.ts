import { adsFromFindings } from "./ads.ts";
import { attachPublishedEmails, extractEmails, extractPeople, extractSocials } from "./extract.ts";
import { fetchPublicPage, innerPaths, type PageFetch } from "./fetch-page.ts";
import { classifyQualification, shouldRunPaidEnrichment } from "./readiness.ts";
import { extractSiteSignals, mergeSignals, emptySignals, signalFacts } from "./site-signals.ts";
import type { Caps, DecisionMaker, DeepInput, DeepResult, EvidenceFact, PaidHunter } from "./types.ts";

function nowIso() {
  return new Date().toISOString();
}

function domainOf(website: string): string {
  try {
    const u = new URL(website.includes("://") ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function fact(
  key: string,
  value: string,
  source: string,
  status: EvidenceFact["status"],
  confidence: EvidenceFact["confidence"],
  checked_at: string,
): EvidenceFact {
  return { key, value, source, checked_at, confidence, status };
}

export async function runDeepResearch(
  input: DeepInput,
  caps: Caps,
  fetchPage: (url: string) => Promise<PageFetch> = fetchPublicPage,
  paidHunter?: PaidHunter,
): Promise<DeepResult> {
  const checked = nowIso();
  const facts: EvidenceFact[] = [];
  const socials: DeepResult["socials"] = [];
  let contacts: DecisionMaker[] = [];
  let pages = 0;
  let cents = 0;
  let websiteOk = false;
  let websiteNote = "";
  let signals = emptySignals();

  facts.push(fact("company_name", input.name, "prospect record", "VERIFIED", "high", checked));
  facts.push(fact("vertical", input.vertical || "UNKNOWN", "prospect record", input.vertical ? "VERIFIED" : "UNKNOWN", "medium", checked));
  facts.push(fact("city", input.city || "UNKNOWN", "prospect record", input.city ? "OBSERVED" : "UNKNOWN", "medium", checked));
  facts.push(fact("phone", input.phone && input.phone !== "UNKNOWN" ? input.phone : "UNKNOWN", "prospect record", input.phone && input.phone !== "UNKNOWN" ? "VERIFIED" : "UNKNOWN", "medium", checked));
  facts.push(fact("google_rating", input.google_rating && input.google_rating !== "UNKNOWN" ? input.google_rating : "UNKNOWN", "public listing", input.google_rating && input.google_rating !== "UNKNOWN" ? "VERIFIED" : "UNKNOWN", "high", checked));
  facts.push(fact("review_count", String(input.review_count || 0), "public listing", input.review_count ? "VERIFIED" : "UNKNOWN", "high", checked));
  facts.push(fact("locations_count", String(input.locations_count || 1), "prospect record", input.locations_count && input.locations_count > 1 ? "OBSERVED" : "UNKNOWN", "low", checked));
  facts.push(fact("years_in_business", input.years_in_business ? String(input.years_in_business) : "UNKNOWN", "prospect record", input.years_in_business ? "OBSERVED" : "UNKNOWN", "low", checked));
  facts.push(fact("revenue", "UNKNOWN", "none", "UNKNOWN", "high", checked));
  facts.push(fact("profit", "UNKNOWN", "none", "UNKNOWN", "high", checked));
  facts.push(fact("marketing_budget", "UNKNOWN", "none", "UNKNOWN", "high", checked));

  if (input.website) {
    const home = await fetchPage(input.website);
    pages += 1;
    if (home.ok) {
      websiteOk = true;
      websiteNote = "We opened their website and used it as one source among others.";
      facts.push(fact("website", home.final_url, "HTTP GET", "VERIFIED", "high", checked));
      signals = mergeSignals(signals, extractSiteSignals(home.html));
      const people = extractPeople(home.html, home.final_url, checked);
      const emails = extractEmails(home.html);
      socials.push(...extractSocials(home.html, home.final_url));
      contacts = attachPublishedEmails(people, emails);
      if (!contacts.length && emails.length) {
        for (const e of emails) {
          contacts.push({
            name: "UNKNOWN",
            title: "UNKNOWN",
            email: e,
            email_status: "unverified",
            profile_url: "",
            source: home.final_url,
            last_verified: checked,
          });
        }
      }
      for (const path of innerPaths(home.final_url).slice(0, 4)) {
        const inner = await fetchPage(path);
        pages += 1;
        if (!inner.ok) continue;
        signals = mergeSignals(signals, extractSiteSignals(inner.html));
        const more = extractPeople(inner.html, inner.final_url, checked);
        for (const p of more) {
          if (!contacts.some((c) => c.name === p.name)) contacts.push(p);
        }
        const moreMail = extractEmails(inner.html);
        contacts = attachPublishedEmails(
          contacts.filter((c) => c.name !== "UNKNOWN"),
          moreMail,
        ).concat(contacts.filter((c) => c.name === "UNKNOWN"));
        socials.push(...extractSocials(inner.html, inner.final_url));
      }
      if (!contacts.length) {
        facts.push(fact("decision_maker", "UNKNOWN", "website pages we could open", "UNKNOWN", "medium", checked));
      }
    } else {
      websiteNote = "We couldn't inspect their website, but we found other information about the business.";
      const st = home.blocked || input.research_status === "blocked" ? "UNKNOWN" : "ERROR";
      facts.push(fact("website", home.blocked ? "BLOCKED" : home.error || "FAILED", "HTTP GET", st, "low", checked));
    }
  } else {
    websiteNote = "No website on file. Other public listing facts are still below.";
    facts.push(fact("website", "UNKNOWN", "prospect record", "UNKNOWN", "high", checked));
  }

  const ads = adsFromFindings(input.findings, checked);
  const funnelOk = Boolean(
    input.findings?.some((f) =>
      ["contact_form", "contact_form_inner", "primary_cta", "gtm", "meta_pixel"].includes(f.id)
      && !/^(no |missing)/i.test(f.result || "")
      && f.status !== "ERROR" && f.status !== "UNKNOWN",
    ),
  );
  for (const s of signalFacts(signals)) {
    facts.push(fact(s.key, s.on ? s.plain : "UNKNOWN", "website wording (observed)", s.on ? "OBSERVED" : "UNKNOWN", "low", checked));
  }

  const qualification = classifyQualification(input, contacts, {
    websiteOk,
    socials: socials.length,
    signals,
    funnelOk,
  });

  let hunter_ran = false;
  let hunter_skipped_reason = "";
  const qualify = shouldRunPaidEnrichment(qualification, input.score, caps.minScoreForEnrichment);
  const domain = domainOf(input.website);
  if (!qualify) {
    hunter_skipped_reason = `Skipped paid contact lookup. ${qualification.readiness}. We do not buy emails until a company already looks promising — review count is not the gate.`;
  } else if (!paidHunter) {
    hunter_skipped_reason = "Paid contact lookup is server-gated. Hunter is not called from this path.";
  } else {
    const hunter = await paidHunter(domain);
    hunter_ran = hunter.ran;
    hunter_skipped_reason = hunter.skipped_reason;
    cents += hunter.cents;
    for (const c of hunter.contacts) {
      const dup = contacts.find((x) => (x.email && x.email === c.email) || (x.name && x.name === c.name));
      if (dup) {
        if (!dup.email && c.email) {
          dup.email = c.email;
          dup.email_status = c.email_status;
          dup.source = `${dup.source} + hunter.io`;
        }
      } else contacts.push(c);
    }
  }

  facts.push(fact("readiness", qualification.readiness, "research classification", "OBSERVED", "medium", checked));
  facts.push(fact("company_kind", qualification.kind, "vertical mapping", "OBSERVED", "medium", checked));

  return {
    facts,
    contacts,
    ads,
    socials: socials.filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i),
    readiness: qualification.readiness,
    website_note: websiteNote,
    hunter_ran,
    hunter_skipped_reason,
    estimated_cents: cents,
    pages_fetched: pages,
    readiness_why: qualification.why,
    company_kind: qualification.kind,
  };
}
