import type { Prospect } from "../review-brief.ts";
import { ensureUid, nameKey, normalizeName, websiteDomain } from "./ids.ts";

const STAGE_RANK: Record<string, number> = {
  New: 1,
  Researching: 2,
  Qualified: 3,
  "Ready for Review": 4,
  "Approved for Outreach": 5,
  Contacted: 6,
  Replied: 7,
  "Call Booked": 8,
  "Proposal Sent": 9,
  Negotiation: 10,
  Won: 11,
  Lost: 3,
  "Do Not Contact": 12,
};

export function matchExisting(existing: Prospect[], incoming: Prospect): Prospect | undefined {
  if (incoming.uid) {
    const byUid = existing.find((e) => e.uid && e.uid === incoming.uid);
    if (byUid) return byUid;
  }
  if (incoming.provider_place_id) {
    const byPlace = existing.find((e) => e.provider_place_id && e.provider_place_id === incoming.provider_place_id);
    if (byPlace) return byPlace;
  }
  const domain = websiteDomain(incoming.website);
  const city = (incoming.city || "").trim().toLowerCase();
  if (domain) {
    const byDomain = existing.find(
      (e) => websiteDomain(e.website) === domain && (e.city || "").trim().toLowerCase() === city,
    );
    if (byDomain) return byDomain;
  }
  const n = normalizeName(incoming.name);
  return existing.find(
    (e) => normalizeName(e.name) === n && (e.city || "").trim().toLowerCase() === city,
  );
}

export type SpokenProspect = {
  uid?: string;
  name: string;
  city?: string;
  provider_place_id?: string;
};

/**
 * Safe spoken-name resolution. Exact uid, exact/normalized name, or a strong
 * full-name contains. Never matches a single generic token like "roofing".
 */
export function matchProspectsBySpokenName<T extends SpokenProspect>(
  prospects: T[],
  spoken: string,
  opts?: { openUid?: string },
): T[] {
  const raw = (spoken || "").trim();
  if (!raw) return [];
  const byUid = prospects.filter((p) => p.uid && p.uid === raw);
  if (byUid.length) return byUid;
  const byPlace = prospects.filter((p) => p.provider_place_id && p.provider_place_id === raw);
  if (byPlace.length) return byPlace;

  const key = nameKey(raw);
  if (key.length < 3) return [];

  const exact = prospects.filter((p) => nameKey(p.name) === key);
  if (exact.length) return exact;

  const strong = prospects.filter((p) => {
    const nk = nameKey(p.name);
    if (!nk || nk.length < 4) return false;
    if (key === nk) return true;
    const shorter = key.length <= nk.length ? key : nk;
    const longer = key.length > nk.length ? key : nk;
    if (!longer.includes(shorter)) return false;
    const tokens = shorter.split(" ").filter(Boolean);
    return tokens.length >= 2 || shorter.length >= 12;
  });
  if (strong.length) return strong;

  const openUid = opts?.openUid;
  if (openUid) {
    const open = prospects.find((p) => p.uid === openUid);
    if (open && (nameKey(open.name) === key || (nameKey(open.name).includes(key) && key.length >= 8))) {
      return [open];
    }
  }
  return [];
}

function richerResearch(a: Prospect, b: Prospect): Prospect {
  const order = ["none", "queued", "failed", "blocked", "partial", "complete"];
  const ar = order.indexOf(a.research_status || "none");
  const br = order.indexOf(b.research_status || "none");
  if (br > ar) return b;
  if (ar > br) return a;
  const af = (a.facts?.length || 0) + (a.findings?.length || 0);
  const bf = (b.facts?.length || 0) + (b.findings?.length || 0);
  return bf > af ? b : a;
}

export function mergeProspect(server: Prospect, incoming: Prospect): Prospect {
  const research = richerResearch(server, incoming);
  const serverRank = STAGE_RANK[server.stage] || 0;
  const inRank = STAGE_RANK[incoming.stage] || 0;
  const keepDnc = server.stage === "Do Not Contact" || incoming.stage === "Do Not Contact" || server.suppressed || incoming.suppressed;
  const stage = keepDnc ? "Do Not Contact" : inRank > serverRank ? incoming.stage : server.stage;
  return {
    ...server,
    ...incoming,
    uid: server.uid || incoming.uid,
    id: server.id,
    stage,
    stage_plain: keepDnc ? "Skipped — do not contact" : incoming.stage === stage ? incoming.stage_plain : server.stage_plain,
    suppressed: Boolean(keepDnc),
    findings: research.findings,
    facts: research.facts?.length ? research.facts : server.facts,
    contacts: (incoming.contacts?.length ? incoming.contacts : server.contacts) || [],
    ads: incoming.ads?.length ? incoming.ads : server.ads,
    socials: incoming.socials?.length ? incoming.socials : server.socials,
    outreach: incoming.outreach || server.outreach,
    discovery: incoming.discovery || server.discovery,
    history: [...(server.history || []), ...(incoming.history || [])].slice(-50),
    research_status: research.research_status,
    readiness: research.readiness || server.readiness,
    readiness_why: (research.readiness_why && research.readiness_why.length)
      ? research.readiness_why
      : server.readiness_why,
    company_kind: research.company_kind || server.company_kind,
    website_note: research.website_note || server.website_note,
    deep_at: research.deep_at || server.deep_at,
    provider_place_id: incoming.provider_place_id || server.provider_place_id,
    provider_source_url: incoming.provider_source_url || server.provider_source_url,
  };
}

export function importWithoutDuplicates(existing: Prospect[], incoming: Prospect[]): {
  next: Prospect[];
  imported: Prospect[];
  merged: Prospect[];
} {
  const next = existing.map((e) => ({ ...e }));
  const imported: Prospect[] = [];
  const merged: Prospect[] = [];
  for (const raw of incoming) {
    const p = ensureUid(raw);
    const hit = matchExisting(next, p);
    if (hit) {
      // UID is the only row locator. Numeric id is display/legacy and must
      // never pick a different company that happens to share client_id 7.
      const idx = hit.uid ? next.findIndex((e) => e.uid === hit.uid) : -1;
      const combined = mergeProspect(hit, p);
      if (idx >= 0) next[idx] = combined;
      else next.push(combined);
      merged.push(combined);
    } else {
      const withId = { ...p, id: p.id && !next.some((e) => e.id === p.id) ? p.id : Math.max(0, ...next.map((e) => e.id)) + 1 };
      next.push(withId);
      imported.push(withId);
    }
  }
  return { next, imported, merged };
}
