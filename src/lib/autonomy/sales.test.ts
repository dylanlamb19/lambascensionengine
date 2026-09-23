import assert from "node:assert/strict";
import test from "node:test";
import { markCallOutcome, markSalesOutcome } from "./outcomes.ts";
import { clientRecord, discoveryQuestions, followupDraft, proposalDraft, recommendService, salesBrief } from "./sales.ts";

test("sales support stays on the call and does not invent a price", () => {
  const base = {
    company: "AWO Lending",
    contact: "Amos Oneil",
    website: "https://awo.example",
    vertical: "Business lending",
    city: "Dallas",
    gaps: ["NO_HOMEPAGE_FORM"],
    angle: "no homepage form",
    replySummary: "Asked to talk",
    emailsSent: 1,
    researchDone: true,
  };
  const brief = salesBrief(base);
  assert.match(brief, /AWO Lending/);
  assert.match(brief, /NO_HOMEPAGE_FORM/);
  assert.match(brief, /Still unknown/);
  assert.doesNotMatch(brief, /\$10,000|guaranteed/);
  const questions = discoveryQuestions(base);
  const other = discoveryQuestions({ ...base, company: "Northstar", gaps: ["NO_TRACKING"] });
  assert.ok(questions.length >= 5 && questions.length <= 8);
  assert.notEqual(questions.join("|"), other.join("|"));
  assert.match(questions.join(" "), /leave their info/);
  const thin = recommendService({ company: "X", researchDone: false });
  assert.equal(thin.name, "MORE DISCOVERY NEEDED");
  const fit = recommendService({ ...base, notes: { problem: "No form on the homepage" } });
  assert.equal(fit.name, "Convert");
  const draft = followupDraft({ ...base, notes: { problem: "no form for people who will not call", nextStep: "send a one-page note" } });
  assert.match(draft, /no form/);
  assert.match(draft, /one-page note/);
  assert.doesNotMatch(draft, /case study|guarantee/);
  const blocked = proposalDraft(base);
  assert.equal(blocked.ok, false);
  const proposal = proposalDraft({ ...base, price: 2500, billing: "monthly", notes: { problem: "no form", desired: "more applications" } });
  assert.equal(proposal.ok, true);
  if (!proposal.ok) return;
  assert.match(proposal.text, /\$2,500/);
  assert.match(proposal.text, /No guaranteed/);

  let row = { name: "AWO Lending", stage: "Call Booked", meeting_at: "2020-01-01T15:00:00.000Z", sales_outcome: "" as const, call_notes: { recommended: "Convert", desired: "more applications", nextStep: "send the note" } };
  const showed = markCallOutcome(row, "SHOWED", new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(showed.ok, true);
  if (!showed.ok) return;
  const later = markSalesOutcome(showed.prospect, { outcome: "FOLLOW_UP_NEEDED", followUpAt: "2026-09-24", followUpReason: "Send the note" });
  assert.equal(later.ok, true);
  if (!later.ok) return;
  assert.equal(later.prospect.follow_up_at, "2026-09-24");
  assert.notEqual(later.prospect.stage, "New");
  const won = markSalesOutcome(showed.prospect, { outcome: "WON", clientValue: 2500, billing: "monthly" });
  assert.equal(won.ok, true);
  if (!won.ok) return;
  assert.equal(won.prospect.client_record?.service, "Convert");
  assert.equal(won.prospect.client_record?.price, 2500);
  const record = clientRecord({ ...base, price: 2500, billing: "monthly", startDate: "2026-09-23", notes: { recommended: "Convert" } });
  assert.equal(record.price, 2500);
});
