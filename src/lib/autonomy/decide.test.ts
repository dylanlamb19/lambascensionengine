import assert from "node:assert/strict";
import test from "node:test";
import { callPrep } from "./call-prep.ts";
import { decideProspect, isSameCompany, type AutoView } from "./decide.ts";
import { classifyInbound, planReply } from "./replies.ts";
import { DEFAULT_AUTONOMY, nextMarket } from "./settings.ts";
import { acquisitionCounts } from "./snapshot.ts";

function view(over: Partial<AutoView> = {}): AutoView {
  return {
    name: "Davis Roofing",
    stage: "New",
    researchStatus: "complete",
    hasWebsite: true,
    hasEmail: true,
    hasOpportunity: true,
    fit: "strong",
    hasPack: false,
    alreadySent: false,
    booked: false,
    prepDone: false,
    disqualified: false,
    ...over,
  };
}

const live = { testMode: false, sentToday: 0 };

test("good prospect generates, then holds while Test Mode is on", () => {
  assert.equal(decideProspect(view(), DEFAULT_AUTONOMY, live).action, "generate");
  const ready = decideProspect(view({ hasPack: true }), DEFAULT_AUTONOMY, { testMode: true, sentToday: 0 });
  assert.equal(ready.action, "hold");
  assert.match(ready.reason, /Test Mode/);
});

test("bad prospect is disqualified and never reaches send", () => {
  const bad = decideProspect(view({ hasOpportunity: false, fit: "low" }), DEFAULT_AUTONOMY, live);
  assert.equal(bad.action, "disqualify");
  const again = decideProspect(view({ disqualified: true }), DEFAULT_AUTONOMY, live);
  assert.equal(again.action, "skip");
});

test("duplicate company is recognized", () => {
  assert.equal(isSameCompany({ name: "Davis Roofing", website: "https://www.davisroofing.com/" }, { name: "Other", website: "davisroofing.com" }), true);
  assert.equal(isSameCompany({ name: "Davis Roofing" }, { name: "North Texas Air" }), false);
});

test("qualified prospect with a pack sends only once", () => {
  const first = decideProspect(view({ hasPack: true }), DEFAULT_AUTONOMY, live);
  assert.equal(first.action, "send");
  const second = decideProspect(view({ hasPack: true, alreadySent: true, stage: "Contacted" }), DEFAULT_AUTONOMY, live);
  assert.equal(second.action, "skip");
});

test("a reply stops further first-touch and remove-me is do not contact", () => {
  assert.equal(decideProspect(view({ stage: "Replied", hasPack: true }), DEFAULT_AUTONOMY, live).action, "skip");
  const removed = planReply({ text: "Please remove me", name: "Sam", company: "Davis", bookingUrl: "https://cal.example/d" });
  assert.equal(removed.dnc, true);
  assert.equal(removed.send, false);
  assert.equal(classifyInbound("not interested").cls, "NOT_INTERESTED");
});

test("audit and what-do-you-do replies are answerable and do not invent a finding", () => {
  const audit = planReply({ text: "Sure, send it over", name: "Sam", company: "Davis Roofing", bookingUrl: "https://cal.example/d", finding: "no homepage form" });
  assert.equal(audit.cls, "WANTS_AUDIT");
  assert.equal(audit.send, true);
  assert.match(audit.body, /cal\.example/);
  assert.match(audit.body, /no homepage form/);
  const about = planReply({ text: "What exactly do you guys do?", name: "Sam", company: "Davis Roofing", bookingUrl: "" });
  assert.equal(about.cls, "WANTS_MORE_INFORMATION");
  assert.doesNotMatch(about.body, /10x|guarantee/i);
});

test("booked call stops outreach and writes prep", () => {
  const booked = decideProspect(view({ stage: "Call Booked", booked: true }), DEFAULT_AUTONOMY, live);
  assert.equal(booked.action, "prep");
  const again = decideProspect(view({ stage: "Call Booked", booked: true, prepDone: true }), DEFAULT_AUTONOMY, live);
  assert.equal(again.action, "skip");
  const brief = callPrep({
    company: "AWO Lending", contact: "Amos Oneil", when: "Thursday 11:00 AM",
    vertical: "Business lending", city: "Dallas", finding: "no homepage form",
    emailsSent: 1, replySummary: "Asked for the audit", bookingUrl: "https://cal.example/d",
  });
  assert.match(brief, /AWO Lending/);
  assert.match(brief, /no homepage form/);
  assert.match(brief, /Do not claim their revenue/);
});

test("daily cap and missing research do not fabricate a send", () => {
  const capped = decideProspect(view({ hasPack: true }), DEFAULT_AUTONOMY, { testMode: false, sentToday: 8 });
  assert.equal(capped.action, "hold");
  const thin = decideProspect(view({ researchStatus: "none" }), DEFAULT_AUTONOMY, live);
  assert.equal(thin.action, "research");
  const blocked = decideProspect(view({ researchStatus: "blocked" }), DEFAULT_AUTONOMY, live);
  assert.equal(blocked.action, "disqualify");
  assert.match(blocked.reason, /invent/);
});

test("markets rotate and the owner snapshot counts the pipeline", () => {
  const a = nextMarket(DEFAULT_AUTONOMY, 0);
  const b = nextMarket(DEFAULT_AUTONOMY, 1);
  assert.notEqual(`${a.vertical}|${a.city}`, `${b.vertical}|${b.city}`);
  const counts = acquisitionCounts([
    { stage: "New" },
    { stage: "Approved for Outreach", fit: "strong" },
    { stage: "Contacted", history: [{ action: "autonomy_sent" }] },
    { stage: "Replied" },
    { stage: "Call Booked" },
  ]);
  assert.equal(counts.discovered, 5);
  assert.equal(counts.callsBooked, 1);
  assert.ok(counts.emailsSent >= 1);
});
