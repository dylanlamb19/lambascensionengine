import { env } from "@/lib/env.server";
import { googleOAuthConfigured } from "@/lib/google/oauth";
import { gmailProfile } from "@/lib/google/gmail";
import { probeFreeBusy, offeredSlots, createEvent, CALENDAR_UNREADABLE } from "@/lib/google/calendar";
import { slotIsOffered } from "./booking";
import { accessFor, sendLive, syncRepliesForUser } from "./live.server";
import {
  googleStatus,
  loadSettings,
  saveTestSettings,
  loadTestState,
  saveTestState,
  saveSequence,
  lastThread,
  countScheduledFollowups,
  createBookingLink,
  claimBookingLink,
  finishBookingLink,
  saveCalendarEvent,
  audit,
  loadWorkerHeartbeat,
} from "./sql.server";
import { getProspectByUid, upsertProspects } from "@/lib/prospects/repo.server";
import {
  canDisableTestMode,
  isEmailShape,
  light,
  parseAllowlist,
  scoreLiveChecks,
  secretPresent,
} from "./test-mode";
import { workerLight } from "./heartbeat";
import type { Prospect } from "@/lib/review-brief";

export const TEST_UID = "test-sales-flow";

export function integrationReadiness(user: { gmail: string; calendar: string }) {
  const appSecret = secretPresent(env("APP_SECRET"), ["dev-preview-only-not-for-production", "changeme"]);
  return {
    googleOAuthClientId: light(secretPresent(env("GOOGLE_OAUTH_CLIENT_ID"))),
    googleOAuthClientSecret: light(secretPresent(env("GOOGLE_OAUTH_CLIENT_SECRET"))),
    appSecret: light(appSecret),
    outreachJobSecret: light(secretPresent(env("OUTREACH_JOB_SECRET"))),
    gmailConnection: light(user.gmail === "connected"),
    calendarConnection: light(user.calendar === "connected"),
    backgroundWorker: light(secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET"))),
    oauthConfigured: googleOAuthConfigured(),
  };
}

export async function connectionTest(userId: string) {
  const session = { ok: true as const, detail: "You are signed in." };
  const gmailTokens = await accessFor(userId, "gmail");
  let gmailToken = { ok: false as boolean, detail: "Gmail is not connected." };
  let gmailIdentity = { ok: false as boolean, detail: "Gmail account identity was not read.", email: "" };
  if (gmailTokens) {
    gmailToken = { ok: true, detail: "Gmail token is valid." };
    const prof = await gmailProfile(gmailTokens.access_token);
    if (prof.ok) gmailIdentity = { ok: true, detail: `Gmail account: ${prof.email}`, email: prof.email };
    else gmailIdentity = { ok: false, detail: prof.reason, email: "" };
  }
  const calTokens = await accessFor(userId, "calendar");
  let calendarToken = { ok: false as boolean, detail: "Calendar is not connected." };
  let calendarFreeBusy = { ok: false as boolean, detail: "Calendar free/busy was not read." };
  if (calTokens) {
    calendarToken = { ok: true, detail: "Calendar token is valid." };
    const probe = await probeFreeBusy(calTokens.access_token);
    calendarFreeBusy = probe.ok
      ? { ok: true, detail: "Calendar free/busy can be read." }
      : { ok: false, detail: probe.reason };
  }
  const beat = await loadWorkerHeartbeat();
  const worker = workerLight({
    secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    lastCompletedAt: beat.lastCompletedAt,
    now: Date.now(),
  });
  return { session, gmailToken, gmailIdentity, calendarToken, calendarFreeBusy, worker: { ok: worker.state === "running", detail: worker.detail } };
}

function testProspect(email: string): Prospect {
  const now = new Date().toISOString();
  return {
    id: 900001,
    uid: TEST_UID,
    name: "TEST — Live Sales",
    vertical: "Internal test",
    city: "Test Mode",
    website: "",
    review_count: 0,
    google_rating: "UNKNOWN",
    phone: "UNKNOWN",
    job_value_est: 0,
    job_value_kind: "UNKNOWN",
    score: 0,
    fit: "possible",
    fit_plain: "This is a Test Mode send to an allowlisted inbox — not a sales prospect.",
    stage: "Approved for Outreach",
    stage_plain: "Test send — waiting for your confirmation",
    research_status: "none",
    findings: [],
    contacts: [{
      name: "Test recipient",
      title: "Allowlisted inbox",
      email,
      email_status: "verified",
      profile_url: "",
      source: "owner allowlist",
      last_verified: now,
    }],
    facts: [{
      key: "test_mode",
      value: "true",
      source: "owner",
      checked_at: now,
      confidence: "high",
      status: "VERIFIED",
    }],
    outreach: {
      fingerprint: `test:${email}`,
      generated_at: now,
      generator: "evidence",
      estimated_cents: 0,
      brief: {
        who: "Allowlisted test inbox",
        why: "Confirm Gmail send, threading, replies, and booking without emailing a real prospect.",
        decision_maker: email,
        help: "This is a system test, not a sales pitch.",
        angle: "Live connection test",
        unknown: ["Do not treat this as a client."],
      },
      messages: [
        {
          kind: "email",
          subject: "[TEST] Lamb Ascension live send check",
          body: `This is a TEST email from Lamb Ascension Test Mode.\n\nIt was sent only because ${email} is on the owner’s test allowlist.\n\nPlease reply to this thread with any short message so reply detection can be verified.\n\nIf you did not expect this, you can ignore it.`,
          state: "READY FOR REVIEW",
          angle: "test",
          angle_why: "Allowlisted live test",
          evidence_used: ["test_mode"],
        },
        {
          kind: "followup1",
          subject: "Re: [TEST] Lamb Ascension live send check",
          body: "TEST follow-up 1. Reply to the original thread if you have not already. This is not a sales email.",
          state: "DRAFT",
          angle: "test",
          angle_why: "Allowlisted live test",
          evidence_used: ["test_mode"],
        },
      ],
      call: {
        who: email,
        why: "Booking path test",
        point: "This meeting is a Test Mode calendar check.",
        opener: "This is a test booking.",
        next_question: "Did the calendar event appear?",
      },
    },
    history: [{ at: now, action: "test_mode", detail: `Prepared test send to ${email}` }],
  };
}

export async function testSettingsView(userId: string) {
  const settings = await loadSettings(userId);
  const status = await googleStatus(userId);
  const state = await loadTestState(userId);
  const beat = await loadWorkerHeartbeat();
  const worker = workerLight({
    secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    lastCompletedAt: beat.lastCompletedAt,
    now: Date.now(),
  });
  return {
    ok: true as const,
    testMode: settings.testMode,
    allowlist: settings.allowlist,
    caps: { maxFirst: settings.testMode ? 2 : settings.maxFirst, maxFollowups: settings.testMode ? 3 : settings.maxFollowups },
    integrations: integrationReadiness({ gmail: status.gmail, calendar: status.calendar }),
    worker,
    gmailEmail: status.gmailEmail,
    calendarEmail: status.calendarEmail,
    checks: scoreLiveChecks({
      messageId: state.message_id,
      threadId: state.thread_id,
      replyCount: state.reply_count,
      followupsBeforeReply: state.followups_before,
      followupsAfterSync: state.followups_after,
      sequenceId: state.sequence_id,
      slotsOffered: state.slots_offered,
      eventId: state.event_id,
      pipelineStage: state.pipeline_stage,
      workerRunId: state.worker_run_id || beat.runId,
      workerSeenAt: state.worker_seen_at,
      secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    }),
    state,
  };
}

export async function updateTestMode(userId: string, data: { testMode?: boolean; allowlist?: string[]; confirm?: string }) {
  const current = await loadSettings(userId);
  let testMode = current.testMode;
  if (data.testMode === false) {
    if (!canDisableTestMode(data.confirm || "")) {
      return { ok: false as const, reason: "Type DISABLE to turn Test Mode off. It stays on until you do." };
    }
    testMode = false;
  } else if (data.testMode === true) {
    testMode = true;
  }
  const allowlist = data.allowlist ? parseAllowlist(data.allowlist) : current.allowlist;
  await saveTestSettings(userId, { testMode, allowlist });
  await audit(userId, "test_mode", testMode ? "Test Mode on" : "Test Mode off", { method: "MANUAL" });
  return testSettingsView(userId);
}

export async function chooseTestRecipient(userId: string, recipient: string) {
  const settings = await loadSettings(userId);
  if (!settings.testMode) return { ok: false as const, reason: "Turn Test Mode on to run the live sales test." };
  const email = (recipient || "").trim().toLowerCase();
  if (!isEmailShape(email)) return { ok: false as const, reason: "That does not look like an email address." };
  if (!settings.allowlist.includes(email)) {
    return { ok: false as const, reason: "Add that address to the test allowlist in Settings first. Nothing was sent." };
  }
  const prospect = testProspect(email);
  await upsertProspects(userId, [prospect]);
  const state = await saveTestState(userId, { recipient: email, prospect_uid: TEST_UID, step: 2, pipeline_stage: prospect.stage });
  return { ok: true as const, prospect, preview: prospect.outreach?.messages.find((m) => m.kind === "email"), state };
}

export async function confirmTestSend(userId: string) {
  const settings = await loadSettings(userId);
  const state = await loadTestState(userId);
  if (!settings.testMode) return { ok: false as const, reason: "Test Mode is off." };
  const prospect = await getProspectByUid(userId, state.prospect_uid || TEST_UID);
  if (!prospect) return { ok: false as const, reason: "Choose a test recipient first." };
  const email = prospect.outreach?.messages.find((m) => m.kind === "email");
  if (!email) return { ok: false as const, reason: "There is no test email to send." };
  const sent = await sendLive({
    userId,
    prospect,
    kind: "email",
    method: "MANUAL",
    to: state.recipient,
    subject: email.subject || "[TEST] Lamb Ascension live send check",
    body: email.body,
    firstApproved: true,
  });
  if (!sent.ok) return sent;
  prospect.stage = "Contacted";
  prospect.stage_plain = "Test email sent — waiting on a reply";
  if (prospect.outreach) {
    prospect.outreach.messages = prospect.outreach.messages.map((m) => m.kind === "email" ? { ...m, state: "SENT" } : m);
  }
  await upsertProspects(userId, [prospect]);
  const next = await saveTestState(userId, {
    message_id: sent.messageId,
    thread_id: sent.threadId,
    step: 5,
    pipeline_stage: prospect.stage,
  });
  return { ok: true as const, messageId: sent.messageId, threadId: sent.threadId, state: next };
}

export async function approveTestFollowup(userId: string) {
  const state = await loadTestState(userId);
  const prospect = await getProspectByUid(userId, state.prospect_uid || TEST_UID);
  if (!prospect || !state.message_id) return { ok: false as const, reason: "Send the test email first." };
  const f1 = prospect.outreach?.messages.find((m) => m.kind === "followup1");
  const threadId = (await lastThread(userId, TEST_UID)) || state.thread_id;
  const id = await saveSequence(userId, TEST_UID, "MANUAL", [
    {
      step: "followup1",
      dueAt: Date.now() + 3 * 86400000,
      idempotencyKey: `${userId}:${TEST_UID}:followup1`,
      body: f1?.body || "TEST follow-up 1.",
      subject: f1?.subject || "Re: [TEST] Lamb Ascension live send check",
      recipient: state.recipient,
      threadId,
    },
  ]);
  const pending = await countScheduledFollowups(userId, TEST_UID);
  const next = await saveTestState(userId, { sequence_id: id, followups_before: pending, step: 6 });
  return { ok: true as const, sequenceId: id, pending, state: next };
}

export async function syncTestReplies(userId: string) {
  const state = await loadTestState(userId);
  const result = await syncRepliesForUser(userId);
  const pending = await countScheduledFollowups(userId, state.prospect_uid || TEST_UID);
  const next = await saveTestState(userId, {
    reply_count: result.replies,
    followups_after: pending,
    step: 9,
  });
  return { ok: true as const, replies: result.replies, followupsLeft: pending, state: next };
}

export async function testBookingLink(userId: string, origin: string) {
  const state = await loadTestState(userId);
  const uid = state.prospect_uid || TEST_UID;
  const prospect = await getProspectByUid(userId, uid);
  if (!prospect) return { ok: false as const, reason: "Choose a test recipient first." };
  const tokens = await accessFor(userId, "calendar");
  if (!tokens) return { ok: false as const, reason: "Calendar is not connected." };
  const avail = await offeredSlots(tokens.access_token, { count: 3 });
  if (!avail.ok) return { ok: false as const, reason: CALENDAR_UNREADABLE };
  const slots = avail.slots.map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    label: s.label,
  }));
  const token = await createBookingLink(userId, uid);
  const next = await saveTestState(userId, { booking_token: token, slots_offered: slots.length, step: 10 });
  return { ok: true as const, url: `${origin}/book/${token}`, token, slots, state: next };
}

export async function testBookSlot(userId: string, startIso: string, endIso: string) {
  const state = await loadTestState(userId);
  const token = state.booking_token;
  if (!token) return { ok: false as const, reason: "Generate a booking link first." };
  const claimed = await claimBookingLink(token);
  if (!claimed) return { ok: false as const, reason: "This booking link was already used." };
  const tokens = await accessFor(userId, "calendar");
  if (!tokens) {
    await finishBookingLink(token, "open");
    return { ok: false as const, reason: "Calendar needs to be reconnected. No meeting was created." };
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  const from = new Date();
  const avail = await offeredSlots(tokens.access_token, { from, count: 8 });
  if (!avail.ok) {
    await finishBookingLink(token, "open");
    return { ok: false as const, reason: CALENDAR_UNREADABLE };
  }
  const check = slotIsOffered({ start, end }, avail.slots, from);
  if (!check.ok) {
    await finishBookingLink(token, "open");
    return { ok: false as const, reason: check.reason };
  }
  const created = await createEvent(tokens.access_token, {
    title: "TEST — Lamb Ascension sales-flow check",
    start,
    end,
    description: "Test Mode calendar check. Not a client meeting.",
  });
  if (!created.ok) {
    await finishBookingLink(token, "open");
    return { ok: false as const, reason: created.error };
  }
  await finishBookingLink(token, "used");
  await saveCalendarEvent(userId, claimed.prospect_uid, created.id, "TEST sales call", start, end);
  const prospect = await getProspectByUid(userId, claimed.prospect_uid);
  if (prospect) {
    prospect.stage = "Call Booked";
    prospect.stage_plain = "Test call booked";
    await upsertProspects(userId, [prospect]);
  }
  const next = await saveTestState(userId, {
    event_id: created.id,
    pipeline_stage: "Call Booked",
    step: 11,
  });
  await audit(userId, "test_booking", "Test Mode booked a calendar slot", { prospectUid: claimed.prospect_uid, method: "MANUAL", providerIds: created.id });
  return { ok: true as const, eventId: created.id, state: next };
}
