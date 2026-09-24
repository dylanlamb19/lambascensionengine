import { env } from "@/lib/env.server";
import { googleOAuthSetup } from "@/lib/google/oauth";
import { offeredSlots, createEvent, CALENDAR_UNREADABLE } from "@/lib/google/calendar";
import { slotIsOffered } from "./booking";
import { accessFor, sendLive, syncRepliesForUser } from "./live.server";
import {
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
  audit,
  loadWorkerHeartbeat,
  loadTestLoop,
  inspectTestFlow,
  cancelPendingTestFollowups,
} from "./sql.server";
import { getProspectByUid, upsertProspects } from "@/lib/prospects/repo.server";
import {
  canDisableTestMode,
  gateTestModeDisable,
  isEmailShape,
  light,
  parseAllowlist,
  scoreLiveChecks,
  secretPresent,
  wantsDisableTestMode,
} from "./test-mode";
import { workerLight } from "./heartbeat";
import type { Prospect } from "@/lib/review-brief";
import { loadIntegrationStatus } from "./integration-status.server";
import type { IntegrationStatus } from "./integration-status";
import {
  EMPTY_TEST_LOOP,
  TEST_FOLLOWUP_REMAINING_MS,
  TEST_FOLLOWUP_SHORT_MS,
  TEST_RECORD_NAME,
  TEST_UID,
  TEST_WORKFLOW_UID,
  isTestWorkflowUid,
  isUnusedTestRun,
  newTestRunId,
  testEmailCopy,
  testFollowupIdempotencyKey,
  testLoopSpeech,
  testRunUid,
  type TestLoopState,
} from "./test-loop";

export { TEST_UID, TEST_WORKFLOW_UID };

export function integrationReadiness(status: IntegrationStatus) {
  const setup = googleOAuthSetup();
  const byName = (name: string) => setup.find((row) => row.name === name)?.ready === true;
  return {
    googleOAuthClientId: light(byName("Google OAuth Client ID")),
    googleOAuthClientSecret: light(byName("Google OAuth Client Secret")),
    appSecret: light(byName("APP_SECRET")),
    outreachJobSecret: light(secretPresent(env("OUTREACH_JOB_SECRET"))),
    gmailConnection: light(status.gmail_connected),
    calendarConnection: light(status.calendar_connected),
    backgroundWorker: light(status.worker_configured),
    oauthConfigured: status.google_oauth_configured,
  };
}

export async function connectionTest(userId: string) {
  const integration = await loadIntegrationStatus(userId, { probeLive: true });
  const session = { ok: true as const, detail: "You are signed in." };
  const gmailToken = integration.gmail_token_valid
    ? { ok: true as boolean, detail: "Gmail token is valid." }
    : { ok: false as boolean, detail: integration.gmail_connected ? "Gmail token needs attention." : "Gmail is not connected." };
  const gmailIdentity = integration.gmail_identity
    ? { ok: true as boolean, detail: `Gmail account: ${integration.gmail_identity}`, email: integration.gmail_identity }
    : { ok: false as boolean, detail: "Gmail account identity was not read.", email: "" };
  const calendarToken = integration.calendar_connected && integration.calendar_token_valid
    ? { ok: true as boolean, detail: "Calendar token is valid." }
    : { ok: false as boolean, detail: integration.calendar_connected ? "Calendar token needs attention. (TOKEN_INVALID)" : "Calendar is not connected. (CALENDAR_NOT_AUTHORIZED)" };
  const calendarIdentity = integration.calendar_identity
    ? { ok: true as boolean, detail: `Calendar account: ${integration.calendar_identity}`, email: integration.calendar_identity }
    : { ok: false as boolean, detail: integration.calendar_connected ? "Calendar account identity was not read." : "Calendar is not connected.", email: "" };
  const calendarFreeBusy = integration.calendar_freebusy_valid
    ? { ok: true as boolean, detail: "Calendar availability was read." }
    : {
      ok: false as boolean,
      detail: integration.calendar_connected
        ? (integration.calendar_freebusy_detail || "Calendar availability couldn’t be read.")
        : "Calendar is not connected.",
    };
  const worker = {
    ok: integration.worker_state === "running",
    detail: integration.worker_detail,
  };
  return { session, gmailToken, gmailIdentity, calendarToken, calendarIdentity, calendarFreeBusy, worker, integration };
}

function testProspect(email: string, uid: string): Prospect {
  const now = new Date().toISOString();
  const copy = testEmailCopy(email);
  return {
    id: 900001,
    uid,
    name: TEST_RECORD_NAME,
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
    stage_plain: "TEST record — waiting for your confirmation. Not a real prospect.",
    research_status: "none",
    is_demo: true,
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
        why: "Confirm Gmail send, threading, replies, and follow-up stop without emailing a real prospect.",
        decision_maker: email,
        help: "This is a system test, not a sales pitch.",
        angle: "Live connection test",
        unknown: ["Do not treat this as a client."],
      },
      messages: [
        {
          kind: "email",
          subject: copy.subject,
          body: copy.body,
          state: "READY FOR REVIEW",
          angle: "test",
          angle_why: "Allowlisted live test",
          evidence_used: ["test_mode"],
        },
        {
          kind: "followup1",
          subject: `Re: ${copy.subject}`,
          body: copy.followup1,
          state: "DRAFT",
          angle: "test",
          angle_why: "Allowlisted live test",
          evidence_used: ["test_mode"],
        },
        {
          kind: "followup2",
          subject: `Re: ${copy.subject}`,
          body: copy.followup2,
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
    history: [{ at: now, action: "test_draft_created", detail: `Prepared test send to ${email}` }],
  };
}

function asTestLoop(row: Awaited<ReturnType<typeof loadTestLoop>>): TestLoopState {
  return {
    ...EMPTY_TEST_LOOP,
    recipient: row.recipient,
    allowlisted: row.allowlisted,
    initialSent: row.initialSent,
    followupScheduled: row.followupScheduled,
    followupDueAt: row.followupDueAt,
    followupSent: row.followupSent,
    pendingFollowups: row.pendingFollowups,
    replyDetected: row.replyCount > 0,
    replyCount: row.replyCount,
    sequenceStopped: row.sequenceStopped,
  };
}

export async function testSettingsView(userId: string) {
  const settings = await loadSettings(userId);
  const integration = await loadIntegrationStatus(userId);
  const reconciled = await (await import("./booking-confirm.server")).reconcileTestBookingFromPersisted(userId);
  const state = reconciled.state;
  const beat = await loadWorkerHeartbeat();
  const loopRow = await loadTestLoop(userId);
  const testLoop = asTestLoop(loopRow);
  const worker = workerLight({
    secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    lastCompletedAt: beat.lastCompletedAt,
    lastResult: beat.lastResult,
    now: Date.now(),
  });
  return {
    ok: true as const,
    testMode: settings.testMode,
    allowlist: settings.allowlist,
    caps: { maxFirst: settings.testMode ? 2 : settings.maxFirst, maxFollowups: settings.testMode ? 3 : settings.maxFollowups },
    integrations: integrationReadiness(integration),
    integration,
    worker,
    gmailEmail: integration.gmail_identity,
    calendarEmail: integration.calendar_identity,
    checks: scoreLiveChecks({
      messageId: state.message_id,
      threadId: state.thread_id,
      replyCount: loopRow.replyCount || state.reply_count,
      followupsBeforeReply: state.followups_before,
      followupsAfterSync: loopRow.pendingFollowups,
      sequenceId: state.sequence_id,
      slotsOffered: state.slots_offered,
      eventId: state.event_id,
      pipelineStage: state.pipeline_stage,
      workerRunId: state.worker_run_id || beat.runId,
      workerSeenAt: state.worker_seen_at,
      secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    }),
    state,
    testLoop,
    speech: testLoopSpeech(testLoop),
    trail: loopRow.trail,
    bookingReconciled: reconciled.reconciled,
  };
}

export async function updateTestMode(userId: string, data: { testMode?: boolean; allowlist?: string[]; confirm?: string }) {
  const current = await loadSettings(userId);
  let testMode = current.testMode;
  if (wantsDisableTestMode(data)) {
    const { collectLiveOutreachReadiness } = await import("@/lib/autonomy/readiness.server");
    const readiness = await collectLiveOutreachReadiness(userId);
    const gate = gateTestModeDisable({ confirm: data.confirm || "", testMode: current.testMode, readiness });
    if (!gate.ok) return { ok: false as const, reason: gate.reason, blockers: gate.blockers, readiness };
    testMode = false;
    const allowlist = data.allowlist ? parseAllowlist(data.allowlist) : current.allowlist;
    await saveTestSettings(userId, { testMode, allowlist });
    await audit(userId, "TEST_MODE_DISABLED", "previous=on new=off", { method: "MANUAL" });
    const view = await testSettingsView(userId);
    if (view.testMode !== false) {
      return { ok: false as const, reason: "Server could not save the setting." };
    }
    return view;
  }
  if (data.testMode === true) {
    testMode = true;
  }
  const allowlist = data.allowlist ? parseAllowlist(data.allowlist) : current.allowlist;
  await saveTestSettings(userId, { testMode, allowlist });
  await audit(userId, "test_mode", testMode ? "Test Mode on" : "Test Mode off", { method: "MANUAL" });
  return testSettingsView(userId);
}

export async function resetTestFlow(userId: string) {
  const settings = await loadSettings(userId);
  const inspected = await inspectTestFlow(userId);
  const previousUid = inspected.prospectUid;
  const { cancelled, stoppedSequences } = await cancelPendingTestFollowups(userId);
  const runId = newTestRunId();
  const runUid = testRunUid(runId);
  await audit(userId, "TEST_FLOW_RESET", `cancelled_pending=${cancelled} stopped_sequences=${stoppedSequences} previous=${previousUid || "none"} next=${runUid} sent=0`, {
    prospectUid: runUid,
    method: "MANUAL",
  });
  await saveTestState(userId, {
    prospect_uid: runUid,
    message_id: null,
    thread_id: null,
    sequence_id: null,
    followups_before: 0,
    reply_count: 0,
    followups_after: null,
    booking_token: null,
    event_id: null,
    slots_offered: 0,
    pipeline_stage: null,
    step: 1,
  });
  const view = await testSettingsView(userId);
  return {
    ...view,
    ok: true as const,
    sent: 0 as const,
    cancelledFollowups: cancelled,
    stoppedSequences,
    previousUid,
    runId,
    runUid,
    inspected,
    testMode: settings.testMode,
  };
}

export async function chooseTestRecipient(userId: string, recipient: string) {
  const settings = await loadSettings(userId);
  if (!settings.testMode) return { ok: false as const, reason: "Turn Test Mode on to run the live sales test." };
  const email = (recipient || "").trim().toLowerCase();
  if (!isEmailShape(email)) return { ok: false as const, reason: "That does not look like an email address." };
  if (!settings.allowlist.includes(email)) {
    return { ok: false as const, reason: "Add that address to the test allowlist in Settings first. Nothing was sent." };
  }
  const current = await loadTestState(userId);
  let runUid = current.prospect_uid;
  if (!isUnusedTestRun(current) || !isTestWorkflowUid(runUid)) {
    const reset = await resetTestFlow(userId);
    runUid = reset.runUid;
  }
  const prospect = testProspect(email, runUid!);
  await upsertProspects(userId, [prospect]);
  await audit(userId, "test_workflow_created", `TEST • Outreach Automation Verification for ${email}`, { prospectUid: runUid!, method: "MANUAL" });
  await audit(userId, "test_draft_created", `Prepared TEST outreach to ${email}`, { prospectUid: runUid!, method: "MANUAL" });
  const state = await saveTestState(userId, { recipient: email, prospect_uid: runUid!, step: 2, pipeline_stage: prospect.stage });
  const first = prospect.outreach?.messages.find((m) => m.kind === "email");
  const follow = prospect.outreach?.messages.find((m) => m.kind === "followup1");
  return {
    ok: true as const,
    prospect,
    preview: first ? { recipient: email, subject: first.subject, body: first.body } : null,
    followupPreview: follow ? { recipient: email, subject: follow.subject, body: follow.body } : null,
    state,
  };
}

export async function confirmTestSend(userId: string) {
  const settings = await loadSettings(userId);
  const state = await loadTestState(userId);
  if (!settings.testMode) return { ok: false as const, reason: "Test Mode is off.", code: "INITIAL_SEND_FAILED" as const };
  const runUid = state.prospect_uid;
  if (!isTestWorkflowUid(runUid)) return { ok: false as const, reason: "Choose a test recipient first.", code: "INITIAL_SEND_FAILED" as const };
  const prospect = await getProspectByUid(userId, runUid);
  if (!prospect) return { ok: false as const, reason: "Choose a test recipient first.", code: "INITIAL_SEND_FAILED" as const };
  const email = prospect.outreach?.messages.find((m) => m.kind === "email");
  if (!email) return { ok: false as const, reason: "There is no test email to send.", code: "INITIAL_SEND_FAILED" as const };
  const allow = settings.allowlist.includes((state.recipient || "").toLowerCase());
  if (!allow) {
    return { ok: false as const, reason: "That address is not on your test list. Nothing was sent.", code: "NOT_ALLOWLISTED" as const };
  }
  if (state.message_id && state.thread_id) {
    return { ok: true as const, messageId: state.message_id, threadId: state.thread_id, state };
  }
  await audit(userId, "initial_send_approved", `Confirm send to ${state.recipient}`, { prospectUid: runUid, method: "MANUAL" });
  const copy = testEmailCopy(state.recipient);
  const sent = await sendLive({
    userId,
    prospect,
    kind: "email",
    method: "MANUAL",
    to: state.recipient,
    subject: email.subject || copy.subject,
    body: email.body || copy.body,
    firstApproved: true,
    sequenceId: "initial",
  });
  if (!sent.ok) {
    if (sent.code === "DUPLICATE") {
      const { lastSentIds } = await import("./sql.server");
      const existing = await lastSentIds(userId, runUid);
      if (existing?.messageId) {
        const next = await saveTestState(userId, {
          message_id: existing.messageId,
          thread_id: existing.threadId,
          step: 5,
          pipeline_stage: "Contacted",
        });
        return { ok: true as const, messageId: existing.messageId, threadId: existing.threadId, state: next };
      }
    }
    return {
      ok: false as const,
      reason: sent.reason,
      code: sent.code === "UNKNOWN_DELIVERY" ? "UNKNOWN_DELIVERY" as const : sent.code === "NOT_ALLOWLISTED" ? "NOT_ALLOWLISTED" as const : "INITIAL_SEND_FAILED" as const,
    };
  }
  if (!sent.threadId) {
    return { ok: false as const, reason: "Gmail did not return a thread id. Follow-ups will not be scheduled.", code: "THREAD_MATCH_FAILED" as const };
  }
  prospect.stage = "Contacted";
  prospect.stage_plain = "TEST email sent — waiting on the worker follow-up. Not a real prospect.";
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
  await audit(userId, "initial_send_result", `sent message=${sent.messageId}`, {
    prospectUid: runUid,
    method: "MANUAL",
    providerIds: sent.messageId,
  });
  return { ok: true as const, messageId: sent.messageId, threadId: sent.threadId, state: next };
}

export async function approveTestFollowup(userId: string) {
  const state = await loadTestState(userId);
  const runUid = state.prospect_uid;
  if (!isTestWorkflowUid(runUid) || !state.message_id) {
    return { ok: false as const, reason: "Send the test email first.", code: "FOLLOWUP_SCHEDULE_FAILED" as const };
  }
  const prospect = await getProspectByUid(userId, runUid);
  if (!prospect) {
    return { ok: false as const, reason: "Send the test email first.", code: "FOLLOWUP_SCHEDULE_FAILED" as const };
  }
  if (state.sequence_id) {
    const pending = await countScheduledFollowups(userId, runUid);
    return {
      ok: true as const,
      sequenceId: state.sequence_id,
      pending,
      dueAt: "",
      remainingDueAt: "",
      state,
    };
  }
  const copy = testEmailCopy(state.recipient);
  const f1 = prospect.outreach?.messages.find((m) => m.kind === "followup1");
  const f2 = prospect.outreach?.messages.find((m) => m.kind === "followup2");
  const threadId = (await lastThread(userId, runUid)) || state.thread_id;
  if (!threadId) {
    return { ok: false as const, reason: "No Gmail thread to attach the follow-up to.", code: "THREAD_MATCH_FAILED" as const };
  }
  const now = Date.now();
  const dueShort = now + TEST_FOLLOWUP_SHORT_MS;
  const dueLater = now + TEST_FOLLOWUP_REMAINING_MS;
  let id: string;
  try {
    id = await saveSequence(userId, runUid, "MANUAL", [
      {
        step: "followup1",
        dueAt: dueShort,
        idempotencyKey: testFollowupIdempotencyKey(userId, runUid, "followup1"),
        body: f1?.body || copy.followup1,
        subject: f1?.subject || `Re: ${copy.subject}`,
        recipient: state.recipient,
        threadId,
      },
      {
        step: "followup2",
        dueAt: dueLater,
        idempotencyKey: testFollowupIdempotencyKey(userId, runUid, "followup2"),
        body: f2?.body || copy.followup2,
        subject: f2?.subject || `Re: ${copy.subject}`,
        recipient: state.recipient,
        threadId,
      },
    ]);
  } catch {
    const pending = await countScheduledFollowups(userId, runUid);
    if (pending > 0) {
      const next = await saveTestState(userId, { followups_before: pending, step: 6 });
      return {
        ok: true as const,
        sequenceId: state.sequence_id || "",
        pending,
        dueAt: new Date(dueShort).toISOString(),
        remainingDueAt: new Date(dueLater).toISOString(),
        state: next,
      };
    }
    return { ok: false as const, reason: "Could not freeze the test follow-up schedule.", code: "FOLLOWUP_SCHEDULE_FAILED" as const };
  }
  const pending = await countScheduledFollowups(userId, runUid);
  const next = await saveTestState(userId, { sequence_id: id, followups_before: pending, step: 6 });
  await audit(userId, "followup_approved", `short due ${new Date(dueShort).toISOString()}; remaining due ${new Date(dueLater).toISOString()}`, {
    prospectUid: runUid,
    method: "MANUAL",
    sequenceId: id,
  });
  return {
    ok: true as const,
    sequenceId: id,
    pending,
    dueAt: new Date(dueShort).toISOString(),
    remainingDueAt: new Date(dueLater).toISOString(),
    state: next,
  };
}

export async function syncTestReplies(userId: string) {
  const state = await loadTestState(userId);
  try {
    const result = await syncRepliesForUser(userId);
    const pending = await countScheduledFollowups(userId, isTestWorkflowUid(state.prospect_uid) ? state.prospect_uid! : TEST_UID);
    if (result.replies > 0 && pending > 0) {
      return {
        ok: false as const,
        reason: "A reply was stored but pending follow-ups were not cancelled.",
        code: "FOLLOWUP_CANCEL_FAILED" as const,
        replies: result.replies,
        followupsLeft: pending,
      };
    }
    const next = await saveTestState(userId, {
      reply_count: result.replies,
      followups_after: pending,
      step: 9,
    });
    return { ok: true as const, replies: result.replies, followupsLeft: pending, state: next };
  } catch {
    return { ok: false as const, reason: "Gmail reply sync failed. Nothing else was sent.", code: "REPLY_SYNC_FAILED" as const };
  }
}

export async function testBookingLink(userId: string, origin: string) {
  const state = await loadTestState(userId);
  const uid = isTestWorkflowUid(state.prospect_uid) ? state.prospect_uid! : TEST_UID;
  const prospect = await getProspectByUid(userId, uid);
  if (!prospect) return { ok: false as const, reason: "Choose a test recipient first." };
  const tokens = await accessFor(userId, "calendar");
  if (!tokens) return { ok: false as const, reason: "Calendar is not connected." };
  const avail = await offeredSlots(tokens.access_token, { count: 3, calendarId: tokens.email });
  if (!avail.ok) return { ok: false as const, reason: CALENDAR_UNREADABLE };
  const slots = avail.slots.map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    label: s.label,
  }));
  const token = await createBookingLink(userId, uid);
  const next = await saveTestState(userId, { booking_token: token, slots_offered: slots.length, step: 10 });
  await audit(userId, "booking_link_created", `Booking link created for ${prospect.name}`, { prospectUid: uid, method: "MANUAL" });
  return { ok: true as const, url: `${origin}/book/${token}`, token, slots, state: next };
}

export async function testBookSlot(userId: string, startIso: string, endIso: string) {
  const state = await loadTestState(userId);
  const token = state.booking_token;
  if (!token) return { ok: false as const, reason: "Generate a booking link first." };
  const runUid = isTestWorkflowUid(state.prospect_uid) ? state.prospect_uid : null;
  const { persistConfirmedBooking, provenBookingEventId, applyExistingBookingToTestState } = await import("./booking-confirm.server");
  const { googleEventIdForBookingToken } = await import("./booking-evidence");
  const claimed = await claimBookingLink(token);
  if (!claimed) {
    if (!runUid) return { ok: false as const, reason: "This booking link was already used." };
    const existing = await provenBookingEventId(userId, runUid, token);
    if (!existing) {
      return {
        ok: false as const,
        reason: "The Calendar event may already exist, but booking state could not be confirmed. No second event was created.",
        code: "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE" as const,
      };
    }
    const next = await applyExistingBookingToTestState(userId, runUid, existing.eventId, existing.startAt, existing.endAt, existing.title);
    return { ok: true as const, eventId: existing.eventId, state: next, already: true as const };
  }
  const tokens = await accessFor(userId, "calendar");
  if (!tokens) {
    await finishBookingLink(token, "open");
    return { ok: false as const, reason: "Calendar needs to be reconnected. No meeting was created." };
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  const from = new Date();
  const avail = await offeredSlots(tokens.access_token, { from, count: 8, calendarId: tokens.email });
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
    eventId: googleEventIdForBookingToken(token),
  });
  if (!created.ok) {
    await finishBookingLink(token, "open");
    return { ok: false as const, reason: created.error };
  }
  const persisted = await persistConfirmedBooking({
    userId,
    prospectUid: claimed.prospect_uid,
    googleEventId: created.id,
    title: "TEST sales call",
    start,
    end,
    token,
    method: "MANUAL",
  });
  if (!persisted.ok) {
    return { ok: false as const, reason: persisted.reason, code: persisted.code, eventId: persisted.eventId };
  }
  const next = await loadTestState(userId);
  return { ok: true as const, eventId: created.id, state: next };
}
