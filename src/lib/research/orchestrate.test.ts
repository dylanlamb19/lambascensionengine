import assert from "node:assert/strict";
import test from "node:test";
import { adsFromFindings } from "./ads.ts";
import { extractPeople } from "./extract.ts";
import { runDeepResearch } from "./orchestrate.ts";
import { classifyReadiness } from "./readiness.ts";
import type { DeepInput } from "./types.ts";

const caps = { minScoreForEnrichment: 65, dailyEnrichmentUsed: 0, dailyEnrichmentCap: 10 };

test("pixel is not advertising detected", () => {
  const ads = adsFromFindings(
    [{ id: "meta_pixel", result: "Meta Pixel snippet detected", status: "VERIFIED" }],
    "t",
  );
  assert.ok(ads.every((a) => a.label !== "ADVERTISING DETECTED"));
  assert.ok(ads.some((a) => /not the same as seeing an ad/i.test(a.detail)));
});

test("blocked site with 400 reviews is still a candidate", () => {
  const r = classifyReadiness(
    { name: "Firefighter Roofing", website: "https://x.com", vertical: "Roofing", city: "NRH", phone: "1", google_rating: "4.9", review_count: 400, score: 72, research_status: "blocked" },
    [],
    false,
  );
  assert.equal(r, "STRONG CANDIDATE FOR FURTHER QUALIFICATION");
});

test("low score skips hunter even if fetch works", async () => {
  const input: DeepInput = {
    name: "Tiny Shop", website: "https://example.com", vertical: "Roofing", city: "Dallas",
    phone: "UNKNOWN", google_rating: "UNKNOWN", review_count: 5, score: 20, research_status: "queued",
  };
  const out = await runDeepResearch(input, { ...caps, hunterKey: "fake" }, async () => ({
    ok: true, blocked: false, status: 200, final_url: "https://example.com/", html: "<html><body>Hello</body></html>", error: "",
  }));
  assert.equal(out.hunter_ran, false);
  assert.match(out.hunter_skipped_reason, /Skipped paid contact/i);
  assert.equal(out.facts.find((f) => f.key === "revenue")?.value, "UNKNOWN");
});

test("website block still returns listing facts and a fallback sentence", async () => {
  const out = await runDeepResearch(
    {
      name: "Firefighter Roofing", website: "https://firefighterroofing.com/", vertical: "Roofing",
      city: "North Richland Hills", phone: "(817) 479-8999", google_rating: "4.9", review_count: 400,
      score: 72, research_status: "blocked",
    },
    caps,
    async () => ({ ok: false, blocked: true, status: 403, final_url: "https://firefighterroofing.com/", html: "", error: "blocked" }),
  );
  assert.match(out.website_note, /couldn't inspect their website/i);
  assert.equal(out.facts.find((f) => f.key === "review_count")?.value, "400");
  assert.equal(out.contacts.length, 0);
});

test("extracts a published owner from HTML, does not invent email", () => {
  const html = `<h2>Our Team</h2><p>Jane Smith, Owner, has led the company since 2012.</p>`;
  const people = extractPeople(html, "https://example.com/about", "t");
  assert.ok(people.some((p) => p.name === "Jane Smith"));
  assert.equal(people[0]?.email, "");
});
