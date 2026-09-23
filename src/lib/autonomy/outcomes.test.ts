import assert from "node:assert/strict";
import test from "node:test";
import { callPrep } from "./call-prep.ts";
import { knownRevenue, learningSlices, lifecycle, markCallOutcome, markRescheduleWaiting, markSalesOutcome } from "./outcomes.ts";
import { planReply } from "./replies.ts";

test("booking flow stays on evidence and does not invent revenue", () => {
  let row = {
    name: "AWO Lending",
    stage: "New",
    research_status: "none",
    history: [] as { action: string; detail: string }[],
  };
  assert.equal(lifecycle(row), "FOUND");
  row = { ...row, research_status: "complete" };
  assert.equal(lifecycle(row), "RESEARCHED");
  row = { ...row, stage: "Approved for Outreach", history: [{ action: "outreach_generated", detail: "draft" }] };
  assert.equal(lifecycle(row), "READY_FOR_OUTREACH");
  row = { ...row, stage: "Contacted", history: [...row.history, { action: "autonomy_sent", detail: "held in test mode" }] };
  assert.equal(lifecycle(row), "CONTACTED");
  row = { ...row, history: [...row.history, { action: "autonomy_replied", detail: "INTERESTED" }] };
  assert.equal(lifecycle(row), "INTERESTED");
  const reply = planReply({ text: "Sounds good, let's talk", name: "Amos", company: "AWO Lending", bookingUrl: "https://cal.example/dylan", finding: "no homepage form" });
  assert.match(reply.body, /cal\.example/);
  const cold = planReply({ text: "Not interested", name: "Amos", company: "AWO Lending", bookingUrl: "https://cal.example/dylan" });
  assert.doesNotMatch(cold.body, /cal\.example/);
  const noLink = planReply({ text: "Sounds good", name: "Amos", company: "AWO Lending", bookingUrl: "" });
  assert.doesNotMatch(noLink.body, /https?:\/\//);

  row = { ...row, stage: "Call Booked", meeting_at: "2020-01-01T15:00:00.000Z", meeting_event_id: "evt-1", history: [...row.history, { action: "meeting_booked", detail: "stopped" }] };
  assert.equal(lifecycle(row), "BOOKED");
  const early = markCallOutcome({ ...row, meeting_at: "2099-01-01T15:00:00.000Z" }, "SHOWED", new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(early.ok, false);
  const showed = markCallOutcome(row, "SHOWED", new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(showed.ok, true);
  if (!showed.ok) return;
  assert.equal(lifecycle(showed.prospect), "SHOWED");
  const again = markCallOutcome(showed.prospect, "SHOWED", new Date());
  assert.equal(again.ok && again.prospect.history?.length, showed.prospect.history?.length);

  const wonBlank = markSalesOutcome(showed.prospect, { outcome: "WON" });
  assert.equal(wonBlank.ok, true);
  if (!wonBlank.ok) return;
  assert.equal(wonBlank.prospect.client_value, null);
  assert.equal(knownRevenue([wonBlank.prospect]).amount, null);

  const won = markSalesOutcome(showed.prospect, { outcome: "WON", clientValue: 2500, billing: "monthly", note: "starts October" });
  assert.equal(won.ok, true);
  if (!won.ok) return;
  assert.equal(knownRevenue([won.prospect]).amount, 2500);

  const missed = markCallOutcome(row, "NO_SHOW", new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(missed.ok, true);
  if (!missed.ok) return;
  assert.notEqual(missed.prospect.stage, "New");
  const wait = markRescheduleWaiting(missed.prospect);
  assert.equal(wait.ok, true);
  if (!wait.ok) return;
  assert.ok((wait.prospect.history || []).some((h) => h.action === "reschedule_waiting"));
  assert.equal(lifecycle(wait.prospect), "NO_SHOW");

  const lost = markSalesOutcome(showed.prospect, { outcome: "LOST" });
  assert.equal(lost.ok, true);
  if (!lost.ok) return;
  assert.equal(lost.prospect.lost_reason, "");
  assert.equal(learningSlices([won.prospect]).tooSmall, true);

  const brief = callPrep({
    company: "AWO Lending", contact: "Amos", when: "Thursday 11:00 AM", vertical: "Business lending", city: "Dallas",
    finding: "no homepage form", emailsSent: 1, replySummary: "Asked to talk", bookingUrl: "https://cal.example/dylan", website: "https://awo.example",
  });
  assert.match(brief, /AWO Lending/);
  assert.match(brief, /no homepage form/);
  assert.match(brief, /Do not invent/);
});
