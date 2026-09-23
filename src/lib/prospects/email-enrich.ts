/**
 * Bounded EMAIL enrichment from ALREADY-STORED Places / website / research payload only.
 * Does NOT scrape LinkedIn. Does NOT invent addresses. Fail closed.
 * Prefer usable EMAIL for contactability; phone enrich stays separate (Call Ready / PR #5).
 */
import type { DecisionMaker } from "../research/types.ts";
import type { Prospect } from "../review-brief.ts";
import { evaluateContactability, usableEmailRoute } from "./contactability.ts";
import { blankish, mergeContacts } from "./reach.ts";

export const MAX_EMAIL_ENRICH_ATTEMPTS_DEFAULT = 3;
export const EMAIL_ENRICH_ATTEMPTS_FINDING_ID = "email_enrich_attempts";

export type EmailEnrichHit = {
  email: string;
  source: "places_payload" | "website_finding" | "stored_field" | "research_contact";
  note: string;
  contactName?: string;
  contactTitle?: string;
};

export type EmailEnrichAttempt = {
  uid: string;
  hit: EmailEnrichHit | null;
  unresolved: boolean;
  attemptsAfter: number;
  note: string;
  eligible: boolean;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function looksLikeEmail(raw: string): boolean {
  const s = (raw || "").trim();
  if (!s || blankish(s)) return false;
  if (!s.includes("@")) return false;
  if (/^(unknown|n\/?a|none|null)$/i.test(s)) return false;
  const m = s.match(EMAIL_RE);
  if (!m) return false;
  const addr = m[0].toLowerCase();
  if (/^(info@info\.|admin@admin\.|user@user\.)/i.test(addr)) return false;
  return true;
}

export function needsEmailEnrichment(p: Prospect): boolean {
  if (usableEmailRoute(p)) return false;
  return evaluateContactability(p).status === "NEEDS_CONTACT_INFORMATION";
}

export function readEmailEnrichAttempts(p: Prospect): number {
  const f = (p.findings || []).find((x) => x.id === EMAIL_ENRICH_ATTEMPTS_FINDING_ID);
  if (!f) return 0;
  const n = parseInt(String(f.result || "0").replace(/\D/g, "") || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isEmailEnrichUnresolved(p: Prospect): boolean {
  const f = (p.findings || []).find((x) => x.id === EMAIL_ENRICH_ATTEMPTS_FINDING_ID);
  return Boolean(f && (/unresolved/i.test(f.result || "") || /unresolved/i.test(f.source || "")));
}

function stampAttempts(p: Prospect, attempts: number, unresolved: boolean, note: string): Prospect {
  const findings = [...(p.findings || [])];
  const idx = findings.findIndex((x) => x.id === EMAIL_ENRICH_ATTEMPTS_FINDING_ID);
  const row = {
    id: EMAIL_ENRICH_ATTEMPTS_FINDING_ID,
    result: unresolved ? `${attempts} unresolved` : String(attempts),
    status: unresolved ? ("UNKNOWN" as const) : ("OBSERVED" as const),
    source: note.slice(0, 200),
    checked_at: new Date().toISOString(),
  };
  if (idx >= 0) findings[idx] = row;
  else findings.push(row);
  return { ...p, findings };
}

export function extractStoredPublicEmail(p: Prospect): EmailEnrichHit | null {
  if (usableEmailRoute(p)) return null;

  for (const c of p.contacts || []) {
    const raw = (c.email || "").trim();
    if (c.email_status === "none" && looksLikeEmail(raw)) {
      return {
        email: raw.match(EMAIL_RE)![0],
        source: "research_contact",
        note: "From stored contact email field (status was none). Not invented.",
        contactName: c.name && c.name !== "UNKNOWN" ? c.name : undefined,
        contactTitle: c.title && c.title !== "UNKNOWN" ? c.title : undefined,
      };
    }
  }

  for (const f of p.findings || []) {
    if (f.id === EMAIL_ENRICH_ATTEMPTS_FINDING_ID) continue;
    if (f.status === "ERROR") continue;
    const id = (f.id || "").toLowerCase();
    if (!/email|mailto|contact/.test(id) && !/email|mailto/i.test(f.result || "")) continue;
    if (/linkedin/i.test(f.id || "") || /linkedin/i.test(f.source || "")) continue;
    const m = (f.result || "").match(EMAIL_RE);
    if (m && looksLikeEmail(m[0])) {
      return {
        email: m[0],
        source: /places/i.test(f.id || "") || /places/i.test(f.source || "")
          ? "places_payload"
          : "website_finding",
        note: `From stored finding ${f.id} (${f.source || "stored"}). Not invented.`,
      };
    }
  }

  const facts = p.facts || [];
  for (const fact of facts) {
    if (fact.status === "ERROR") continue;
    if (!/email|mailto/i.test(fact.key || "")) continue;
    if (/linkedin/i.test(fact.source || "")) continue;
    const v = (fact.value || "").trim();
    const m = v.match(EMAIL_RE);
    if (m && looksLikeEmail(m[0])) {
      return {
        email: m[0],
        source: "stored_field",
        note: `From stored fact ${fact.key} (${fact.source || "stored"}). Not invented.`,
      };
    }
  }

  const places = (p as { places?: Record<string, unknown> }).places;
  if (places && typeof places === "object") {
    for (const [k, v] of Object.entries(places)) {
      if (typeof v !== "string") continue;
      if (!/email|mailto/i.test(k)) continue;
      const m = v.match(EMAIL_RE);
      if (m && looksLikeEmail(m[0])) {
        return {
          email: m[0],
          source: "places_payload",
          note: `From stored Places field ${k}. Not invented.`,
        };
      }
    }
  }

  for (const raw of [p.contact_page, p.website_note, p.owner_notes]) {
    if (!raw || /linkedin/i.test(raw)) continue;
    const m = raw.match(/(?:mailto:)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (m && looksLikeEmail(m[1])) {
      return {
        email: m[1],
        source: "stored_field",
        note: "From stored contact_page / note text. Not invented.",
      };
    }
  }

  return null;
}

export function planEmailEnrichAttempt(
  p: Prospect,
  priorAttempts?: number,
  maxAttempts = MAX_EMAIL_ENRICH_ATTEMPTS_DEFAULT,
): EmailEnrichAttempt {
  const uid = p.uid || "";
  const prior = priorAttempts ?? readEmailEnrichAttempts(p);
  if (!needsEmailEnrichment(p)) {
    return {
      uid,
      hit: null,
      unresolved: false,
      attemptsAfter: prior,
      note: "Not eligible for email enrichment (already has usable email or not in NEEDS_CONTACT_INFORMATION).",
      eligible: false,
    };
  }
  if (prior >= maxAttempts) {
    return {
      uid,
      hit: null,
      unresolved: true,
      attemptsAfter: prior,
      note: `Max attempts (${maxAttempts}) reached with no public email in stored payload. Marked unresolved.`,
      eligible: true,
    };
  }
  const hit = extractStoredPublicEmail(p);
  const attemptsAfter = prior + 1;
  if (hit) {
    return { uid, hit, unresolved: false, attemptsAfter, note: hit.note, eligible: true };
  }
  const unresolved = attemptsAfter >= maxAttempts;
  return {
    uid,
    hit: null,
    unresolved,
    attemptsAfter,
    note: unresolved
      ? `No public email in stored Places/website/research payload after ${attemptsAfter} attempts. Unresolved — will not invent.`
      : `No public email in stored payload (attempt ${attemptsAfter}/${maxAttempts}).`,
    eligible: true,
  };
}

export function applyEmailHit(p: Prospect, hit: EmailEnrichHit): Prospect {
  const incoming: DecisionMaker = {
    name: hit.contactName || (p.contacts || []).find((c) => c.name && c.name !== "UNKNOWN")?.name || "UNKNOWN",
    title: hit.contactTitle || "",
    email: hit.email,
    email_status: "unverified",
    profile_url: "",
    source: hit.source === "website_finding"
      ? "website (stored)"
      : hit.source === "places_payload"
        ? "Google Places payload (stored)"
        : hit.source === "research_contact"
          ? "research contact (stored)"
          : "stored field",
    last_verified: "",
  };
  const stamped = stampAttempts(p, readEmailEnrichAttempts(p) + 1, false, hit.note);
  return {
    ...stamped,
    contacts: mergeContacts(stamped.contacts, [incoming]),
  };
}

export function applyEmailEnrichMiss(p: Prospect, plan: EmailEnrichAttempt): Prospect {
  return stampAttempts(p, plan.attemptsAfter, plan.unresolved, plan.note);
}

/** Pure batch planner — no DB. */
export function planEmailEnrichBatch(
  prospects: Prospect[],
  maxAttempts = MAX_EMAIL_ENRICH_ATTEMPTS_DEFAULT,
): EmailEnrichAttempt[] {
  return prospects.filter(needsEmailEnrichment).map((p) => planEmailEnrichAttempt(p, undefined, maxAttempts));
}
