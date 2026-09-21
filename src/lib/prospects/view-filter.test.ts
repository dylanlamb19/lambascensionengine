import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prospect } from "../review-brief.ts";
import {
  applyProspectFilter,
  composeProspectFilter,
  filterChips,
  fromProspect,
  parseSpokenFilter,
  speakFilterResult,
  toolArgsToFilter,
  validateProspectFilter,
  type FilterableProspect,
  type ProspectViewFilter,
} from "./view-filter.ts";
import { lastDiscoveryFromMatch, type LastDiscovery } from "./last-discovery.ts";

function row(partial: Partial<FilterableProspect> & { uid: string; name: string }): FilterableProspect {
  return {
    vertical: "Roofing",
    city: "Fort Worth",
    fitHeadline: "POSSIBLE FIT",
    research: "not_started",
    reach: "NEEDS_CONTACT_INFO",
    stage: "New",
    hasPhone: true,
    hasEmail: false,
    hasWebsite: true,
    hasDecisionMaker: false,
    source: "google_places",
    isDemo: false,
    isTest: false,
    addedAt: "2026-09-20T12:00:00.000Z",
    reviewCount: 40,
    rating: 4.6,
    score: 70,
    ...partial,
  };
}

const last: LastDiscovery = lastDiscoveryFromMatch({
  vertical: "Roofing",
  location: "Fort Worth, Texas",
  requested: 5,
  prospectUids: ["a", "b", "c", "d", "e"],
  placeIds: ["ChA", "ChB", "ChC", "ChD", "ChE"],
});

const five = [
  row({ uid: "a", name: "Alpha Roof", fitHeadline: "GOOD FIT", research: "done", hasPhone: true, reviewCount: 120, score: 90 }),
  row({ uid: "b", name: "Beta Roof", fitHeadline: "POSSIBLE FIT", research: "not_started", hasPhone: true, score: 60 }),
  row({ uid: "c", name: "Gamma Roof", fitHeadline: "GOOD FIT", research: "done", hasPhone: false, score: 80 }),
  row({ uid: "d", name: "Delta Roof", fitHeadline: "NEED MORE INFORMATION", research: "unavailable", hasPhone: true, score: 40 }),
  row({ uid: "e", name: "Echo Roof", fitHeadline: "POSSIBLE FIT", research: "not_started", hasPhone: true, score: 55 }),
];
const extra = [
  ...five,
  row({ uid: "demo", name: "DEMO Shop", isDemo: true, vertical: "HVAC", city: "Dallas" }),
  row({ uid: "test-sales-flow:abc", name: "TEST • Outreach", isTest: true, vertical: "Roofing" }),
  row({ uid: "spa", name: "Glow Med Spa", vertical: "Med spa / cosmetic", city: "Dallas", fitHeadline: "GOOD FIT", reach: "NEEDS_CONTACT_INFO", hasPhone: true, hasEmail: false }),
];

test("TEST 1: show last discovery set without re-searching", () => {
  const spoken = parseSpokenFilter("Show me the five roofing companies you just matched in Fort Worth.");
  assert.equal(spoken.kind, "filter");
  if (spoken.kind !== "filter") return;
  assert.equal(spoken.filter.lastDiscovery, true);
  const hits = applyProspectFilter(extra, spoken.filter, last);
  assert.deepEqual(hits.map((h) => h.uid).sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(hits.some((h) => h.uid === "spa"), false);
});

test("TEST 2: compose needs research onto current last-discovery set", () => {
  const first = parseSpokenFilter("Show me those.");
  assert.equal(first.kind, "filter");
  if (first.kind !== "filter") return;
  const second = parseSpokenFilter("Only show the ones that still need research.");
  assert.equal(second.kind, "filter");
  if (second.kind !== "filter") return;
  const combined = composeProspectFilter(first.filter, second.filter);
  const hits = applyProspectFilter(five, combined, last);
  assert.deepEqual(hits.map((h) => h.uid).sort(), ["b", "d", "e"]);
});

test("TEST 3: compose has-phone onto current set", () => {
  const current = { lastDiscovery: true, research: ["not_started", "unavailable"] as ProspectViewFilter["research"] };
  const spoken = parseSpokenFilter("Show me the ones with a phone number.");
  assert.equal(spoken.kind, "filter");
  if (spoken.kind !== "filter") return;
  const combined = composeProspectFilter(current, spoken.filter);
  const hits = applyProspectFilter(five, combined, last);
  assert.ok(hits.every((h) => h.hasPhone));
  assert.ok(hits.every((h) => h.research !== "done"));
});

test("TEST 4: sort by best fit uses persisted qualification", () => {
  const spoken = parseSpokenFilter("Sort them by best fit.");
  assert.equal(spoken.kind, "filter");
  if (spoken.kind !== "filter") return;
  const combined = composeProspectFilter({ lastDiscovery: true }, spoken.filter);
  const hits = applyProspectFilter(five, combined, last);
  assert.equal(hits[0].fitHeadline, "GOOD FIT");
  assert.ok(hits.findIndex((h) => h.fitHeadline === "GOOD FIT") < hits.findIndex((h) => h.fitHeadline === "NEED MORE INFORMATION"));
});

test("TEST 5: hide test/demo and show all real prospects", () => {
  const spoken = parseSpokenFilter("Hide test and demo records and show all real prospects.");
  assert.equal(spoken.kind, "filter");
  if (spoken.kind !== "filter") return;
  assert.equal(spoken.filter.replace, true);
  assert.equal(spoken.filter.excludeTest, true);
  assert.equal(spoken.filter.excludeDemo, true);
  assert.equal(spoken.filter.lastDiscovery, undefined);
  const hits = applyProspectFilter(extra, spoken.filter, last);
  assert.equal(hits.some((h) => h.isTest || h.isDemo), false);
  assert.ok(hits.some((h) => h.uid === "spa"));
});

test("TEST 6: combined structured filter", () => {
  const spoken = parseSpokenFilter("Show me good-fit roofing companies in Fort Worth that need contact info.");
  assert.equal(spoken.kind, "filter");
  if (spoken.kind !== "filter") return;
  assert.deepEqual(spoken.filter.vertical, ["Roofing"]);
  assert.match(spoken.filter.city || "", /Fort Worth/i);
  assert.deepEqual(spoken.filter.fit, ["GOOD FIT"]);
  assert.deepEqual(spoken.filter.reach, ["NEEDS_CONTACT_INFO"]);
  const hits = applyProspectFilter(extra, spoken.filter, last);
  assert.ok(hits.every((h) => h.vertical === "Roofing" && h.fitHeadline === "GOOD FIT" && h.reach === "NEEDS_CONTACT_INFO"));
});

test("TEST 7: clear filters does not mutate records", () => {
  const spoken = parseSpokenFilter("Clear filters.");
  assert.equal(spoken.kind, "filter");
  if (spoken.kind !== "filter") return;
  assert.equal(spoken.filter.replace, true);
  const next = composeProspectFilter({ lastDiscovery: true, fit: ["GOOD FIT"] }, spoken.filter);
  const hits = applyProspectFilter(extra, next, last);
  assert.equal(hits.length, extra.length);
  const snapshot = extra.map((h) => h.stage).join(",");
  applyProspectFilter(extra, next, last);
  assert.equal(extra.map((h) => h.stage).join(","), snapshot);
});

test("unknown political filter is refused", () => {
  const spoken = parseSpokenFilter("Show me the ones whose owners are Republicans.");
  assert.equal(spoken.kind, "unknown");
});

test("ambiguous size asks instead of inventing", () => {
  const spoken = parseSpokenFilter("Show me the big ones.");
  assert.equal(spoken.kind, "ask");
});

test("validate drops unknown keys and does not invent SQL", () => {
  const { filter, unknown } = validateProspectFilter({ vertical: ["Roofing"], party: "R", city: "Fort Worth" });
  assert.ok(unknown.includes("party"));
  assert.deepEqual(filter.vertical, ["Roofing"]);
  assert.equal((filter as { party?: string }).party, undefined);
});

test("tool args map last_discovery and has_phone", () => {
  const { filter } = toolArgsToFilter({ last_discovery: true, has_phone: true, compose: true });
  assert.equal(filter.lastDiscovery, true);
  assert.equal(filter.hasPhone, true);
  assert.equal(filter.replace, false);
});

test("chips stay owner-friendly", () => {
  const chips = filterChips({ vertical: ["Roofing"], city: "Fort Worth", fit: ["GOOD FIT"], reach: ["NEEDS_CONTACT_INFO"] });
  assert.deepEqual(chips, ["Roofing", "Fort Worth", "Good Fit", "Needs Contact Info"]);
  const spoken = speakFilterResult(4, { vertical: ["Roofing"], city: "Fort Worth", fit: ["GOOD FIT"], reach: ["NEEDS_CONTACT_INFO"] }, last);
  assert.match(spoken, /4 matching/);
  assert.doesNotMatch(spoken, /qualification_state/);
});

test("fromProspect never fabricates missing contacts", () => {
  const p = {
    id: 1,
    uid: "x",
    name: "X",
    vertical: "Roofing",
    city: "Fort Worth",
    website: "UNKNOWN",
    review_count: 0,
    google_rating: "UNKNOWN",
    phone: "UNKNOWN",
    job_value_est: 0,
    score: 40,
    fit: "possible",
    fit_plain: "Possible",
    stage: "New",
    stage_plain: "Just added",
    research_status: "none",
    findings: [],
    provider: "google_places",
    provider_place_id: "ChX",
  } as Prospect;
  const f = fromProspect(p);
  assert.equal(f.hasPhone, false);
  assert.equal(f.hasEmail, false);
  assert.equal(f.hasWebsite, false);
  assert.equal(f.hasDecisionMaker, false);
});

test("show me the evidence is not a list filter", () => {
  assert.equal(parseSpokenFilter("Show me the evidence.").kind, "none");
  assert.equal(parseSpokenFilter("Show me the calendar.").kind, "none");
  assert.equal(parseSpokenFilter("Find me 5 roofing companies in Fort Worth.").kind, "none");
  assert.equal(parseSpokenFilter("Tell me more about them.").kind, "none");
  assert.equal(parseSpokenFilter("Call them.").kind, "none");
  assert.equal(parseSpokenFilter("Open their website.").kind, "none");
});
