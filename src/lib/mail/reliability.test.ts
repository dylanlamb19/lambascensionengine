import assert from "node:assert/strict";
import test from "node:test";
import { inboundReplies, isOwnOutbound } from "./inbound.ts";
import { freezeSnapshot, payloadToSend, snapshotMatches } from "./snapshot.ts";
import { makeCapReserver, makeKeyReserver, reserveCap } from "./reserve.ts";
import { sendMail } from "./send.ts";
import { weekdayMorning } from "./hours.ts";
import { buildSequence } from "./sequence.ts";
import { decideFollowupSend, processThread, runOutreachTick } from "./worker.ts";
import { allowOutreachJob } from "./job-auth.ts";
import { claimBooking, makeBookingClaim, slotIsOffered, type BookingLink } from "./booking.ts";
import { consumeOauthState, mintOauthState } from "./oauth-state.ts";
import { scopesFor } from "../google/oauth.ts";
import { ensureFreshAccess } from "../google/oauth.ts";
import type { GmailPort, ProspectMailView } from "./types.ts";

const prospect: ProspectMailView = { uid: "company-a", name: "ABC Company", stage: "Contacted" };

test("own sent message is NOT a reply; real inbound reply stops sequence once", () => {
  const outboundIds = new Set(["out-1"]);
  const msgs = [
    { id: "out-1", from: "me@lambascension.com", body: "Our original email", labelIds: ["SENT"] },
    { id: "in-1", from: "sarah@abc.com", body: "Sounds good, let's talk next week." },
  ];
  assert.equal(isOwnOutbound(msgs[0], { outboundIds, ownerEmail: "me@lambascension.com" }), true);
  const inbound = inboundReplies(msgs, { outboundIds, ownerEmail: "me@lambascension.com" });
  assert.equal(inbound.length, 1);
  assert.equal(inbound[0].id, "in-1");
  const built = buildSequence({
    userId: "u", prospectUid: "company-a", method: "MANUAL", now: new Date(),
    recipient: "sarah@abc.com", subject: "Hi", bodies: { followup1: "1", followup2: "2", followup3: "3" }, threadId: "t",
  });
  const once = processThread({
    messages: msgs, outboundIds, ownerEmail: "me@lambascension.com",
    sequence: built.sequence, followups: built.followups, alreadySeen: new Set(),
  });
  assert.equal(once.replies, 1);
  assert.equal(once.sequence.status, "stopped");
  assert.ok(once.followups.every((f) => f.status === "cancelled"));
  const twice = processThread({
    messages: msgs, outboundIds, ownerEmail: "me@lambascension.com",
    sequence: once.sequence, followups: once.followups, alreadySeen: new Set(["in-1"]),
  });
  assert.equal(twice.replies, 0);
});

test("thread with only our outbound message: zero replies, sequence stays active", () => {
  const built = buildSequence({
    userId: "u", prospectUid: "company-a", method: "MANUAL", now: new Date(),
    recipient: "sarah@abc.com", subject: "Hi", bodies: { followup1: "1", followup2: "2", followup3: "3" },
  });
  const out = processThread({
    messages: [{ id: "out-1", from: "Dylan Lamb <me@lambascension.com>", body: "hi", labelIds: ["SENT"] }],
    outboundIds: new Set(["out-1"]),
    ownerEmail: "me@lambascension.com",
    sequence: built.sequence,
    followups: built.followups,
    alreadySeen: new Set(),
  });
  assert.equal(out.replies, 0);
  assert.equal(out.sequence.status, "active");
  assert.ok(out.followups.every((f) => f.status === "scheduled"));
});

test("approved message snapshot cannot change without re-approval", () => {
  const snap = freezeSnapshot({
    recipient: "sarah@abc.com", subject: "Re: Hi", body: "Follow-up 1 approved",
    gmailThreadId: "t1", sequenceId: "seq-1",
  });
  const laterDraft = { recipient: "sarah@abc.com", subject: "Re: Hi", body: "Edited after approval" };
  assert.equal(snapshotMatches(snap, { recipient: snap.recipient, subject: snap.subject, body: snap.body }), true);
  assert.equal(snapshotMatches(snap, laterDraft), false);
  const send = payloadToSend(snap);
  assert.equal(send.body, "Follow-up 1 approved");
  assert.notEqual(send.body, laterDraft.body);
});

test("concurrent first-send → one Gmail call maximum", async () => {
  let calls = 0;
  const gmail: GmailPort = {
    async send() {
      calls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return { ok: true, messageId: "m", threadId: "t" };
    },
  };
  const reserveKey = makeKeyReserver();
  const deps = {
    gmail, gmailConnected: true, usage: { first: 0, followups: 0 },
    caps: { maxFirst: 15, maxFollowups: 30 }, firstApproved: true, sequenceActive: false,
    bounced: false, unsubscribed: false, existingKeys: new Set<string>(), reserveKey,
    now: weekdayMorning(),
  };
  const job = () => sendMail({
    userId: "u", prospect, kind: "email", method: "MANUAL",
    to: "sarah@abc.com", subject: "s", body: "b", deps,
  });
  const [a, b] = await Promise.all([job(), job()]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(calls, 1);
  assert.equal([a, b].some((r) => !r.ok && r.code === "DUPLICATE"), true);
});

test("concurrent scheduled send → one Gmail call maximum", async () => {
  let calls = 0;
  const gmail: GmailPort = {
    async send() {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true, messageId: "m", threadId: "t" };
    },
  };
  const reserveKey = makeKeyReserver();
  const deps = {
    gmail, gmailConnected: true, usage: { first: 0, followups: 0 },
    caps: { maxFirst: 15, maxFollowups: 30 }, firstApproved: true, sequenceActive: true,
    bounced: false, unsubscribed: false, existingKeys: new Set<string>(), reserveKey,
    now: weekdayMorning(),
  };
  const job = () => sendMail({
    userId: "u", prospect, kind: "followup1", method: "AUTOMATION",
    to: "sarah@abc.com", subject: "s", body: "approved body", threadId: "t", sequenceId: "seq", deps,
  });
  const [a, b] = await Promise.all([job(), job()]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(calls, 1);
  assert.equal([a, b].some((r) => !r.ok && r.code === "DUPLICATE"), true);
});

test("atomic daily send cap: two racers, one slot, one winner, no extra Gmail call", async () => {
  const state = { first: 0, followups: 0, lastSentAt: null as number | null };
  const reserveCapFn = makeCapReserver(state, { maxFirst: 1, maxFollowups: 30, minDelayMinutes: 0 });
  let calls = 0;
  const gmail: GmailPort = {
    async send() {
      calls += 1;
      return { ok: true, messageId: "m" + calls, threadId: "t" };
    },
  };
  const aKey = makeKeyReserver();
  const run = (uid: string) => sendMail({
    userId: "u",
    prospect: { ...prospect, uid },
    kind: "email",
    method: "MANUAL",
    to: "a@x.com",
    subject: "s",
    body: "b",
    deps: {
      gmail, gmailConnected: true, usage: { first: 0, followups: 0 },
      caps: { maxFirst: 1, maxFollowups: 30 }, firstApproved: true, sequenceActive: false,
      bounced: false, unsubscribed: false, existingKeys: new Set(),
      reserveKey: aKey,
      reserveCap: (k) => reserveCapFn(k, Date.now()),
    },
  });
  const [a, b] = await Promise.all([run("company-a"), run("company-b")]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(calls, 1);
  assert.equal(state.first, 1);
});

test("ambiguous Gmail timeout is UNKNOWN_DELIVERY and is not retried as a new send", async () => {
  const gmail: GmailPort = { async send() { return { ok: false, error: "timeout", timeout: true }; } };
  const reserveKey = makeKeyReserver();
  const first = await sendMail({
    userId: "u", prospect, kind: "email", method: "MANUAL", to: "a@x.com", subject: "s", body: "b",
    deps: {
      gmail, gmailConnected: true, usage: { first: 0, followups: 0 },
      caps: { maxFirst: 15, maxFollowups: 30 }, firstApproved: true, sequenceActive: false,
      bounced: false, unsubscribed: false, existingKeys: new Set(), reserveKey,
    },
  });
  assert.equal(first.ok, false);
  assert.equal(first.code, "UNKNOWN_DELIVERY");
  let calls = 0;
  const gmail2: GmailPort = { async send() { calls += 1; return { ok: true, messageId: "x", threadId: "t" }; } };
  const second = await sendMail({
    userId: "u", prospect, kind: "email", method: "MANUAL", to: "a@x.com", subject: "s", body: "b",
    deps: {
      gmail: gmail2, gmailConnected: true, usage: { first: 0, followups: 0 },
      caps: { maxFirst: 15, maxFollowups: 30 }, firstApproved: true, sequenceActive: false,
      bounced: false, unsubscribed: false, existingKeys: new Set(), reserveKey,
    },
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, "DUPLICATE");
  assert.equal(calls, 0);
});

test("reply received before due follow-up prevents send", async () => {
  let gmailCalls = 0;
  const built = buildSequence({
    userId: "u", prospectUid: "company-a", method: "MANUAL", now: new Date(0),
    recipient: "sarah@abc.com", subject: "Hi", bodies: { followup1: "1", followup2: "2", followup3: "3" }, threadId: "t",
  });
  built.followups[0].dueAt = 0;
  const store = { sequence: built.sequence, followups: built.followups };
  const tick = await runOutreachTick({
    syncReplies: async () => {
      const r = processThread({
        messages: [
          { id: "out-1", from: "me@x.com", body: "orig", labelIds: ["SENT"] },
          { id: "in-1", from: "sarah@abc.com", body: "Sounds good, let's talk next week." },
        ],
        outboundIds: new Set(["out-1"]),
        ownerEmail: "me@x.com",
        sequence: store.sequence,
        followups: store.followups,
        alreadySeen: new Set(),
      });
      store.sequence = r.sequence;
      store.followups = r.followups;
    },
    claimDue: async () => store.followups.filter((f) => f.status === "scheduled" && f.dueAt <= Date.now()).map((f) => ({
      id: f.id, prospectUid: f.prospectUid, snapshot: freezeSnapshot({
        recipient: f.recipient, subject: f.subject, body: f.body, gmailThreadId: f.gmailThreadId, sequenceId: f.sequenceId,
      }), sequence: store.sequence, followup: f,
    })),
    send: async () => {
      gmailCalls += 1;
      return "sent";
    },
  });
  assert.equal(gmailCalls, 0);
  assert.equal(tick.sent, 0);
  assert.equal(store.sequence.status, "stopped");
});

test("booked, won, and bounced prospects do not get another follow-up", () => {
  const snap = freezeSnapshot({
    recipient: "sarah@abc.com", subject: "Re: Hi", body: "f1", gmailThreadId: "t", sequenceId: "seq",
  });
  const base = {
    sequenceActive: true,
    snapshot: snap,
    now: new Date("2026-09-17T15:00:00Z"),
    gmailConnected: true,
    hours: { workStart: 8, workEnd: 17, workDays: [1, 2, 3, 4, 5], timezone: "UTC" },
  };
  assert.equal(decideFollowupSend({ ...base, prospect: { ...prospect, stage: "Won" } }).action, "cancel");
  assert.equal(decideFollowupSend({ ...base, prospect: { ...prospect, stage: "Call Booked" } }).action, "cancel");
  assert.equal(decideFollowupSend({ ...base, prospect, bounced: true }).action, "cancel");
});

test("outside-hours job reschedules instead of failing", () => {
  const sunday = new Date("2026-09-20T21:00:00Z");
  const snap = freezeSnapshot({
    recipient: "sarah@abc.com", subject: "Re: Hi", body: "f1", gmailThreadId: "t", sequenceId: "seq",
  });
  const d = decideFollowupSend({
    prospect, sequenceActive: true, snapshot: snap, now: sunday, gmailConnected: true,
    hours: { workStart: 8, workEnd: 17, workDays: [1, 2, 3, 4, 5], timezone: "UTC" },
  });
  assert.equal(d.action, "reschedule");
  assert.ok(d.dueAt && d.dueAt.getTime() > sunday.getTime());
});

test("expired Calendar access token refreshes; failed refresh does not book", async () => {
  const expired = { access_token: "old", refresh_token: "r", expiry: Date.now() - 1000, email: "me@x.com" };
  const ok = await ensureFreshAccess(expired, async () => ({ access_token: "new", refresh_token: "r", expiry: Date.now() + 3600_000 }));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.refreshed, true);
    assert.equal(ok.tokens.access_token, "new");
  }
  const bad = await ensureFreshAccess(expired, async () => { throw new Error("nope"); });
  assert.equal(bad.ok, false);
});

test("OAuth state can only be consumed once concurrently", async () => {
  const rec = mintOauthState("owner", "gmail", Date.now());
  const rows = [rec];
  let chain = Promise.resolve();
  const take = () => {
    let result = false;
    const next = chain.then(() => {
      const used = consumeOauthState(rows, rec.state, Date.now());
      result = used.ok;
    });
    chain = next.then(() => undefined, () => undefined);
    return next.then(() => result);
  };
  const wins = await Promise.all([take(), take(), take()]);
  assert.equal(wins.filter(Boolean).length, 1);
});

test("booking POST rejects unoffered/arbitrary slot", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  const offered = [{ start: new Date("2026-09-22T15:00:00Z"), end: new Date("2026-09-22T15:30:00Z") }];
  const bad = slotIsOffered(
    { start: new Date("2026-09-22T03:00:00Z"), end: new Date("2026-09-22T07:00:00Z") },
    offered,
    now,
  );
  assert.equal(bad.ok, false);
  const past = slotIsOffered(
    { start: new Date("2026-09-21T10:00:00Z"), end: new Date("2026-09-21T10:30:00Z") },
    offered,
    now,
  );
  assert.equal(past.ok, false);
  const good = slotIsOffered(offered[0], offered, now);
  assert.equal(good.ok, true);
});

test("booking link cannot be reused", () => {
  const link: BookingLink = { token: "tok", status: "open", expiresAt: Date.now() + 86400000 };
  assert.equal(claimBooking(link, Date.now()), "won");
  assert.equal(claimBooking(link, Date.now()), "used");
});

test("simultaneous booking attempts create at most one event", async () => {
  const link: BookingLink = { token: "tok", status: "open", expiresAt: Date.now() + 86400000 };
  const claim = makeBookingClaim();
  let events = 0;
  const post = async () => {
    const r = await claim(link, Date.now());
    if (r !== "won") return false;
    events += 1;
    return true;
  };
  const results = await Promise.all([post(), post(), post()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(events, 1);
});

test("missing production job secret prevents worker execution", () => {
  const missing = allowOutreachJob({ secret: undefined, header: "", production: true });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 503);
  const wrong = allowOutreachJob({ secret: "abc", header: "xyz", production: true });
  assert.equal(wrong.ok, false);
  const extra = allowOutreachJob({ secret: "job", extraSecrets: ["cron"], header: "cron", production: true });
  assert.equal(extra.ok, true);
});

test("Calendar connection does not silently grant/store Gmail access", () => {
  const cal = scopesFor("calendar").join(" ");
  const gmail = scopesFor("gmail").join(" ");
  assert.doesNotMatch(cal, /gmail\.send|gmail\.readonly/);
  assert.match(gmail, /gmail\.send/);
  assert.doesNotMatch(gmail, /calendar\.events/);
});

test("reserveCap respects min delay", () => {
  const state = { first: 0, followups: 0, lastSentAt: 1000 };
  assert.equal(reserveCap(state, { maxFirst: 15, maxFollowups: 30, minDelayMinutes: 20 }, "first", 1000 + 5 * 60 * 1000), false);
  assert.equal(reserveCap(state, { maxFirst: 15, maxFollowups: 30, minDelayMinutes: 20 }, "first", 1000 + 21 * 60 * 1000), true);
});
