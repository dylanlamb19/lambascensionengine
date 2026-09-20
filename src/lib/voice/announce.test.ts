import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { announceToAra, resetAnnounceDedupe } from "./announce.ts";

describe("Ara announcement bus", () => {
  it("speaks a blocker once and dedupes rerenders", () => {
    resetAnnounceDedupe();
    const ev = {
      type: "BLOCKER" as const,
      text: "Live Find Clients is off because Google Places is not configured.",
      dedupeKey: "find:places",
    };
    const first = announceToAra(ev, 1_000);
    const second = announceToAra(ev, 2_000);
    assert.ok(first);
    assert.equal(first?.text, ev.text);
    assert.equal(second, null);
  });

  it("allows the same key after the dedupe window", () => {
    resetAnnounceDedupe();
    const ev = { type: "ERROR" as const, text: "Gmail isn’t connected.", dedupeKey: "settings:gmail" };
    assert.ok(announceToAra(ev, 1_000));
    assert.ok(announceToAra(ev, 1_000 + 31_000));
  });

  it("ignores empty text", () => {
    resetAnnounceDedupe();
    assert.equal(announceToAra({ type: "INFO", text: "  ", dedupeKey: "empty" }), null);
  });
});
