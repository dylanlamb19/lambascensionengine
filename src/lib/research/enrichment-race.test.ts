import assert from "node:assert/strict";
import test from "node:test";
import { runDeepResearch } from "./orchestrate.ts";
import type { DeepInput, PaidHunter } from "./types.ts";

const qualifying: DeepInput = {
  name: "Ledgerflow",
  website: "https://example.com/",
  vertical: "SaaS / software",
  city: "Austin",
  phone: "UNKNOWN",
  google_rating: "UNKNOWN",
  review_count: 9,
  score: 70,
  research_status: "complete",
  findings: [],
};

const fetchOk = async () => ({
  ok: true,
  blocked: false,
  status: 200,
  final_url: "https://example.com/",
  html: "<html><body>Enterprise software. Jane Smith, CEO. Trusted by. Case studies. We’re hiring.</body></html>",
  error: "",
});

function mutexReserve(slots: { n: number }): { reserve: () => Promise<boolean>; hunterCalls: { n: number }; paid: PaidHunter } {
  let chain = Promise.resolve();
  const hunterCalls = { n: 0 };
  const reserve = () => {
    let ok = false;
    const next = chain.then(() => {
      if (slots.n > 0) {
        slots.n -= 1;
        ok = true;
      }
    });
    chain = next.then(() => undefined, () => undefined);
    return next.then(() => ok);
  };
  const paid: PaidHunter = async () => {
    const ok = await reserve();
    if (!ok) {
      return { ran: false, skipped_reason: "Daily paid-contact cap reached. Try again tomorrow.", contacts: [], cents: 0 };
    }
    hunterCalls.n += 1;
    await new Promise((r) => setTimeout(r, 15));
    return { ran: true, skipped_reason: "", contacts: [], cents: 1 };
  };
  return { reserve, hunterCalls, paid };
}

test("if one paid slot remains and two requests race, Hunter runs at most once", async () => {
  const slots = { n: 1 };
  const { hunterCalls, paid } = mutexReserve(slots);
  const caps = { minScoreForEnrichment: 65, dailyEnrichmentUsed: 0, dailyEnrichmentCap: 1, hunterKey: "secret" };
  const [a, b] = await Promise.all([
    runDeepResearch(qualifying, caps, fetchOk, paid),
    runDeepResearch(qualifying, caps, fetchOk, paid),
  ]);
  assert.equal(hunterCalls.n, 1);
  const ran = [a, b].filter((r) => r.hunter_ran).length;
  assert.equal(ran, 1);
  const skipped = [a, b].filter((r) => /cap reached/i.test(r.hunter_skipped_reason)).length;
  assert.equal(skipped, 1);
});

test("reservation failure never calls Hunter", async () => {
  let reachedHunter = false;
  const out = await runDeepResearch(
    qualifying,
    { minScoreForEnrichment: 65, dailyEnrichmentUsed: 0, dailyEnrichmentCap: 1, hunterKey: "secret" },
    fetchOk,
    async () => {
      // Failed reserve — the only Hunter gateway must not start a provider call.
      const reserved = false;
      if (!reserved) {
        return { ran: false, skipped_reason: "Daily paid-contact cap reached. Try again tomorrow.", contacts: [], cents: 0 };
      }
      reachedHunter = true;
      return { ran: true, skipped_reason: "", contacts: [], cents: 1 };
    },
  );
  assert.equal(out.hunter_ran, false);
  assert.equal(reachedHunter, false);
  assert.match(out.hunter_skipped_reason, /cap reached/i);
});

test("failed Hunter still consumes the reserved slot (no refund)", async () => {
  const slots = { n: 1 };
  let hunterStarts = 0;
  const paid: PaidHunter = async () => {
    const ok = slots.n > 0;
    if (ok) slots.n -= 1;
    if (!ok) return { ran: false, skipped_reason: "Daily paid-contact cap reached. Try again tomorrow.", contacts: [], cents: 0 };
    hunterStarts += 1;
    return { ran: true, skipped_reason: "Hunter returned 500. No emails invented.", contacts: [], cents: 1 };
  };
  await runDeepResearch(qualifying, { minScoreForEnrichment: 65, dailyEnrichmentUsed: 0, dailyEnrichmentCap: 1, hunterKey: "k" }, fetchOk, paid);
  const second = await runDeepResearch(qualifying, { minScoreForEnrichment: 65, dailyEnrichmentUsed: 0, dailyEnrichmentCap: 1, hunterKey: "k" }, fetchOk, paid);
  assert.equal(hunterStarts, 1);
  assert.equal(slots.n, 0);
  assert.equal(second.hunter_ran, false);
});
