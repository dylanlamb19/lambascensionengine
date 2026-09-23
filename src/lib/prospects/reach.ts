import type { DecisionMaker } from "../research/types.ts";
import type { Prospect } from "../review-brief.ts";
import { isTestWorkflowUid } from "../mail/test-loop.ts";

export type ReachKind = "READY_TO_CONTACT" | "NEEDS_CONTACT_INFO" | "NEEDS_RESEARCH" | "BLOCKED" | "SUPPRESSED";

export type Provenance = "VERIFIED" | "FOUND PUBLICLY" | "ENRICHED" | "OWNER PROVIDED" | "UNKNOWN";

export type ContactField = {
  label: string;
  value: string;
  status: Provenance;
  source: string;
};

export type ProspectActionId =
  | "learn_more"
  | "open_website"
  | "find_contact"
  | "try_research"
  | "draft_outreach"
  | "draft_email"
  | "call"
  | "skip";

export type ProspectAction = {
  id: ProspectActionId;
  label: string;
  primary?: boolean;
};

export function blankish(v?: string | null): boolean {
  const s = (v || "").trim();
  return !s || s.toUpperCase() === "UNKNOWN";
}

export function verifiedWebsite(p: Prospect): string | null {
  const raw = (p.website || "").trim();
  if (!raw || blankish(raw)) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function listingPhone(p: Prospect): ContactField | null {
  if (blankish(p.phone)) return null;
  if (/owner provided/i.test(p.phone_source || "")) {
    return {
      label: "Business phone",
      value: p.phone,
      status: "OWNER PROVIDED",
      source: "owner",
    };
  }
  const ownerFinding = (p.findings || []).find((f) => f.id === "owner_phone" && /owner provided/i.test(f.source || ""));
  if (ownerFinding) {
    return {
      label: "Business phone",
      value: p.phone,
      status: "OWNER PROVIDED",
      source: "owner",
    };
  }
  const click = (p.findings || []).find((f) => f.id === "click_to_call" && f.status === "VERIFIED");
  if (click) {
    return {
      label: "Business phone",
      value: p.phone,
      status: "VERIFIED",
      source: click.source || "website tel: link",
    };
  }
  return {
    label: "Business phone",
    value: p.phone,
    status: "FOUND PUBLICLY",
    source: "public listing",
  };
}

export function namedPeople(p: Prospect): DecisionMaker[] {
  return (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
}

function emailProvenance(c: DecisionMaker): Provenance {
  if (/owner provided/i.test(c.email_source || c.source || "")) return "OWNER PROVIDED";
  if (c.email_status === "verified") return "VERIFIED";
  if (/hunter/i.test(c.source || "")) return "ENRICHED";
  if (c.email_status === "unverified") return "FOUND PUBLICLY";
  return "FOUND PUBLICLY";
}

export function usefulEmail(p: Prospect): ContactField | null {
  const withEmail = (p.contacts || []).filter((c) => c.email && c.email.includes("@") && c.email_status !== "none");
  const verified = withEmail.find((c) => c.email_status === "verified");
  const hit = verified || withEmail[0];
  if (!hit) return null;
  return {
    label: hit.name && hit.name !== "UNKNOWN" ? "Direct email" : "Business email",
    value: hit.email,
    status: emailProvenance(hit),
    source: hit.source || "prospect record",
  };
}

export function decisionMaker(p: Prospect): ContactField | null {
  const people = namedPeople(p);
  if (!people.length) return null;
  const c = people[0];
  const title = c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : "";
  const owner = /owner provided/i.test(c.name_source || c.source || "");
  return {
    label: "Decision maker",
    value: `${c.name}${title}`,
    status: owner ? "OWNER PROVIDED" : /hunter/i.test(c.source || "") ? "ENRICHED" : "FOUND PUBLICLY",
    source: c.name_source || c.source || "prospect record",
  };
}

export function contactFields(p: Prospect): ContactField[] {
  const out: ContactField[] = [];
  const people = namedPeople(p);
  const person = decisionMaker(p);
  const primary = people[0];
  out.push(person || { label: "Decision maker", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  const role = primary?.title && primary.title !== "UNKNOWN" ? primary.title : "";
  const roleOwner = /owner provided/i.test(primary?.title_source || primary?.source || "");
  out.push(role
    ? { label: "Role", value: role, status: roleOwner ? "OWNER PROVIDED" : /hunter/i.test(primary?.source || "") ? "ENRICHED" : "FOUND PUBLICLY", source: primary?.title_source || primary?.source || "prospect record" }
    : { label: "Role", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  const site = verifiedWebsite(p);
  const siteFact = (p.facts || []).find((f) => f.key === "website" && f.status === "VERIFIED");
  const siteOwner = /owner provided/i.test(p.website_source || "");
  out.push(site
    ? {
      label: "Website",
      value: site,
      status: siteOwner ? "OWNER PROVIDED" : siteFact ? "VERIFIED" : "FOUND PUBLICLY",
      source: siteOwner ? "owner" : siteFact?.source || "prospect record",
    }
    : { label: "Website", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  const phone = listingPhone(p);
  out.push(phone || { label: "Business phone", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  const email = usefulEmail(p);
  out.push(email || { label: "Business email", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  const profile = people.find((c) => c.profile_url);
  const profileOwner = /owner provided/i.test(profile?.profile_source || profile?.source || "");
  out.push(profile?.profile_url
    ? { label: "Profile", value: profile.profile_url, status: profileOwner ? "OWNER PROVIDED" : /hunter/i.test(profile.source) ? "ENRICHED" : "FOUND PUBLICLY", source: profile.profile_source || profile.source }
    : { label: "Profile", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  const ownerPage = (p.contact_page || "").trim();
  const form = (p.findings || []).find((f) =>
    (f.id === "contact_form" || f.id === "contact_form_inner" || f.id === "owner_contact_page")
    && f.status !== "ERROR"
    && !/^(no |missing)/i.test(f.result || ""),
  );
  if (ownerPage) {
    out.push({ label: "Contact page", value: ownerPage, status: /owner provided/i.test(p.contact_page_source || "") ? "OWNER PROVIDED" : "FOUND PUBLICLY", source: p.contact_page_source || "owner" });
  } else if (form && form.id !== "owner_contact_page" && form.status === "VERIFIED") {
    out.push({ label: "Contact form", value: "Observed on their website", status: "FOUND PUBLICLY", source: form.source || "website HTML" });
  } else {
    out.push({ label: "Contact page", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  }
  const li = (p.socials || []).find((s) => s.network === "linkedin");
  const liOwner = /owner provided/i.test(li?.source || "");
  out.push(li
    ? { label: "Company LinkedIn", value: li.url, status: liOwner ? "OWNER PROVIDED" : "FOUND PUBLICLY", source: li.source }
    : { label: "Company LinkedIn", value: "UNKNOWN", status: "UNKNOWN", source: "none" });
  if (p.owner_notes) {
    out.push({ label: "Owner note", value: p.owner_notes, status: "OWNER PROVIDED", source: "owner" });
  }
  return out;
}

/** Same gate as evaluateContactability: test, demo, and unnamed rows are not ready to contact. */
function blockedFromAutonomousContact(p: Prospect): boolean {
  if (p.is_demo) return true;
  if (isTestWorkflowUid(p.uid)) return true;
  const name = (p.name || "").trim();
  if (!name || /^unknown$/i.test(name)) return true;
  return false;
}

export function reachKind(p: Prospect): ReachKind {
  // Acquisition OS Part 1: EMAIL-only READY TO CONTACT.
  // Phone / LinkedIn / contact-form do not count as autonomous contactability.
  if (p.suppressed) return "SUPPRESSED";
  if (p.stage === "Do Not Contact") return "BLOCKED";
  const email = usefulEmail(p);
  if (email) {
    if (blockedFromAutonomousContact(p)) return "BLOCKED";
    return "READY_TO_CONTACT";
  }
  const researched = p.research_status === "complete" || p.research_status === "partial"
    || p.research_status === "blocked" || p.research_status === "failed";
  if (!researched && !listingPhone(p) && !verifiedWebsite(p)) return "NEEDS_RESEARCH";
  if (!researched && p.research_status === "queued") return "NEEDS_RESEARCH";
  return "NEEDS_CONTACT_INFO";
}

export function reachLabel(kind: ReachKind): string {
  switch (kind) {
    case "READY_TO_CONTACT": return "READY TO CONTACT";
    case "NEEDS_CONTACT_INFO": return "NEEDS CONTACT INFORMATION";
    case "NEEDS_RESEARCH": return "NEEDS RESEARCH";
    case "BLOCKED": return "BLOCKED";
    case "SUPPRESSED": return "SUPPRESSED";
  }
}

export function reachTone(kind: ReachKind): "good" | "warn" | "bad" {
  if (kind === "READY_TO_CONTACT") return "good";
  if (kind === "BLOCKED" || kind === "SUPPRESSED") return "bad";
  return "warn";
}

export function whySurfaced(p: Prospect): string {
  if (p.research_status === "blocked") {
    return "Website research unavailable (the site blocked our check). Public listing facts remain. We did not invent an audit.";
  }
  if (p.research_status === "failed") {
    return "Website research unavailable (timeout or error). Public listing facts remain. We did not invent findings.";
  }
  if (p.research_status === "queued" || p.research_status === "none" || !p.research_status) {
    return "They\u2019re on your list. We haven\u2019t opened their website yet.";
  }
  if (p.fit_plain) return p.fit_plain;
  return "They\u2019re a real company in a market you sell into.";
}

export function whatWeKnow(p: Prospect): string[] {
  const bits: string[] = [];
  if (p.vertical) bits.push(p.vertical);
  if (p.city && !blankish(p.city)) bits.push(p.city);
  if (verifiedWebsite(p)) bits.push("Website on file");
  const phone = listingPhone(p);
  if (phone) bits.push(`Phone ${phone.status === "VERIFIED" ? "verified" : "on listing"}`);
  const email = usefulEmail(p);
  if (email) bits.push(`Email ${email.status.toLowerCase()}`);
  const person = decisionMaker(p);
  if (person) bits.push(person.value);
  else bits.push("Decision maker unknown");
  if (p.review_count > 0) bits.push(`${p.review_count} public reviews`);
  return bits;
}

export function araRecommend(p: Prospect): string {
  const kind = reachKind(p);
  if (kind === "SUPPRESSED") return "This company is suppressed. Leave them alone.";
  if (kind === "BLOCKED") return "This company is on Do Not Contact. Leave them alone.";
  if (kind === "READY_TO_CONTACT") {
    const person = decisionMaker(p);
    const email = usefulEmail(p);
    if (email) return `Draft outreach to ${email.value}${person ? ` (${person.value})` : ""}. Nothing sends until you confirm.`;
    return "You have a usable email route. Draft outreach, then you approve the send.";
  }
  if (kind === "NEEDS_RESEARCH") return "Look them up before you spend time on outreach.";
  if (listingPhone(p) || verifiedWebsite(p)) {
    return "Find a usable email before autonomous outreach. You can still call the listing number or open the site.";
  }
  return "Find a legitimate public email before outreach. Do not guess an email.";
}

export function prospectActions(p: Prospect, opts?: { gmailConnected?: boolean }): ProspectAction[] {
  const blocked = reachKind(p);
  if (blocked === "BLOCKED" || blocked === "SUPPRESSED") {
    return [{ id: "learn_more", label: "Learn More", primary: true }];
  }
  const kind = blocked;
  const site = verifiedWebsite(p);
  const phone = listingPhone(p);
  const email = usefulEmail(p);
  const failed = p.research_status === "blocked" || p.research_status === "failed";
  const out: ProspectAction[] = [];
  const primary: ProspectActionId =
    kind === "READY_TO_CONTACT" ? (email ? "draft_email" : "draft_outreach")
      : kind === "NEEDS_RESEARCH" ? "try_research"
        : "find_contact";

  const push = (id: ProspectActionId, label: string) => {
    if (out.some((a) => a.id === id)) return;
    out.push({ id, label, primary: id === primary });
  };

  push("learn_more", "Learn More");
  if (site) push("open_website", "Open Website");
  if (phone) push("call", "Call");
  if (kind !== "READY_TO_CONTACT" || !email) push("find_contact", "Find Contact");
  if (failed) push("try_research", "Try Research Again");
  if (kind === "NEEDS_RESEARCH") push("try_research", "Look them up");
  if (email) push("draft_email", opts?.gmailConnected === false ? "Draft Email" : "Draft Email");
  else push("draft_outreach", "Draft Outreach");
  push("skip", "Skip");
  return out;
}

export function mergeContacts(current: DecisionMaker[] | undefined, incoming: DecisionMaker[]): DecisionMaker[] {
  const out = [...(current || [])];
  for (const c of incoming) {
    const dup = out.find((x) =>
      (c.email && x.email && c.email.toLowerCase() === x.email.toLowerCase())
      || (c.name && c.name !== "UNKNOWN" && x.name === c.name),
    );
    if (dup) {
      if ((!dup.email || dup.email_status === "none") && c.email) {
        dup.email = c.email;
        dup.email_status = c.email_status;
        dup.source = dup.source ? `${dup.source} + ${c.source}` : c.source;
      }
      if ((!dup.profile_url) && c.profile_url) dup.profile_url = c.profile_url;
      if ((!dup.title || dup.title === "UNKNOWN") && c.title && c.title !== "UNKNOWN") dup.title = c.title;
    } else {
      out.push(c);
    }
  }
  return out;
}

export function nextResearchStatus(current: string, opts: { siteOk: boolean; foundContact: boolean }): string {
  if (opts.siteOk) return "complete";
  if (opts.foundContact) return "partial";
  if (current === "queued" || current === "none" || !current) return "failed";
  return current;
}

export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

export function taskForProspect(p: Prospect): {
  severity: "green" | "yellow" | "red";
  title: string;
  plain: string;
  why: string;
  recommend: string;
  button: string;
  action: string;
  retry: boolean;
} {
  const kind = reachKind(p);
  const retry = p.research_status === "blocked" || p.research_status === "failed" || kind === "NEEDS_RESEARCH";
  if (p.stage === "Call Booked") {
    return {
      severity: "yellow",
      title: `Prepare for the ${p.name} call`,
      plain: "The meeting is on the calendar.",
      why: whySurfaced(p),
      recommend: "Open call prep.",
      button: "Prep",
      action: "prep",
      retry: false,
    };
  }
  if (p.stage === "Approved for Outreach" && !p.suppressed) {
    return {
      severity: "yellow",
      title: `Contact ${p.name}`,
      plain: p.is_demo ? "DEMO. Preview the note, then you approve the send." : "A draft is waiting. Nothing sends until you confirm.",
      why: whySurfaced(p),
      recommend: araRecommend(p),
      button: "Draft Outreach",
      action: "outreach",
      retry,
    };
  }
  if (kind === "READY_TO_CONTACT") {
    return {
      severity: "green",
      title: `Contact ${p.name}`,
      plain: whatWeKnow(p).join(" · "),
      why: whySurfaced(p),
      recommend: araRecommend(p),
      button: usefulEmail(p) ? "Draft Email" : "Draft Outreach",
      action: "outreach",
      retry: false,
    };
  }
  if (kind === "NEEDS_RESEARCH") {
    return {
      severity: "yellow",
      title: `Look up ${p.name}`,
      plain: whatWeKnow(p).join(" · ") || "They\u2019re on your list. We haven\u2019t opened their website yet.",
      why: whySurfaced(p),
      recommend: araRecommend(p),
      button: "Learn More",
      action: "open",
      retry: true,
    };
  }
  return {
    severity: "yellow",
    title: `${p.name} needs a contact`,
    plain: whatWeKnow(p).join(" · "),
    why: whySurfaced(p),
    recommend: araRecommend(p),
    button: "Find Contact",
    action: "find_contact",
    retry,
  };
}
