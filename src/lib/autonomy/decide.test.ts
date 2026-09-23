import assert from "node:assert/strict";
import test from "node:test";
import { callPrep } from "./call-prep.ts";
import { decideProspect, isSameCompany, type AutoView } from "./decide.ts";
import { classifyInbound, planReply } from "./replies.ts";
import { DEFAULT_AUTONOMY } from "./settings.ts";

const LIVE_ON = {
  ...DEFAULT_AUTONOMY,
  autonomous: true,
  prospecting: true,
  autoSend: true,
  autoFollowup: true,
  autoReply: true,
  ownerEnabled: true,
  ownerEnabledAt: "2026-09-23T00:00:00.000Z",
};
import { dailySummary } from "./daily.ts";
import { emailLooksUsable, mayFirstTouch, reputationPause } from "./deliverability.ts";
import { industryNudge } from "./learn.ts";
import { priorityScore } from "./priority.ts";

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
  assert.equal(decideProspect(view(), LIVE_ON, live).action, "generate");
  const ready = decideProspect(view({ hasPack: true }), LIVE_ON, { testMode: true, sentToday: 0 });
  assert.equal(ready.action, "hold");
  assert.match(ready.reason, /Test Mode/);
});

test("bad prospect is disqualified and never reaches send", () => {
  const bad = decideProspect(view({ hasOpportunity: false, fit: "low" }), LIVE_ON, live);
  assert.equal(bad.action, "disqualify");
  const again = decideProspect(view({ disqualified: true }), LIVE_ON, live);
  assert.equal(again.action, "skip");
});

test("duplicate company is recognized", () => {
  assert.equal(isSameCompany({ name: "Davis Roofing", website: "https://www.davisroofing.com/" }, { name: "Other", website: "davisroofing.com" }), true);
  assert.equal(isSameCompany({ name: "Davis Roofing" }, { name: "North Texas Air" }), false);
});

test("qualified prospect with a pack sends only once", () => {
  const first = decideProspect(view({ hasPack: true }), LIVE_ON, live);
  assert.equal(first.action, "send");
  const second = decideProspect(view({ hasPack: true, alreadySent: true, stage: "Contacted" }), LIVE_ON, live);
  assert.equal(second.action, "skip");
});

test("a reply stops further first-touch and remove-me is do not contact", () => {
  assert.equal(decideProspect(view({ stage: "Replied", hasPack: true }), LIVE_ON, live).action, "skip");
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
  const booked = decideProspect(view({ stage: "Call Booked", booked: true }), LIVE_ON, live);
  assert.equal(booked.action, "prep");
  const again = decideProspect(view({ stage: "Call Booked", booked: true, prepDone: true }), LIVE_ON, live);
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
  const capped = decideProspect(view({ hasPack: true }), LIVE_ON, { testMode: false, sentToday: 8 });
  assert.equal(capped.action, "hold");
  const thin = decideProspect(view({ researchStatus: "none" }), LIVE_ON, live);
  assert.equal(thin.action, "research");
  const blocked = decideProspect(view({ researchStatus: "blocked" }), LIVE_ON, live);
  assert.equal(blocked.action, "disqualify");
  assert.match(blocked.reason, /invent/);
});

test("priority, reputation, and today's counts stay honest", () => {
  const strong = priorityScore({ gaps: ["NO_HOMEPAGE_FORM"], reviewCount: 80, hasEmail: true, fit: "strong", jobValue: 8000, industryNudge: 0 });
  const weak = priorityScore({ gaps: [], reviewCount: 0, hasEmail: false, fit: "low", jobValue: 0, industryNudge: 0 });
  assert.ok(strong.score > weak.score);
  assert.equal(emailLooksUsable("owner@davisroofing.com"), true);
  assert.equal(emailLooksUsable("noreply@davisroofing.com"), false);
  const blocked = mayFirstTouch({
    email: "owner@davisroofing.com",
    bounced: new Set(["owner@davisroofing.com"]),
    unsubscribed: new Set(),
    domainsMailedToday: new Set(),
    alreadyMailedCompany: false,
  });
  assert.equal(blocked.ok, false);
  assert.equal(reputationPause(5, 2), false);
  assert.equal(reputationPause(25, 4), true);
  assert.equal(industryNudge([{ vertical: "Roofing", stage: "Contacted", history: [{ action: "autonomy_sent" }] }], "Roofing"), 0);
  const paused = decideProspect(view({ hasPack: true, reputationPaused: true }), LIVE_ON, live);
  assert.equal(paused.action, "hold");
  const failed = decideProspect(view({ hasPack: true, sendFailed: true }), LIVE_ON, live);
  assert.equal(failed.action, "skip");
  const objection = planReply({ text: "This is too expensive", name: "Sam", company: "Davis", bookingUrl: "https://cal.example/d" });
  assert.equal(objection.cls, "OBJECTION");
  assert.doesNotMatch(objection.body, /cal\.example|guarantee|10x/);
  const day = "2026-09-23";
  const summary = dailySummary([
    { discovered_at: "2026-09-23T15:00:00.000Z", history: [{ at: "2026-09-23T16:00:00.000Z", action: "research_completed" }, { at: "2026-09-23T17:00:00.000Z", action: "outreach_generated" }] },
    { stage: "Call Booked", history: [{ at: "2026-09-23T18:00:00.000Z", action: "call_prep" }, { at: "2026-09-23T18:00:00.000Z", action: "autonomy_escalate", detail: "UNCLEAR" }] },
  ], day);
  assert.equal(summary.found, 1);
  assert.equal(summary.researched, 1);
  assert.equal(summary.qualified, 1);
  assert.equal(summary.callsBooked, 1);
  assert.equal(summary.revenue, "UNKNOWN");
  assert.ok(summary.needsYou.some((line) => /unclear|look/i.test(line)));
});
