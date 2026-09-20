import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isForbiddenOrigin,
  lookingAtLabel,
  operatorAppOrigin,
  operatorUrl,
  safeLookingAt,
} from "./origin.ts";

describe("Ara computer origin", () => {
  it("rejects x.ai, grok.com, and grok-sandbox as operator origins", () => {
    assert.equal(isForbiddenOrigin("https://x.ai"), true);
    assert.equal(isForbiddenOrigin("https://grok.x.ai/foo"), true);
    assert.equal(isForbiddenOrigin("https://www.grok.com"), true);
    assert.equal(isForbiddenOrigin("https://preview.grok-sandbox.com"), true);
    assert.equal(isForbiddenOrigin("http://127.0.0.1:8080"), false);
    assert.equal(isForbiddenOrigin("http://localhost:8080"), false);
  });

  it("preview always uses loopback Lamb Ascension, never x.ai", () => {
    const origin = operatorAppOrigin({
      clientOrigin: "https://x.ai",
      requestOrigin: "https://grok.com",
      preview: true,
      port: "8080",
    });
    assert.equal(origin, "http://127.0.0.1:8080");
    assert.equal(operatorUrl(origin), "http://127.0.0.1:8080/?ara_computer=1");
    assert.equal(isForbiddenOrigin(origin), false);
  });

  it("never returns x.ai even when preview is false", () => {
    const origin = operatorAppOrigin({
      clientOrigin: "https://x.ai",
      requestOrigin: "https://grok.com",
      preview: false,
      port: "8080",
    });
    assert.equal(origin, "http://127.0.0.1:8080");
    assert.equal(isForbiddenOrigin(origin), false);
  });

  it("deployed apps may use their own origin but still not x.ai", () => {
    const origin = operatorAppOrigin({
      clientOrigin: "https://x.ai",
      requestOrigin: "https://lamb-ascension.example",
      preview: false,
    });
    assert.equal(origin, "https://lamb-ascension.example");
  });

  it("lookingAt never uses a Cloudflare/x.ai block page", () => {
    const blocked = lookingAtLabel({
      heading: "Sorry, you have been blocked",
      url: "https://x.ai/",
      view: "",
    });
    assert.match(blocked, /Lamb Ascension|Home/);
    assert.doesNotMatch(blocked, /blocked|x\.ai/i);
    assert.equal(lookingAtLabel({ view: "home" }), "Ara is looking at Home");
    assert.equal(lookingAtLabel({ view: "pipe" }), "Ara is looking at Pipeline");
    assert.equal(lookingAtLabel({ view: "calendar" }), "Ara is looking at Calendar");
    assert.equal(
      lookingAtLabel({ view: "detail", companyName: "Firefighter Roofing" }),
      "Ara is reviewing Firefighter Roofing",
    );
    assert.equal(
      lookingAtLabel({ view: "detail", companyName: "Firefighter Roofing", evidence: true }),
      "Ara is looking at evidence for Firefighter Roofing",
    );
    assert.equal(safeLookingAt("Ara is looking at Sorry, you have been blocked"), "Ara is looking at Lamb Ascension");
    assert.equal(safeLookingAt("Ara is looking at Pipeline"), "Ara is looking at Pipeline");
  });
});
