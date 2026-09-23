import assert from "node:assert/strict";
import test from "node:test";
import { applyFollowupSent, handoffSummary, onboardingChecklist } from "./handoff.ts";
import { markCallOutcome, markSalesOutcome } from "./outcomes.ts";

test("won client gets a handoff and cold email stays off", () => {
  const convert = onboardingChecklist("Convert");
  assert.ok(convert.some((item) => item.id === "website"));
  assert.equal(convert.some((item) => item.id === "ads"), false);
  const acquire = onboardingChecklist("Acquire");
  assert.ok(acquire.some((item) => item.id === "ads"));
  assert.equal(acquire.some((item) => item.id === "website"), false);
  const unknown = onboardingChecklist("Not chosen on the call");
  assert.equal(unknown.some((item) => item.id === "ads" || item.id === "website"), false);

  const booked = { name: "ABC Roofing", stage: "Call Booked", meeting_at: "2020-01-01T15:00:00.000Z", call_notes: { recommended: "Convert", desired: "more booked jobs" } };
  const showed = markCallOutcome(booked, "SHOWED", new Date("2026-09-23T18:00:00.000Z"));
  assert.equal(showed.ok, true);
  if (!showed.ok) return;
  const won = markSalesOutcome(showed.prospect, { outcome: "WON", clientValue: 2000, billing: "monthly" });
  assert.equal(won.ok, true);
  if (!won.ok) return;
  assert.equal(won.prospect.stage, "Won");
  assert.equal(won.prospect.client_status, "ONBOARDING");
  assert.match(won.prospect.handoff_summary || "", /ABC Roofing/);
  assert.match(won.prospect.handoff_summary || "", /\$2,000/);
  assert.ok((won.prospect.onboarding || []).some((item) => item.id === "website"));
  assert.equal((won.prospect.onboarding || []).some((item) => item.id === "ads"), false);

  const failed = applyFollowupSent(showed.prospect, { ok: false, reason: "Test Mode is on. Nothing was sent." });
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(showed.prospect.history?.some((h) => h.action === "sales_followup_sent"), false);
  const sent = applyFollowupSent(showed.prospect, { ok: true, to: "owner@abc.example", body: "Thanks for the time.", at: "2026-09-23T19:00:00.000Z" });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const again = applyFollowupSent(sent.prospect, { ok: true, to: "owner@abc.example", body: "Thanks for the time.", at: "2026-09-23T20:00:00.000Z" });
  assert.equal(again.ok, false);
  const summary = handoffSummary({ company: "ABC Roofing", price: null });
  assert.match(summary, /UNKNOWN/);
});
