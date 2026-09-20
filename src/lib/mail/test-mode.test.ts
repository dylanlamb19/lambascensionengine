import assert from "node:assert/strict";
import test from "node:test";
import {
  allowSendRecipient,
  canDisableTestMode,
  effectiveCaps,
  integrationLightsDoNotLeak,
  isAllowlisted,
  parseAllowlist,
  readTestModeFlag,
  scoreLiveChecks,
  secretPresent,
  TEST_CAPS,
  wantsDisableTestMode,
} from "./test-mode.ts";
import { canSend } from "./guard.ts";
import { sendMail } from "./send.ts";
import { decideFollowupSend } from "./worker.ts";
import { freezeSnapshot } from "./snapshot.ts";
import { gmailProfile } from "../google/gmail.ts";
import { probeFreeBusy } from "../google/calendar.ts";
import type { GmailPort } from "./types.ts";

test("test mode blocks every recipient that is not on the allowlist", () => {
  const blocked = allowSendRecipient({
    testMode: true,
    allowlist: ["me@example.com"],
    recipient: "owner@real-company.com",
  });
  assert.equal(blocked.ok, false);
  const ok = allowSendRecipient({
    testMode: true,
    allowlist: ["me@example.com"],
    recipient: "Me@Example.com",
  });
  assert.equal(ok.ok, true);
});

test("empty allowlist in test mode blocks all sends", () => {
  const r = allowSendRecipient({ testMode: true, allowlist: [], recipient: "anyone@x.com" });
  assert.equal(r.ok, false);
});

test("test mode off does not apply the allowlist", () => {
  const r = allowSendRecipient({ testMode: false, allowlist: [], recipient: "anyone@x.com" });
  assert.equal(r.ok, true);
});

test("test caps are 2 first / 3 follow-ups", () => {
  const caps = effectiveCaps({ testMode: true, maxFirst: 15, maxFollowups: 30 });
  assert.deepEqual(caps, TEST_CAPS);
  const live = effectiveCaps({ testMode: false, maxFirst: 15, maxFollowups: 30 });
  assert.equal(live.maxFirst, 15);
  assert.equal(live.maxFollowups, 30);
});

test("parseAllowlist drops junk and de-dupes", () => {
  assert.deepEqual(parseAllowlist("me@x.com, not-an-email, ME@x.com; you@z.net"), ["me@x.com", "you@z.net"]);
});

test("canSend honors test-mode allowlist", () => {
  const base = {
    prospect: { uid: "t", name: "TEST", stage: "Approved for Outreach" },
    gmailConnected: true,
    kind: "email" as const,
    method: "MANUAL" as const,
    firstApproved: true,
    sequenceActive: false,
    bounced: false,
    unsubscribed: false,
    usage: { first: 0, followups: 0 },
    caps: { maxFirst: 2, maxFollowups: 3 },
    now: new Date(),
  };
  const no = canSend({ ...base, recipient: "out@x.com", testMode: true, allowlist: ["in@x.com"] });
  assert.equal(no.ok, false);
  const yes = canSend({ ...base, recipient: "in@x.com", testMode: true, allowlist: ["in@x.com"] });
  assert.equal(yes.ok, true);
});

test("first-contact automation still needs approval in Test Mode", () => {
  const r = canSend({
    prospect: { uid: "t", name: "TEST", stage: "Approved for Outreach" },
    gmailConnected: true,
    recipient: "in@x.com",
    kind: "email",
    method: "AUTOMATION",
    firstApproved: false,
    sequenceActive: false,
    bounced: false,
    unsubscribed: false,
    usage: { first: 0, followups: 0 },
    caps: { maxFirst: 2, maxFollowups: 3 },
    now: new Date(),
    testMode: true,
    allowlist: ["in@x.com"],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_APPROVED");
});

test("approved follow-up automation is cancelled if the snapshot recipient is not allowlisted", () => {
  const snap = freezeSnapshot({
    recipient: "stranger@company.com",
    subject: "Re: hi",
    body: "follow",
    gmailThreadId: "t",
    sequenceId: "seq",
  });
  const d = decideFollowupSend({
    prospect: { uid: "t", name: "TEST", stage: "Contacted" },
    sequenceActive: true,
    snapshot: snap,
    now: new Date("2026-09-17T15:00:00Z"),
    hours: { workStart: 8, workEnd: 17, workDays: [1, 2, 3, 4, 5], timezone: "UTC" },
    gmailConnected: true,
    testMode: true,
    allowlist: ["me@example.com"],
  });
  assert.equal(d.action, "cancel");
});

test("sendMail in Test Mode never calls Gmail for a non-allowlisted address", async () => {
  let calls = 0;
  const gmail: GmailPort = {
    async send() {
      calls += 1;
      return { ok: true, messageId: "m", threadId: "t" };
    },
  };
  const r = await sendMail({
    userId: "u",
    prospect: { uid: "company-a", name: "ABC", stage: "Approved for Outreach" },
    kind: "email",
    method: "MANUAL",
    to: "owner@real-company.com",
    subject: "s",
    body: "b",
    deps: {
      gmail,
      gmailConnected: true,
      usage: { first: 0, followups: 0 },
      caps: { maxFirst: 2, maxFollowups: 3 },
      firstApproved: true,
      sequenceActive: false,
      bounced: false,
      unsubscribed: false,
      existingKeys: new Set(),
      testMode: true,
      allowlist: ["me@example.com"],
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NOT_ALLOWLISTED");
  assert.equal(calls, 0);
});

test("disable requires exact uppercase DISABLE", () => {
  assert.equal(canDisableTestMode("DISABLE"), true);
  assert.equal(canDisableTestMode(" DISABLE "), true);
  assert.equal(canDisableTestMode("disable"), false);
  assert.equal(canDisableTestMode("Disable"), false);
  assert.equal(canDisableTestMode("yes"), false);
  assert.equal(canDisableTestMode("off"), false);
  assert.equal(canDisableTestMode(""), false);
});

test("disable intent still fires if boolean false is dropped but confirm is present", () => {
  assert.equal(wantsDisableTestMode({ testMode: false, confirm: "DISABLE" }), true);
  assert.equal(wantsDisableTestMode({ confirm: "DISABLE" }), true);
  assert.equal(wantsDisableTestMode({ testMode: true, confirm: "DISABLE" }), false);
  assert.equal(wantsDisableTestMode({ allowlist: ["a@b.com"] } as { testMode?: boolean; confirm?: string }), false);
  assert.equal(wantsDisableTestMode({ confirm: "disable" }), true);
});

test("first-contact automation still needs approval when Test Mode is off", () => {
  const r = canSend({
    prospect: { uid: "t", name: "Live", stage: "Approved for Outreach" },
    gmailConnected: true,
    recipient: "owner@company.com",
    kind: "email",
    method: "AUTOMATION",
    firstApproved: false,
    sequenceActive: false,
    bounced: false,
    unsubscribed: false,
    usage: { first: 0, followups: 0 },
    caps: { maxFirst: 15, maxFollowups: 30 },
    now: new Date(),
    testMode: false,
    allowlist: [],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_APPROVED");
});

test("readTestModeFlag treats driver false-likes as off", () => {
  assert.equal(readTestModeFlag(false), false);
  assert.equal(readTestModeFlag("f"), false);
  assert.equal(readTestModeFlag("false"), false);
  assert.equal(readTestModeFlag(0), false);
  assert.equal(readTestModeFlag(true), true);
  assert.equal(readTestModeFlag(undefined), true);
});

test("Disable Test Mode UI requires exact DISABLE and shows a result", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../components/test-desk.tsx"), "utf8");
  assert.match(src, /disableTestMode/);
  assert.match(src, /Type DISABLE exactly to continue/);
  assert.match(src, /disabled=\{disableConfirm\.trim\(\) !== "DISABLE"/);
  assert.match(src, /onTestModeChange/);
  assert.match(src, /Disabling…/);
  assert.match(src, /Live outreach rules now apply/);
});

test("live checks stay red until real evidence exists", () => {
  const empty = scoreLiveChecks({});
  assert.ok(empty.every((c) => c.ok === false));
  const partial = scoreLiveChecks({ messageId: "m1" });
  assert.equal(partial.find((c) => c.key === "send")?.ok, true);
  assert.equal(partial.find((c) => c.key === "thread")?.ok, false);
  assert.equal(partial.find((c) => c.key === "reply")?.ok, false);
  assert.equal(partial.find((c) => c.key === "booking")?.ok, false);
  assert.equal(partial.find((c) => c.key === "pipeline")?.ok, false);
});

test("follow-up stop is green only when a pending job existed and is gone after a reply", () => {
  const fake = scoreLiveChecks({
    replyCount: 1,
    followupsBeforeReply: 0,
    followupsAfterSync: 0,
  });
  assert.equal(fake.find((c) => c.key === "stop")?.ok, false);
  const real = scoreLiveChecks({
    replyCount: 1,
    followupsBeforeReply: 1,
    followupsAfterSync: 0,
  });
  assert.equal(real.find((c) => c.key === "stop")?.ok, true);
});

test("isAllowlisted is exact-email, not domain-wide", () => {
  assert.equal(isAllowlisted("other@example.com", ["me@example.com"]), false);
});

test("secretPresent never treats empty or default APP_SECRET as ready", () => {
  assert.equal(secretPresent(""), false);
  assert.equal(secretPresent("changeme", ["changeme"]), false);
  assert.equal(secretPresent("real-secret", ["changeme"]), true);
});

test("connection probes never hit Gmail send", async () => {
  const hits: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    hits.push(String(url));
    return new Response(JSON.stringify({ emailAddress: "me@example.com", calendars: { primary: { busy: [] } } }), { status: 200 });
  }) as typeof fetch;
  await gmailProfile("tok", fetchImpl);
  await probeFreeBusy("tok", fetchImpl);
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((u) => !u.includes("messages/send") && !u.includes("/events")));
});

test("integration readiness lights do not include secret values", () => {
  const lights = integrationLightsDoNotLeak({
    googleOAuthClientId: "ready",
    googleOAuthClientSecret: "missing",
    appSecret: "ready",
    outreachJobSecret: "missing",
    gmailConnection: "ready",
    calendarConnection: "missing",
    backgroundWorker: "missing",
  });
  assert.equal(lights.includes("sk-"), false);
  assert.deepEqual(lights, [
    "googleOAuthClientId:ready",
    "googleOAuthClientSecret:missing",
    "appSecret:ready",
    "outreachJobSecret:missing",
    "gmailConnection:ready",
    "calendarConnection:missing",
    "backgroundWorker:missing",
  ]);
});
