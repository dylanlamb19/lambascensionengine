import assert from "node:assert/strict";
import test from "node:test";
import { searchText, cacheSatisfiesSearch, type FetchLike, type ReserveFn } from "./places.ts";
import { hitToProspect } from "./to-prospect.ts";
import { normalizePlace } from "./places.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockPlacesFetch(pages: number): FetchLike {
  let searchCalls = 0;
  return async (url) => {
    if (String(url).includes("geocode")) {
      return jsonResponse({ status: "OK", results: [{ geometry: { location: { lat: 32.78, lng: -96.8 } } }] });
    }
    searchCalls += 1;
    const token = searchCalls < pages ? `page-${searchCalls}` : undefined;
    return jsonResponse({
      places: [{ id: `Ch${searchCalls}`, displayName: { text: `Co ${searchCalls}` }, formattedAddress: "1 Main, Dallas, TX 75201, USA" }],
      nextPageToken: token,
    });
  };
}

function countingReserve(budget: { remaining: number; kinds: string[] }): ReserveFn {
  return async (kind) => {
    const cost = kind === "geocode" ? 1 : 4;
    if (budget.remaining < cost) return { ok: false, reason: "Daily company-search limit reached. Try again tomorrow." };
    budget.remaining -= cost;
    budget.kinds.push(kind);
    return { ok: true, reason: "" };
  };
}

test("cached search consumes no Places reservation", () => {
  const cached = [{ provider_place_id: "Ch1" }];
  assert.equal(cacheSatisfiesSearch(cached), true);
  assert.equal(cacheSatisfiesSearch([]), false);
  assert.equal(cacheSatisfiesSearch(null), false);
});

test("one-page search accounts geocode + one Text Search", async () => {
  const budget = { remaining: 100, kinds: [] as string[] };
  const out = await searchText({
    apiKey: "k", vertical: "Roofing", location: "Dallas", radiusM: 40000, limit: 5, minRating: 0,
    reserve: countingReserve(budget),
    fetchImpl: mockPlacesFetch(1),
  });
  assert.ok(!("error" in out));
  assert.deepEqual(budget.kinds, ["geocode", "text_search"]);
  if (!("error" in out)) {
    assert.equal(out.calls.geocode, 1);
    assert.equal(out.calls.text_search, 1);
    assert.equal(out.places.length, 1);
  }
});

test("multi-page search accounts geocode + each Text Search page", async () => {
  const budget = { remaining: 100, kinds: [] as string[] };
  const out = await searchText({
    apiKey: "k", vertical: "Roofing", location: "Dallas", radiusM: 40000, limit: 40, minRating: 0,
    reserve: countingReserve(budget),
    fetchImpl: mockPlacesFetch(3),
  });
  assert.ok(!("error" in out));
  assert.deepEqual(budget.kinds, ["geocode", "text_search", "text_search", "text_search"]);
  if (!("error" in out)) {
    assert.equal(out.calls.geocode, 1);
    assert.equal(out.calls.text_search, 3);
  }
});

test("search stops before another API call when the spend cap is exhausted", async () => {
  let fetchCount = 0;
  const fetchImpl: FetchLike = async (url) => {
    fetchCount += 1;
    if (String(url).includes("geocode")) {
      return jsonResponse({ status: "OK", results: [{ geometry: { location: { lat: 32, lng: -96 } } }] });
    }
    return jsonResponse({
      places: [{ id: `Ch${fetchCount}`, displayName: { text: `Co ${fetchCount}` } }],
      nextPageToken: "more",
    });
  };
  // geocode 1 + first page 4 = 5; remaining 5 means second page (4) is refused.
  const budget = { remaining: 5, kinds: [] as string[] };
  const out = await searchText({
    apiKey: "k", vertical: "Roofing", location: "Dallas", radiusM: 40000, limit: 50, minRating: 0,
    reserve: countingReserve(budget),
    fetchImpl,
  });
  assert.equal(budget.kinds.filter((k) => k === "text_search").length, 1);
  assert.equal(fetchCount, 2); // geocode + first text search only
  assert.ok(!("error" in out) || out.error.code === "quota");
});

test("simultaneous searches cannot bypass the global cap", async () => {
  const state = { n: 2 };
  let chain = Promise.resolve();
  const reserve: ReserveFn = async () => {
    let ok = false;
    const next = chain.then(() => {
      if (state.n > 0) {
        state.n -= 1;
        ok = true;
      }
    });
    chain = next.then(() => undefined, () => undefined);
    return next.then(() => (ok ? { ok: true, reason: "" } : { ok: false, reason: "Daily company-search limit reached. Try again tomorrow." }));
  };
  const fetchImpl = mockPlacesFetch(1);
  const [a, b] = await Promise.all([
    searchText({ apiKey: "k", vertical: "Roofing", location: "Dallas", radiusM: 1, limit: 5, minRating: 0, reserve, fetchImpl }),
    searchText({ apiKey: "k", vertical: "SaaS / software", location: "Austin", radiusM: 1, limit: 5, minRating: 0, reserve, fetchImpl }),
  ]);
  const totalCalls = [a, b].reduce((s, r) => s + r.calls.geocode + r.calls.text_search, 0);
  assert.ok(totalCalls <= 2);
  assert.equal(state.n, 0);
  const okCount = [a, b].filter((r) => !("error" in r)).length;
  assert.ok(okCount <= 1);
});

test("hitToProspect keeps Places evidence and labels job value as INDUSTRY_ESTIMATE", () => {
  const hit = normalizePlace({
    id: "ChREAL",
    displayName: { text: "Dallas Roof Co" },
    websiteUri: "https://dallasroofco.com",
    nationalPhoneNumber: "(214) 555-0100",
    rating: 4.8,
    userRatingCount: 120,
    formattedAddress: "100 Main St, Dallas, TX 75201, USA",
    googleMapsUri: "https://maps.google.com/?cid=1",
    businessStatus: "OPERATIONAL",
    location: { latitude: 32.8, longitude: -96.8 },
    primaryTypeDisplayName: { text: "Roofing contractor" },
  }, "Roofing", "Dallas");
  const p = hitToProspect(hit, 7);
  assert.ok(p.uid);
  assert.equal(p.provider, "google_places");
  assert.equal(p.provider_place_id, "ChREAL");
  assert.equal(p.provider_source_url, "https://maps.google.com/?cid=1");
  assert.equal(p.address, "100 Main St, Dallas, TX 75201, USA");
  assert.equal(p.provider_category, "Roofing contractor");
  assert.equal(p.business_status, "OPERATIONAL");
  assert.equal(p.lat, 32.8);
  assert.equal(p.job_value_kind, "INDUSTRY_ESTIMATE");
  assert.match(p.facts?.find((f) => f.key === "job_value_est")?.source || "", /INDUSTRY_ESTIMATE/);
  assert.match(p.facts?.find((f) => f.key === "job_value_est")?.source || "", /not provided by Google Places/);
});
