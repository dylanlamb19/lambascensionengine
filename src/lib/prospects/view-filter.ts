/**
 * Validated Pipeline VIEW filter. Never mutates records. Never generates SQL.
 * The model may propose this schema; the app validates and executes it.
 */
import { mapSpokenVertical } from "../discovery/places.ts";
import { isTestWorkflowUid } from "../mail/test-loop.ts";
import { fitHeadline, websiteResearchState, type FitHeadline } from "./qualify.ts";
import { listingPhone, namedPeople, reachKind, usefulEmail, verifiedWebsite, type ReachKind } from "./reach.ts";
import type { Prospect } from "../review-brief.ts";
import type { LastDiscovery } from "./last-discovery.ts";
import { matchesQueue, type PipelineQueue } from "./pipeline-queues.ts";

export const FIT_FILTER = ["GOOD FIT", "POSSIBLE FIT", "NEED MORE INFORMATION"] as const;
export const RESEARCH_FILTER = ["done", "unavailable", "not_started"] as const;
export const REACH_FILTER = ["READY_TO_CONTACT", "NEEDS_CONTACT_INFO", "NEEDS_RESEARCH", "BLOCKED", "SUPPRESSED"] as const;
export const QUEUE_FILTER = ["ACTIVE_PIPELINE", "NEEDS_CONTACT_INFORMATION", "NEEDS_RESEARCH", "NEEDS_DYLAN", "ARCHIVE_NOT_PURSUING", "SUPPRESSED"] as const;
export const SORT_FILTER = ["best_fit", "newest", "most_reviewed", "needs_attention", "score"] as const;

export type ProspectViewFilter = {
  vertical?: string[];
  city?: string;
  fit?: FitHeadline[];
  research?: (typeof RESEARCH_FILTER)[number][];
  reach?: ReachKind[];
  stage?: string[];
  hasPhone?: boolean;
  hasEmail?: boolean;
  hasWebsite?: boolean;
  hasDecisionMaker?: boolean;
  source?: string[];
  excludeTest?: boolean;
  excludeDemo?: boolean;
  addedAfter?: string;
  minReviews?: number;
  minRating?: number;
  prospectUids?: string[];
  lastDiscovery?: boolean;
  sort?: (typeof SORT_FILTER)[number];
  limit?: number;
  replace?: boolean;
  /** Acquisition OS derived queue (Part 2). */
  queue?: (typeof QUEUE_FILTER)[number];
};

export type FilterableProspect = {
  uid: string;
  name: string;
  vertical: string;
  city: string;
  fitHeadline: FitHeadline;
  research: (typeof RESEARCH_FILTER)[number];
  reach: ReachKind;
  stage: string;
  stage_plain?: string;
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasDecisionMaker: boolean;
  source: string;
  isDemo: boolean;
  isTest: boolean;
  addedAt: string;
  reviewCount: number;
  rating: number;
  score: number;
  website?: string;
  phone?: string;
};

export type SpokenFilterResult =
  | { kind: "filter"; filter: ProspectViewFilter }
  | { kind: "unknown"; reason: string }
  | { kind: "ask"; ask: string }
  | { kind: "none" };

const ALLOWED_KEYS = new Set([
  "vertical", "city", "fit", "research", "reach", "stage",
  "hasPhone", "hasEmail", "hasWebsite", "hasDecisionMaker",
  "source", "excludeTest", "excludeDemo", "addedAfter",
  "minReviews", "minRating", "prospectUids", "lastDiscovery",
  "sort", "limit", "replace", "queue",
]);

export function isFilterEmpty(f: ProspectViewFilter | null | undefined): boolean {
  if (!f) return true;
  return Object.keys(f).every((k) => k === "replace" || (f as Record<string, unknown>)[k] === undefined);
}

export function asFilterable(p: Partial<FilterableProspect> & { uid: string; name: string }): FilterableProspect {
  return {
    uid: p.uid,
    name: p.name,
    vertical: p.vertical || "",
    city: p.city || "",
    fitHeadline: p.fitHeadline || "NEED MORE INFORMATION",
    research: p.research || "not_started",
    reach: p.reach || "NEEDS_RESEARCH",
    stage: p.stage || "",
    stage_plain: p.stage_plain,
    hasPhone: Boolean(p.hasPhone || (p.phone && p.phone !== "UNKNOWN")),
    hasEmail: Boolean(p.hasEmail),
    hasWebsite: Boolean(p.hasWebsite || (p.website && p.website !== "UNKNOWN")),
    hasDecisionMaker: Boolean(p.hasDecisionMaker),
    source: p.source || "manual",
    isDemo: Boolean(p.isDemo),
    isTest: Boolean(p.isTest),
    addedAt: p.addedAt || "",
    reviewCount: Number(p.reviewCount || 0),
    rating: Number(p.rating || 0),
    score: Number(p.score || 0),
    website: p.website,
    phone: p.phone,
  };
}

export function fromProspect(p: Prospect): FilterableProspect {
  const rating = Number.parseFloat(String(p.google_rating || ""));
  return {
    uid: p.uid || "",
    name: p.name,
    vertical: p.vertical || "",
    city: p.city || "",
    fitHeadline: fitHeadline(p),
    research: websiteResearchState(p),
    reach: reachKind(p),
    stage: p.stage || "",
    stage_plain: p.stage_plain,
    hasPhone: Boolean(listingPhone(p)),
    hasEmail: Boolean(usefulEmail(p)),
    hasWebsite: Boolean(verifiedWebsite(p)),
    hasDecisionMaker: namedPeople(p).length > 0,
    source: p.provider || "manual",
    isDemo: Boolean(p.is_demo),
    isTest: isTestWorkflowUid(p.uid),
    addedAt: p.discovered_at || p.deep_at || "",
    reviewCount: Number(p.review_count || 0),
    rating: Number.isFinite(rating) ? rating : 0,
    score: Number(p.score || 0),
    website: p.website,
    phone: p.phone,
  };
}

function asStringArray(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const out = arr.map((x) => String(x || "").trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return undefined;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  const arr = asStringArray(v);
  if (!arr) return undefined;
  const hit = arr
    .map((x) => allowed.find((a) => a.toLowerCase() === x.toLowerCase() || a.replace(/_/g, " ").toLowerCase() === x.toLowerCase()))
    .filter((x): x is T => Boolean(x));
  return hit.length ? [...new Set(hit)] : undefined;
}

/** Drop unknown keys. Never accept arbitrary predicates. */
export function validateProspectFilter(raw: unknown): { filter: ProspectViewFilter; unknown: string[] } {
  const unknown: string[] = [];
  if (!raw || typeof raw !== "object") return { filter: {}, unknown };
  const input = raw as Record<string, unknown>;
  for (const k of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(k) && input[k] !== undefined && input[k] !== null && input[k] !== "") {
      unknown.push(k);
    }
  }
  const vertical = asStringArray(input.vertical)?.map((v) => mapSpokenVertical(v));
  const city = String(input.city || "").trim();
  const minReviews = input.minReviews == null || input.minReviews === "" ? undefined : Math.max(0, Math.floor(Number(input.minReviews)));
  const minRating = input.minRating == null || input.minRating === "" ? undefined : Math.max(0, Math.min(5, Number(input.minRating)));
  const limit = input.limit == null || input.limit === "" ? undefined : Math.min(50, Math.max(1, Math.floor(Number(input.limit))));
  const addedAfter = String(input.addedAfter || "").trim();
  const filter: ProspectViewFilter = {};
  if (vertical?.length) filter.vertical = vertical;
  if (city) filter.city = city;
  const fit = pickEnum(input.fit, FIT_FILTER);
  if (fit) filter.fit = fit as FitHeadline[];
  const research = pickEnum(input.research, RESEARCH_FILTER);
  if (research) filter.research = research;
  const reach = pickEnum(input.reach, REACH_FILTER);
  if (reach) filter.reach = reach as ReachKind[];
  const stage = asStringArray(input.stage);
  if (stage) filter.stage = stage;
  const hasPhone = asBool(input.hasPhone);
  if (hasPhone !== undefined) filter.hasPhone = hasPhone;
  const hasEmail = asBool(input.hasEmail);
  if (hasEmail !== undefined) filter.hasEmail = hasEmail;
  const hasWebsite = asBool(input.hasWebsite);
  if (hasWebsite !== undefined) filter.hasWebsite = hasWebsite;
  const hasDecisionMaker = asBool(input.hasDecisionMaker);
  if (hasDecisionMaker !== undefined) filter.hasDecisionMaker = hasDecisionMaker;
  const source = asStringArray(input.source);
  if (source) filter.source = source;
  const excludeTest = asBool(input.excludeTest);
  if (excludeTest !== undefined) filter.excludeTest = excludeTest;
  const excludeDemo = asBool(input.excludeDemo);
  if (excludeDemo !== undefined) filter.excludeDemo = excludeDemo;
  if (addedAfter) filter.addedAfter = addedAfter;
  if (minReviews != null && Number.isFinite(minReviews)) filter.minReviews = minReviews;
  if (minRating != null && Number.isFinite(minRating)) filter.minRating = minRating;
  const uids = asStringArray(input.prospectUids);
  if (uids) filter.prospectUids = uids;
  const lastDiscovery = asBool(input.lastDiscovery);
  if (lastDiscovery !== undefined) filter.lastDiscovery = lastDiscovery;
  const sort = pickEnum(input.sort, SORT_FILTER)?.[0];
  if (sort) filter.sort = sort;
  if (limit != null && Number.isFinite(limit)) filter.limit = limit;
  const replace = asBool(input.replace);
  if (replace !== undefined) filter.replace = replace;
  const queue = pickEnum(input.queue, QUEUE_FILTER)?.[0];
  if (queue) filter.queue = queue;
  return { filter, unknown };
}

export function composeProspectFilter(current: ProspectViewFilter, incoming: ProspectViewFilter): ProspectViewFilter {
  if (incoming.replace || isFilterEmpty(incoming)) {
    const next = { ...incoming };
    delete next.replace;
    return next;
  }
  const out: ProspectViewFilter = { ...current };
  delete out.replace;
  const keys = Object.keys(incoming) as (keyof ProspectViewFilter)[];
  for (const k of keys) {
    if (k === "replace") continue;
    if (incoming[k] !== undefined) (out as Record<string, unknown>)[k] = incoming[k];
  }
  if (incoming.prospectUids && current.prospectUids) {
    const keep = new Set(incoming.prospectUids);
    out.prospectUids = current.prospectUids.filter((u) => keep.has(u));
  }
  return out;
}

export type FilterIntentMode = "refine" | "replace";

const SEMANTIC_KEYS: (keyof ProspectViewFilter)[] = [
  "vertical", "city", "fit", "research", "reach", "stage",
  "hasPhone", "hasEmail", "hasWebsite", "hasDecisionMaker",
  "source", "excludeTest", "excludeDemo", "addedAfter",
  "minReviews", "minRating", "prospectUids", "queue",
];

function semanticCount(f: ProspectViewFilter): number {
  let n = 0;
  for (const k of SEMANTIC_KEYS) if (f[k] !== undefined) n += 1;
  return n;
}

function isSortOnlyFilter(f: ProspectViewFilter): boolean {
  const copy: ProspectViewFilter = { ...f };
  delete copy.sort;
  delete copy.replace;
  delete copy.limit;
  delete copy.lastDiscovery;
  return isFilterEmpty(copy);
}

function normalizeUtterance(raw: string): string {
  return (raw || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Last Find Clients set: those / you just found / the five you matched. */
export function refersToLastSearch(raw: string): boolean {
  const t = normalizeUtterance(raw);
  if (!t) return false;
  if (/\b(you just (found|matched)|just (found|matched)|last search|what you found|what you just)\b/.test(t)) return true;
  if (/\b(those|these) (roofers|companies|prospects|ones|\d+|five)\b/.test(t)) return true;
  if (/^(show( me)? (those|these|them)|show those|show these|show them)\b/.test(t)) return true;
  if (/\bthe (five|\d+) .+ (you |just )?(found|matched)\b/.test(t)) return true;
  if (/\bfrom those\b/.test(t)) return true;
  return false;
}

/** Narrowing the current Pipeline view, not starting a new query. */
export function refersToCurrentSet(raw: string): boolean {
  const t = normalizeUtterance(raw);
  if (!t) return false;
  if (refersToLastSearch(t)) return true;
  if (/\b(of those|among (these|those|them)|from (this|that) list|from these)\b/.test(t)) return true;
  if (/\bwhich of (those|these|them)\b/.test(t)) return true;
  if (/\b(these|those) ones\b/.test(t)) return true;
  if (/\bonly (show )?(the )?(ones|good|possible)\b/.test(t)) return true;
  if (/\bjust the ones\b/.test(t)) return true;
  if (/\bnow (just |only )?(show )?(me )?(the ones|those|these|the good)\b/.test(t)) return true;
  if (/\bthe ones (that |with |who |without |still )\b/.test(t)) return true;
  if (/\bhide the ones\b/.test(t)) return true;
  if (/\bsort (those|these|them)\b/.test(t)) return true;
  if (/\bwhich ones\b/.test(t)) return true;
  return false;
}

function hasNarrowingConstraint(f: ProspectViewFilter): boolean {
  return Boolean(
    f.fit || f.research || f.reach || f.stage
    || f.hasPhone !== undefined || f.hasEmail !== undefined || f.hasWebsite !== undefined || f.hasDecisionMaker !== undefined
    || f.excludeTest || f.excludeDemo || f.addedAfter || f.minReviews || f.minRating || f.sort
    || f.source,
  );
}

function isStandalonePayload(f: ProspectViewFilter): boolean {
  if (f.addedAfter) return true;
  if (f.vertical?.length || f.city) return true;
  return semanticCount(f) >= 2;
}

/**
 * REFINE_CURRENT_VIEW vs REPLACE_CURRENT_VIEW.
 * Utterance deixis wins. A fully specified new query replaces leftover filters
 * even if the model passed compose=true.
 */
export function classifyFilterIntent(
  incoming: ProspectViewFilter,
  opts?: { utterance?: string; current?: ProspectViewFilter },
): FilterIntentMode {
  const t = normalizeUtterance(opts?.utterance || "");
  if (incoming.replace === true && isFilterEmpty({ ...incoming, replace: undefined })) return "replace";
  if (t && /^(clear filters|reset (the )?list|show everything( again)?|show all( of them)?( again)?|show all prospects|start over|show (me )?everything)$/.test(t)) {
    return "replace";
  }
  if (t && refersToLastSearch(t) && !hasNarrowingConstraint(incoming)) return "replace";
  if (t && refersToCurrentSet(t)) return "refine";
  if (isSortOnlyFilter(incoming) && !incoming.vertical && !incoming.city) return "refine";
  if (t && !refersToCurrentSet(t) && isStandalonePayload(incoming)) return "replace";
  if (!t && isStandalonePayload(incoming)) return "replace";
  if (incoming.replace === true) return "replace";
  if (incoming.replace === false) return "refine";
  if (incoming.lastDiscovery && semanticCount(incoming) <= 1) return "refine";
  if (semanticCount(incoming) <= 1) return "refine";
  return "replace";
}

/** Single place that turns an incoming filter into the next Pipeline VIEW. */
export function resolveProspectFilter(
  current: ProspectViewFilter,
  incoming: ProspectViewFilter,
  opts?: { utterance?: string },
): { filter: ProspectViewFilter; mode: FilterIntentMode } {
  const mode = classifyFilterIntent(incoming, { utterance: opts?.utterance, current });
  const nextIn: ProspectViewFilter = { ...incoming };
  if (mode === "replace") {
    nextIn.replace = true;
    if (!refersToLastSearch(opts?.utterance || "")) {
      delete nextIn.lastDiscovery;
      delete nextIn.prospectUids;
    }
  } else {
    nextIn.replace = false;
  }
  return { filter: composeProspectFilter(current, nextIn), mode };
}

function cityMatch(have: string, want: string): boolean {
  const a = have.toLowerCase().trim();
  const b = want.toLowerCase().replace(/,?\s*(texas|tx)\s*$/i, "").trim();
  if (!b) return true;
  return a.includes(b) || b.includes(a);
}

function matches(p: FilterableProspect, f: ProspectViewFilter, last: LastDiscovery | null): boolean {
  let uids = f.prospectUids;
  if (f.lastDiscovery && last?.prospectUids.length) {
    uids = uids ? uids.filter((u) => last.prospectUids.includes(u)) : last.prospectUids;
  }
  if (uids?.length && !uids.includes(p.uid)) return false;
  if (f.vertical?.length && !f.vertical.some((v) => p.vertical.toLowerCase() === v.toLowerCase() || p.vertical.toLowerCase().includes(v.toLowerCase()))) {
    return false;
  }
  if (f.city && !cityMatch(p.city, f.city)) return false;
  if (f.fit?.length && !f.fit.includes(p.fitHeadline)) return false;
  if (f.research?.length && !f.research.includes(p.research)) return false;
  if (f.reach?.length && !f.reach.includes(p.reach)) return false;
  if (f.stage?.length && !f.stage.some((s) => p.stage === s || (p.stage_plain || "").toLowerCase() === s.toLowerCase())) return false;
  if (f.hasPhone === true && !p.hasPhone) return false;
  if (f.hasPhone === false && p.hasPhone) return false;
  if (f.hasEmail === true && !p.hasEmail) return false;
  if (f.hasEmail === false && p.hasEmail) return false;
  if (f.hasWebsite === true && !p.hasWebsite) return false;
  if (f.hasWebsite === false && p.hasWebsite) return false;
  if (f.hasDecisionMaker === true && !p.hasDecisionMaker) return false;
  if (f.hasDecisionMaker === false && p.hasDecisionMaker) return false;
  if (f.source?.length && !f.source.includes(p.source)) return false;
  if (f.excludeTest && p.isTest) return false;
  if (f.excludeDemo && p.isDemo) return false;
  if (f.addedAfter) {
    const t = Date.parse(p.addedAt);
    const after = Date.parse(f.addedAfter);
    if (!Number.isFinite(t) || t < after) return false;
  }
  if (f.minReviews != null && p.reviewCount < f.minReviews) return false;
  if (f.minRating != null && p.rating < f.minRating) return false;
  if (f.queue) {
    if (!matchesQueue(p, f.queue as PipelineQueue)) return false;
  }
  return true;
}

const FIT_RANK: Record<FitHeadline, number> = {
  "GOOD FIT": 0,
  "POSSIBLE FIT": 1,
  "NEED MORE INFORMATION": 2,
};
const ATTN_RANK: Record<ReachKind, number> = {
  NEEDS_RESEARCH: 0,
  NEEDS_CONTACT_INFO: 1,
  BLOCKED: 2,
  SUPPRESSED: 2,
  READY_TO_CONTACT: 3,
};

export function applyProspectFilter(
  rows: FilterableProspect[],
  filter: ProspectViewFilter,
  last: LastDiscovery | null = null,
): FilterableProspect[] {
  const hit = rows.filter((p) => matches(p, filter, last));
  const sort = filter.sort || "score";
  const ordered = [...hit].sort((a, b) => {
    if (sort === "best_fit") return FIT_RANK[a.fitHeadline] - FIT_RANK[b.fitHeadline] || b.score - a.score;
    if (sort === "newest") return (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0);
    if (sort === "most_reviewed") return b.reviewCount - a.reviewCount;
    if (sort === "needs_attention") return ATTN_RANK[a.reach] - ATTN_RANK[b.reach] || FIT_RANK[a.fitHeadline] - FIT_RANK[b.fitHeadline];
    return b.score - a.score;
  });
  return filter.limit ? ordered.slice(0, filter.limit) : ordered;
}

export function filterChips(f: ProspectViewFilter, last: LastDiscovery | null = null): string[] {
  const chips: string[] = [];
  const lastVert = (last?.vertical || "").toLowerCase().trim();
  const lastLoc = (last?.location || "").toLowerCase().trim();
  const lastCoversVertical = Boolean(f.lastDiscovery && last && lastVert);
  const lastCoversCity = Boolean(f.lastDiscovery && last && lastLoc);
  if (f.lastDiscovery && last) chips.push(last.query ? `Last search: ${last.query}` : "Last search");
  for (const v of f.vertical || []) {
    if (lastCoversVertical && v.toLowerCase() === lastVert) continue;
    chips.push(v);
  }
  if (f.city) {
    const redundant = lastCoversCity && (cityMatch(lastLoc, f.city) || cityMatch(f.city, lastLoc));
    if (!redundant) chips.push(f.city);
  }
  for (const x of f.fit || []) chips.push(x === "GOOD FIT" ? "Good Fit" : x === "POSSIBLE FIT" ? "Possible Fit" : "Need more information");
  for (const r of f.research || []) {
    chips.push(r === "not_started" ? "Needs research" : r === "unavailable" ? "Website research unavailable" : "Researched");
  }
  for (const r of f.reach || []) {
    chips.push(r === "NEEDS_CONTACT_INFO" ? "Needs Contact Information" : r === "READY_TO_CONTACT" ? "Ready to contact" : r === "NEEDS_RESEARCH" ? "Needs research" : r === "SUPPRESSED" ? "Suppressed" : "Blocked");
  }
  if (f.hasPhone === true) chips.push("Has phone");
  if (f.hasPhone === false) chips.push("No phone");
  if (f.hasEmail === true) chips.push("Has email");
  if (f.hasEmail === false) chips.push("No email");
  if (f.hasWebsite === true) chips.push("Has website");
  if (f.hasWebsite === false) chips.push("No website");
  if (f.hasDecisionMaker === true) chips.push("Decision maker known");
  if (f.hasDecisionMaker === false) chips.push("Owner unknown");
  if (f.excludeTest || f.excludeDemo) chips.push("Real businesses");
  if (f.minReviews) chips.push(`${f.minReviews}+ reviews`);
  if (f.minRating) chips.push(`${f.minRating}+ rating`);
  if (f.addedAfter) chips.push("Added recently");
  if (f.sort === "best_fit") chips.push("Best fit first");
  if (f.sort === "newest") chips.push("Newest first");
  if (f.sort === "most_reviewed") chips.push("Most reviewed first");
  if (f.sort === "needs_attention") chips.push("Needs attention first");
  if (f.queue === "ACTIVE_PIPELINE") chips.push("Active Pipeline");
  if (f.queue === "NEEDS_CONTACT_INFORMATION") chips.push("Needs Contact Information");
  if (f.queue === "NEEDS_RESEARCH") chips.push("Needs Research");
  if (f.queue === "NEEDS_DYLAN") chips.push("Needs Dylan");
  if (f.queue === "ARCHIVE_NOT_PURSUING") chips.push("Archive / Not Pursuing");
  if (f.queue === "SUPPRESSED") chips.push("Suppressed");
  return [...new Set(chips)];
}

export function filterSummary(count: number, f: ProspectViewFilter, last: LastDiscovery | null = null): string {
  const chips = filterChips(f, last);
  const head = `Showing ${count} prospect${count === 1 ? "" : "s"}`;
  return chips.length ? `${head}: ${chips.join(" · ")}` : `${head}.`;
}

export function speakFilterResult(
  count: number,
  f: ProspectViewFilter,
  last: LastDiscovery | null = null,
): string {
  if (isFilterEmpty(f)) return "I cleared the filters. You’re seeing all prospects again.";
  if (f.lastDiscovery && last && !f.fit && !f.reach && !f.research && f.hasPhone == null && f.hasEmail == null) {
    const loc = last.location ? ` in ${last.location}` : "";
    const kind = last.vertical || "companies";
    return `I’m showing the ${count} ${kind} compan${count === 1 ? "y" : "ies"}${loc} from your last search.`;
  }
  if ((f.excludeTest || f.excludeDemo) && isFilterEmpty({ ...f, excludeTest: undefined, excludeDemo: undefined })) {
    return `I’m showing ${count} real prospect${count === 1 ? "" : "s"}. Test and demo records are hidden.`;
  }
  const chips = filterChips(f, last);
  if (!count) return "I don’t have any prospects matching those filters.";
  return `I found ${count} matching prospect${count === 1 ? "" : "s"}${chips.length ? `: ${chips.join(" · ")}` : ""}.`;
}

const NAV_LOCK = /\b(calendar|pipeline|settings|evidence|explanation|explain panel|tomorrow|today|this week|this month)\b/;
const CLEAR_RE = /^(clear filters|reset (the )?list|show everything( again)?|show all( of them)?( again)?|show all prospects|start over|show (me )?everything)$/;
const UNSUPPORTED = /\b(republicans?|democrats?|political party|party affiliation|religion|christian|muslim|lgbt|race|ethnicity)\b/;
const SIZE_ASK = /\b(big ones|the big|largest|huge|small ones)\b/;

function hasListIntent(t: string): boolean {
  if (CLEAR_RE.test(t)) return true;
  if (refersToLastSearch(t) && /\b(show|filter|open|which|only)\b/.test(t)) return true;
  if (refersToCurrentSet(t) && /\b(show|filter|only|which|hide|sort|just)\b/.test(t)) return true;
  if (/\b(sort|filter|only show|show only|hide test|hide demo|real (businesses|prospects|companies))\b/.test(t)) return true;
  if (/\bshow( me)? (companies|prospects|roofers|roofing|hvac|plumbers?|med spas?|dentists?|lawyers?)\b/.test(t)) return true;
  if (/\b(need(s|ing)? (more )?(research|contact)|with (a )?(phone|website|email)|decision maker|owner is still unknown|good[- ]fit|possible[- ]fit|added today|more than \d+ reviews)\b/.test(t)) {
    return /\b(show|only|which|filter|hide|sort)\b/.test(t);
  }
  return false;
}

export function parseSpokenFilter(raw: string): SpokenFilterResult {
  const t = (raw || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { kind: "none" };
  if (/\b(find me|look for|search for|run find|find clients)\b/.test(t)) return { kind: "none" };
  if (NAV_LOCK.test(t) && !refersToLastSearch(t) && !/\b(roof|hvac|plumb|spa|dent|good[- ]fit|phone|research|contact|added today|prospects?|companies)\b/.test(t)) {
    return { kind: "none" };
  }
  if (/\b(evidence|explanation|explain panel)\b/.test(t)) return { kind: "none" };
  if (UNSUPPORTED.test(t)) {
    return { kind: "unknown", reason: "I don’t have that information on file, so I won’t guess." };
  }
  if (SIZE_ASK.test(t) && !/\breviews?\b/.test(t)) {
    return { kind: "ask", ask: "What should I use for size — review count, or another field we actually have?" };
  }
  if (!hasListIntent(t) && !refersToLastSearch(t) && !refersToCurrentSet(t)) return { kind: "none" };

  if (CLEAR_RE.test(t) || /^(show all( prospects)?)$/.test(t)) {
    return { kind: "filter", filter: { replace: true } };
  }

  const filter: ProspectViewFilter = {};
  const referringLast = refersToLastSearch(t);
  const referringSet = refersToCurrentSet(t);
  const hideTest = /\b(hide (test|demo)|only (show )?real|real (businesses|prospects|companies)|all real)\b/.test(t);
  if (hideTest && /\b(all real|show all|hide test)\b/.test(t) && !referringSet) {
    filter.replace = true;
    filter.excludeTest = true;
    filter.excludeDemo = true;
  }

  if (referringLast) filter.lastDiscovery = true;
  if (referringSet) filter.replace = false;

  const mapped = mapSpokenVertical(t);
  if (mapped && mapped !== "Other" && /\b(roof|hvac|plumb|sewer|drain|foundat|remod|solar|spa|dent|law|injur|consult|saas|software)/.test(t)) {
    filter.vertical = [mapped];
  }

  const loc = t.match(/\b(?:in|near|around)\s+([a-z][a-z .'-]+?)(?:\s+texas|\s+tx)?(?=\s+(that|who|with|which|and|from)|$)/);
  if (loc) filter.city = loc[1].replace(/\bcompanies\b/g, "").trim().replace(/\b\w/g, (c) => c.toUpperCase());

  if (/\bgood[- ]fit/.test(t) || /\bonly (the )?good/.test(t)) filter.fit = ["GOOD FIT"];
  else if (/\bpossible[- ]fit/.test(t)) filter.fit = ["POSSIBLE FIT"];
  else if (/\bneed more information\b/.test(t)) filter.fit = ["NEED MORE INFORMATION"];

  if (/\bneed(s|ing)? (more )?research|still need research|haven'?t researched|not researched yet\b/.test(t)) {
    filter.research = ["not_started", "unavailable"];
  }
  if (/\bneed(s|ing)? contact( info| information)?|missing contact|no contact info\b/.test(t)) {
    filter.reach = ["NEEDS_CONTACT_INFO"];
  }
  if (/\b(active pipeline|show (me )?active)\b/.test(t)) filter.queue = "ACTIVE_PIPELINE";
  if (/\bneeds dylan\b/.test(t)) filter.queue = "NEEDS_DYLAN";
  if (/\b(needs contact information queue|contact info backlog)\b/.test(t)) filter.queue = "NEEDS_CONTACT_INFORMATION";
  if (/\bphone(?: number)? but no (verified )?email\b/.test(t)) {
    filter.hasPhone = true;
    filter.hasEmail = false;
  } else {
    if (/\bwith (a )?phone|have (a )?phone|has (a )?phone|phone numbers?\b/.test(t)) filter.hasPhone = true;
    if (/\bno (verified )?email|without (an |a verified )?email\b/.test(t)) filter.hasEmail = false;
    if (/\bwith (an |a verified )?email\b/.test(t) && filter.hasEmail !== false) filter.hasEmail = true;
  }
  if (/\bwith (a )?websites?|have websites?|has (a )?website|only (show )?(companies )?with websites?\b/.test(t)) {
    filter.hasWebsite = true;
  }
  if (/\bdecision maker (is )?(known|on file)|we know the (owner|decision)|know the decision maker\b/.test(t)) {
    filter.hasDecisionMaker = true;
  }
  if (/\bowner is still unknown|decision maker (is )?(unknown|missing)|don'?t know the (owner|decision)\b/.test(t)) {
    filter.hasDecisionMaker = false;
  }
  if (hideTest) {
    filter.excludeTest = true;
    filter.excludeDemo = true;
  }
  const reviews = t.match(/(?:more than|over|at least)\s+(\d+)\s+reviews/);
  if (reviews) filter.minReviews = Number(reviews[1]);
  if (/\badded today|from today\b/.test(t)) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    filter.addedAfter = d.toISOString();
  }
  if (/\bbest (prospects |ones |fits )?first|sort (them |these |those )?(by )?(best fit|best)\b/.test(t) || /\bsort them by best fit\b/.test(t)) {
    filter.sort = "best_fit";
  } else if (/\bnewest first|sort (them |these |those )?(by )?newest\b/.test(t)) {
    filter.sort = "newest";
  } else if (/\bmost reviewed|sort (them |these |those )?(by )?reviews\b/.test(t)) {
    filter.sort = "most_reviewed";
  } else if (/\bneed(ing)? (my )?attention first\b/.test(t)) {
    filter.sort = "needs_attention";
  }

  if (referringLast) {
    delete filter.replace;
  }

  const mode = classifyFilterIntent(filter, { utterance: raw });
  if (mode === "replace") {
    filter.replace = true;
    if (!referringLast) {
      delete filter.lastDiscovery;
      delete filter.prospectUids;
    }
  } else {
    filter.replace = false;
  }

  if (isFilterEmpty(filter) && !filter.replace) return { kind: "none" };
  return { kind: "filter", filter };
}

export function toolArgsToFilter(args: Record<string, unknown>): { filter: ProspectViewFilter; unknown: string[] } {
  const mapped: Record<string, unknown> = {
    vertical: args.vertical ?? args.industry ?? args.company_type,
    city: args.city ?? args.location,
    fit: args.fit,
    research: args.research ?? args.researchState ?? args.research_state,
    reach: args.reach ?? args.contactState ?? args.contact_state,
    stage: args.stage,
    hasPhone: args.has_phone ?? args.hasPhone,
    hasEmail: args.has_email ?? args.hasEmail,
    hasWebsite: args.has_website ?? args.hasWebsite,
    hasDecisionMaker: args.has_decision_maker ?? args.hasDecisionMaker,
    source: args.source,
    excludeTest: args.exclude_test ?? args.excludeTest,
    excludeDemo: args.exclude_demo ?? args.excludeDemo,
    addedAfter: args.added_after ?? args.addedAfter,
    minReviews: args.min_reviews ?? args.minReviews,
    minRating: args.min_rating ?? args.minRating,
    prospectUids: args.prospect_uids ?? args.prospectUids,
    lastDiscovery: args.last_discovery ?? args.lastDiscovery,
    sort: args.sort,
    limit: args.limit,
    replace: args.replace ?? args.clear,
    queue: args.queue,
  };
  if (args.clear === true) mapped.replace = true;
  if (args.compose === false) mapped.replace = true;
  if (args.compose === true) mapped.replace = false;
  return validateProspectFilter(mapped);
}
