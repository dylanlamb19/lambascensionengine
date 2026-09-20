import assert from "node:assert/strict";
import test from "node:test";
import { extractPageFindings, mergeFindings, websiteUnavailableFindings } from "./page-findings.ts";

test("homepage form and tel become verified findings, not invented ads", () => {
  const html = `
    <html><head><title>FW Roofing</title>
    <script>gtag('config','G-1');</script></head>
    <body>
      <h1>Fort Worth Roof Repair</h1>
      <a href="tel:8175550100">Call</a>
      <a href="/services/roof-replacement">Roof replacement</a>
      <form><input name="email" /><button>Get a quote</button></form>
    </body></html>`;
  const f = extractPageFindings(html, "https://fwroofing.example/", "home");
  const by = Object.fromEntries(f.map((x) => [x.id, x]));
  assert.equal(by.contact_form.status, "VERIFIED");
  assert.equal(by.click_to_call.status, "VERIFIED");
  assert.equal(by.primary_cta.status, "VERIFIED");
  assert.equal(by.gtag.status, "VERIFIED");
  assert.match(by.ads_conversion_tag.result, /No Google Ads conversion/i);
});

test("inner form is contact_form_inner, not a homepage form", () => {
  const f = extractPageFindings(
    `<form action="/send"><input type="email" name="email" /></form>`,
    "https://x.com/contact",
    "inner",
  );
  assert.ok(f.some((x) => x.id === "contact_form_inner" && x.status === "VERIFIED"));
  assert.equal(f.some((x) => x.id === "contact_form"), false);
});

test("website unavailable keeps a non-invented finding", () => {
  const f = websiteUnavailableFindings("blocked");
  assert.equal(f[0].id, "resolves");
  assert.match(f[0].result, /unavailable|blocked/i);
});

test("merge prefers a present inner form over a missing homepage form", () => {
  const home = extractPageFindings("<html><body>Hello</body></html>", "https://x.com/", "home");
  const inner = extractPageFindings(
    `<form><input name="email" /></form>`,
    "https://x.com/contact",
    "inner",
  );
  const m = mergeFindings(home, inner);
  assert.ok(m.some((x) => x.id === "contact_form_inner"));
  const homepage = m.find((x) => x.id === "contact_form");
  assert.match(homepage?.result || "", /No form/i);
});
