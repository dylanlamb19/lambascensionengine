import assert from "node:assert/strict";
import test from "node:test";
import { mapSpokenVertical, normalizePlace, splitCityState } from "./places.ts";

test("normalizePlace uses UNKNOWN instead of guessing missing fields", () => {
  const hit = normalizePlace({ id: "ChABC" }, "Roofing", "Dallas");
  assert.equal(hit.provider_place_id, "ChABC");
  assert.equal(hit.name, "UNKNOWN");
  assert.equal(hit.website, "UNKNOWN");
  assert.equal(hit.phone, "UNKNOWN");
  assert.equal(hit.google_rating, "UNKNOWN");
  assert.equal(hit.review_count, 0);
});

test("normalizePlace keeps a real Place id and website when present", () => {
  const hit = normalizePlace({
    id: "ChREAL",
    displayName: { text: "Dallas Roof Co" },
    websiteUri: "https://dallasroofco.com",
    nationalPhoneNumber: "(214) 555-0100",
    rating: 4.8,
    userRatingCount: 120,
    formattedAddress: "100 Main St, Dallas, TX 75201, USA",
  }, "Roofing", "Dallas");
  assert.equal(hit.name, "Dallas Roof Co");
  assert.equal(hit.website, "https://dallasroofco.com");
  assert.equal(hit.city, "Dallas");
  assert.equal(hit.state, "TX");
});

test("spoken SaaS in Dallas maps to the SaaS vertical", () => {
  assert.equal(mapSpokenVertical("saas companies"), "SaaS / software");
  assert.equal(mapSpokenVertical("roofing"), "Roofing");
});

test("splitCityState does not invent a city when the address is empty", () => {
  const s = splitCityState("", "Fort Worth, TX");
  assert.equal(s.city, "Fort Worth");
});
