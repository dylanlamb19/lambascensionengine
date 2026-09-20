import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { InputMethod } from "./types";

function recipientOf(p: { contacts?: { email?: string }[]; name: string }): string {
  const hit = (p.contacts || []).find((c) => c.email && c.email !== "UNKNOWN" && c.email.includes("@"));
  return hit?.email || "";
}

export const googleStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { loadIntegrationStatus } = await import("./integration-status.server");
    const { gmailHealth, calendarHealth } = await import("./integration-status");
    const integration = await loadIntegrationStatus(context.userId);
    return {
      ok: true as const,
      configured: integration.google_oauth_configured,
      gmail: gmailHealth(integration),
      calendar: calendarHealth(integration),
      gmailEmail: integration.gmail_identity,
      calendarEmail: integration.calendar_identity,
      error: "",
      integration,
    };
  });

export const googleStartFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { kind: "gmail" | "calendar"; origin: string }) => data)
  .handler(async ({ data, context }) => {
    const { googleOAuthConfigured, googleOAuthSetup, authorizeUrl } = await import("../google/oauth");
    const missing = googleOAuthSetup();
    if (!googleOAuthConfigured()) {
      return {
        ok: false as const,
        reason: data.kind === "calendar"
          ? "Google Calendar can’t be connected yet because Google OAuth isn’t configured on this server."
          : "Gmail can’t be connected yet because Google OAuth isn’t configured on this server.",
        missing,
        next: "Whoever hosts Lamb Ascension needs to add the missing values. We will not ask for your Gmail password.",
      };
    }
    if (data.kind === "calendar") {
      const { accessFor } = await import("./live.server");
      const { probeCalendarApiEnabled } = await import("../google/calendar");
      const { CALENDAR_API_DISABLED_MESSAGE } = await import("../google/calendar-errors");
      const gmailTokens = await accessFor(context.userId, "gmail");
      if (gmailTokens) {
        const api = await probeCalendarApiEnabled(gmailTokens.access_token);
        if (api.enabled === false) {
          return {
            ok: false as const,
            reason: CALENDAR_API_DISABLED_MESSAGE,
            code: "CALENDAR_API_DISABLED" as const,
            missing,
            next: "Enable Google Calendar API in Google Cloud for LambAscensionEngine, then press Connect Google Calendar again. Gmail is unchanged.",
          };
        }
      }
    }
    const { saveOauthState, googleStatus } = await import("./sql.server");
    const rec = await saveOauthState(context.userId, data.kind);
    const accounts = await googleStatus(context.userId);
    const loginHint = data.kind === "calendar" ? (accounts.gmailEmail || undefined) : undefined;
    const url = authorizeUrl({ state: rec.state, kind: data.kind, requestUrl: data.origin, loginHint });
    return { ok: true as const, url, missing };
  });

export const googleDisconnectFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { kind: "gmail" | "calendar" }) => data)
  .handler(async ({ data, context }) => {
    const { disconnectGoogle, audit } = await import("./sql.server");
    await disconnectGoogle(context.userId, data.kind);
    await audit(context.userId, "google_disconnect", `Disconnected ${data.kind}`, { method: "MANUAL" });
    return { ok: true as const };
  });

export const salesCountsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { salesCounts } = await import("./sql.server");
    return { ok: true as const, ...(await salesCounts(context.userId)) };
  });

export const sendFirstEmailFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string; method?: InputMethod; approveSequence?: boolean }) => data)
  .handler(async ({ data, context }) => {
    if ((data.method || "MANUAL") === "COMPUTER") {
      return {
        ok: false as const,
        reason: "Ara’s computer cannot send by clicking. Say Confirm send if you want this email sent.",
      };
    }
    const { getProspectByUid } = await import("@/lib/prospects/repo.server");
    const prospect = await getProspectByUid(context.userId, data.uid);
    if (!prospect) return { ok: false as const, reason: "That company is not on your list." };
    const to = recipientOf(prospect);
    const pack = prospect.outreach;
    const email = pack?.messages.find((m) => m.kind === "email");
    if (!email) return { ok: false as const, reason: "There is no approved draft yet." };
    const { sendLive } = await import("./live.server");
    const sent = await sendLive({
      userId: context.userId,
      prospect,
      kind: "email",
      method: data.method || "MANUAL",
      to,
      subject: email.subject || `Quick note — ${prospect.name}`,
      body: email.body,
      firstApproved: true,
    });
    if (!sent.ok) return sent;
    if (data.approveSequence) {
      const { saveSequence } = await import("./sql.server");
      const f1 = pack?.messages.find((m) => m.kind === "followup1")?.body || "";
      const f2 = pack?.messages.find((m) => m.kind === "followup2")?.body || "";
      const f3 = pack?.messages.find((m) => m.kind === "followup3")?.body || "";
      const now = Date.now();
      await saveSequence(context.userId, prospect.uid || data.uid, data.method || "MANUAL", [
        { step: "followup1", dueAt: now + 3 * 86400000, idempotencyKey: `${context.userId}:${data.uid}:followup1`, body: f1, subject: email.subject || prospect.name, recipient: to, threadId: sent.threadId },
        { step: "followup2", dueAt: now + 7 * 86400000, idempotencyKey: `${context.userId}:${data.uid}:followup2`, body: f2, subject: email.subject || prospect.name, recipient: to, threadId: sent.threadId },
        { step: "followup3", dueAt: now + 12 * 86400000, idempotencyKey: `${context.userId}:${data.uid}:followup3`, body: f3, subject: email.subject || prospect.name, recipient: to, threadId: sent.threadId },
      ]);
    }
    return sent;
  });

export const approveSequenceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string; method?: InputMethod }) => data)
  .handler(async ({ data, context }) => {
    const { getProspectByUid } = await import("@/lib/prospects/repo.server");
    const { saveSequence, lastThread, audit } = await import("./sql.server");
    const prospect = await getProspectByUid(context.userId, data.uid);
    if (!prospect) return { ok: false as const, reason: "That company is not on your list." };
    const to = recipientOf(prospect);
    const pack = prospect.outreach;
    const email = pack?.messages.find((m) => m.kind === "email");
    if (!email) return { ok: false as const, reason: "Approve and send the first email before the sequence." };
    const { loadSettings } = await import("./sql.server");
    const { allowSendRecipient } = await import("./test-mode");
    const settings = await loadSettings(context.userId);
    const allow = allowSendRecipient({ testMode: settings.testMode, allowlist: settings.allowlist, recipient: to });
    if (!allow.ok) return { ok: false as const, reason: allow.reason };
    const threadId = await lastThread(context.userId, data.uid);
    const now = Date.now();
    const id = await saveSequence(context.userId, data.uid, data.method || "MANUAL", [
      { step: "followup1", dueAt: now + 3 * 86400000, idempotencyKey: `${context.userId}:${data.uid}:followup1`, body: pack?.messages.find((m) => m.kind === "followup1")?.body || "", subject: email.subject || prospect.name, recipient: to, threadId },
      { step: "followup2", dueAt: now + 7 * 86400000, idempotencyKey: `${context.userId}:${data.uid}:followup2`, body: pack?.messages.find((m) => m.kind === "followup2")?.body || "", subject: email.subject || prospect.name, recipient: to, threadId },
      { step: "followup3", dueAt: now + 12 * 86400000, idempotencyKey: `${context.userId}:${data.uid}:followup3`, body: pack?.messages.find((m) => m.kind === "followup3")?.body || "", subject: email.subject || prospect.name, recipient: to, threadId },
    ]);
    await audit(context.userId, "approve_sequence", "Approved 3 follow-ups over 12 days", { prospectUid: data.uid, method: data.method || "MANUAL", sequenceId: id });
    return { ok: true as const, sequenceId: id };
  });

export const stopSequenceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string }) => data)
  .handler(async ({ data, context }) => {
    const { stopSequencesForProspect, audit } = await import("./sql.server");
    await stopSequencesForProspect(context.userId, data.uid);
    await audit(context.userId, "stop_sequence", "Stopped follow-ups", { prospectUid: data.uid });
    return { ok: true as const };
  });

export const syncRepliesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { syncRepliesForUser } = await import("./live.server");
    return syncRepliesForUser(context.userId);
  });

export const availabilityFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { accessFor } = await import("./live.server");
    const { offeredSlots, CALENDAR_UNREADABLE } = await import("../google/calendar");
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) return { ok: false as const, reason: "Calendar is not connected.", slots: [] as { start: string; end: string; label: string }[] };
    const result = await offeredSlots(tokens.access_token, { count: 3, calendarId: tokens.email });
    if (!result.ok) return { ok: false as const, reason: CALENDAR_UNREADABLE, slots: [] };
    const slots = result.slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), label: s.label }));
    return { ok: true as const, slots };
  });

export const scheduleCallFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string; start: string; end: string; method?: InputMethod }) => data)
  .handler(async ({ data, context }) => {
    const { getProspectByUid } = await import("@/lib/prospects/repo.server");
    const { accessFor } = await import("./live.server");
    const { saveCalendarEvent, audit } = await import("./sql.server");
    const { createEvent, offeredSlots, CALENDAR_UNREADABLE } = await import("../google/calendar");
    const { slotIsOffered } = await import("./booking");
    const prospect = await getProspectByUid(context.userId, data.uid);
    if (!prospect) return { ok: false as const, reason: "That company is not on your list." };
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) return { ok: false as const, reason: "Calendar needs to be reconnected. No meeting was created." };
    const start = new Date(data.start);
    const end = new Date(data.end);
    const now = new Date();
    const avail = await offeredSlots(tokens.access_token, { from: now, count: 8, calendarId: tokens.email });
    if (!avail.ok) return { ok: false as const, reason: CALENDAR_UNREADABLE };
    const check = slotIsOffered({ start, end }, avail.slots, now);
    if (!check.ok) return { ok: false as const, reason: check.reason };
    const created = await createEvent(tokens.access_token, {
      title: `Lamb Ascension / ${prospect.name}`,
      start,
      end,
      description: "Sales call. Do not claim revenue, ad spend, or $10K ability.",
    });
    if (!created.ok) return { ok: false as const, reason: created.error };
    await saveCalendarEvent(context.userId, data.uid, created.id, `Call with ${prospect.name}`, start, end);
    await audit(context.userId, "schedule_call", `Booked ${start.toISOString()}`, { prospectUid: data.uid, method: data.method || "MANUAL", providerIds: created.id });
    return { ok: true as const, eventId: created.id };
  });

export const bookingLinkFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string; origin: string }) => data)
  .handler(async ({ data, context }) => {
    const { createBookingLink } = await import("./sql.server");
    const token = await createBookingLink(context.userId, data.uid);
    return { ok: true as const, url: `${data.origin}/book/${token}` };
  });

export const timelineFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string }) => data)
  .handler(async ({ data, context }) => {
    const { timeline } = await import("./sql.server");
    return { ok: true as const, events: await timeline(context.userId, data.uid) };
  });

export const nextCallFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { nextCall } = await import("./sql.server");
    return { ok: true as const, call: await nextCall(context.userId) };
  });

export const calendarAgendaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { from: string; to: string }) => data)
  .handler(async ({ data, context }) => {
    const { accessFor } = await import("./live.server");
    const { listEvents, CALENDAR_VIEW_UNREADABLE } = await import("../google/calendar");
    const { listCallsInRange } = await import("./sql.server");
    const { getProspectByUid } = await import("@/lib/prospects/repo.server");
    const from = new Date(data.from);
    const to = new Date(data.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { ok: false as const, connected: false, reason: "That date range isn’t valid.", events: [] as AgendaEvent[] };
    }
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) {
      return {
        ok: false as const,
        connected: false,
        reason: "Calendar isn’t connected yet.",
        events: [] as AgendaEvent[],
      };
    }
    const listed = await listEvents(tokens.access_token, from, to);
    if (!listed.ok) {
      return { ok: false as const, connected: true, reason: listed.reason || CALENDAR_VIEW_UNREADABLE, events: [] as AgendaEvent[] };
    }
    const sales = await listCallsInRange(context.userId, from, to);
    const byGoogle = new Map(sales.filter((s) => s.google_event_id).map((s) => [s.google_event_id as string, s]));
    const events: AgendaEvent[] = [];
    for (const ev of listed.events) {
      const sale = byGoogle.get(ev.id);
      let companyName: string | null = null;
      if (sale?.prospect_uid) {
        const p = await getProspectByUid(context.userId, sale.prospect_uid);
        companyName = p?.name || null;
      }
      events.push({
        id: ev.id,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        status: sale ? "booked" : ev.status,
        prospectUid: sale?.prospect_uid || null,
        companyName,
        kind: sale ? "sales_call" : "google",
      });
    }
    for (const sale of sales) {
      if (sale.google_event_id && listed.events.some((e) => e.id === sale.google_event_id)) continue;
      const p = sale.prospect_uid ? await getProspectByUid(context.userId, sale.prospect_uid) : null;
      events.push({
        id: sale.id,
        title: sale.title,
        start: sale.start_at,
        end: sale.end_at,
        status: sale.status,
        prospectUid: sale.prospect_uid,
        companyName: p?.name || null,
        kind: "sales_call",
      });
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { ok: true as const, connected: true, events };
  });

export const calendarTestEventFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { action: "create" | "delete"; eventId?: string }) => data)
  .handler(async ({ data, context }) => {
    const { loadSettings } = await import("./sql.server");
    const { accessFor } = await import("./live.server");
    const { offeredSlots, createEvent, deleteEvent, listEvents } = await import("../google/calendar");
    const settings = await loadSettings(context.userId);
    if (!settings.testMode) {
      return { ok: false as const, reason: "Turn Test Mode on to create an internal Calendar test event." };
    }
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) return { ok: false as const, reason: "Calendar is not connected.", code: "CALENDAR_NOT_AUTHORIZED" as const };
    if (data.action === "delete") {
      const id = (data.eventId || "").trim();
      if (!id) return { ok: false as const, reason: "No test event to delete." };
      const gone = await deleteEvent(tokens.access_token, id);
      if (!gone.ok) return { ok: false as const, reason: gone.error, code: gone.code };
      return { ok: true as const, deleted: true as const, eventId: id };
    }
    const avail = await offeredSlots(tokens.access_token, { count: 1, calendarId: tokens.email });
    if (!avail.ok || !avail.slots[0]) {
      return { ok: false as const, reason: avail.ok ? "No verified free slot was found." : avail.reason, code: avail.ok ? "FREEBUSY_FAILED" as const : avail.code };
    }
    const slot = avail.slots[0];
    const created = await createEvent(tokens.access_token, {
      title: "LambAscensionEngine Calendar Test",
      start: slot.start,
      end: slot.end,
      description: "Internal Test Mode event. No prospect was contacted.",
    });
    if (!created.ok) return { ok: false as const, reason: created.error, code: created.code };
    const seen = await listEvents(tokens.access_token, slot.start, slot.end);
    const visible = seen.ok && seen.events.some((e) => e.id === created.id);
    return {
      ok: true as const,
      eventId: created.id,
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      visibleInEngine: visible,
    };
  });

export const createOwnerCalendarEventFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    title: string;
    when?: string;
    date?: string;
    time?: string;
    durationMinutes?: number;
    description?: string;
    location?: string;
    requestId?: string;
  }) => data)
  .handler(async ({ data, context }) => {
    const { createHash } = await import("node:crypto");
    const { loadSettings, audit } = await import("./sql.server");
    const { accessFor } = await import("./live.server");
    const { createEvent, findMatchingEvent } = await import("../google/calendar");
    const {
      resolveOwnerWhen,
      sanitizeOwnerTitle,
      parseOwnerCalendarSpeech,
      ownerEventFingerprint,
      ownerEventSuccessSpeech,
      ownerEventFailureSpeech,
      OWNER_TZ_DEFAULT,
    } = await import("../calendar/owner-event");

    const parsedSpeech = parseOwnerCalendarSpeech(
      [data.title, data.when, data.date, data.time].filter((s) => typeof s === "string" && s.trim()).join(" "),
    );
    const title = parsedSpeech.matched && parsedSpeech.title
      ? parsedSpeech.title
      : sanitizeOwnerTitle(data.title || "");
    if (!title) {
      return {
        ok: false as const,
        created: false as const,
        need: "when" as const,
        question: "What should I call that calendar event?",
        spoken: "What should I call that calendar event?",
      };
    }
    const settings = await loadSettings(context.userId);
    const timezone = settings.timezone || OWNER_TZ_DEFAULT;
    const resolved = resolveOwnerWhen({
      when: data.when || (parsedSpeech.matched ? parsedSpeech.when : undefined),
      date: data.date,
      time: data.time,
      durationMinutes: data.durationMinutes,
      timezone,
      now: new Date(),
    });
    if (!resolved.ok) {
      return {
        ok: false as const,
        created: false as const,
        need: resolved.need,
        question: resolved.question,
        spoken: resolved.question,
      };
    }

    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) {
      return {
        ok: false as const,
        created: false as const,
        reason: "Calendar isn’t connected, so nothing was added.",
        spoken: ownerEventFailureSpeech(),
        code: "CALENDAR_NOT_AUTHORIZED" as const,
      };
    }

    const fingerprint = ownerEventFingerprint({
      title,
      startIso: resolved.start.toISOString(),
      durationMinutes: resolved.durationMinutes,
    });
    const eventId = createHash("sha256").update(`${context.userId}:${fingerprint}`).digest("hex").slice(0, 32);

    const created = await createEvent(tokens.access_token, {
      title,
      start: resolved.start,
      end: resolved.end,
      description: (data.description || "").slice(0, 1000),
      location: (data.location || "").slice(0, 200) || undefined,
      timeZone: timezone,
      eventId,
      reminderMinutes: [0],
    });

    let id = created.ok ? created.id : "";
    let alreadyExisted = created.ok ? Boolean(created.alreadyExisted) : false;
    if (!created.ok) {
      const existing = await findMatchingEvent(tokens.access_token, { title, start: resolved.start });
      if (existing) {
        id = existing.id;
        alreadyExisted = true;
      } else {
        await audit(context.userId, "create_owner_calendar_event", `failed:${title}`, { method: "VOICE" });
        return {
          ok: false as const,
          created: false as const,
          reason: created.error,
          spoken: ownerEventFailureSpeech(),
          code: created.code,
        };
      }
    }

    await audit(context.userId, "create_owner_calendar_event", alreadyExisted ? `exists:${title}` : `created:${title}`, { method: "VOICE", providerIds: id });
    const spoken = ownerEventSuccessSpeech(title, resolved.whenLabel);
    return {
      ok: true as const,
      created: true as const,
      alreadyExisted,
      eventId: id,
      title,
      whenLabel: resolved.whenLabel,
      start: resolved.start.toISOString(),
      end: resolved.end.toISOString(),
      fingerprint,
      attendees: 0 as const,
      guests: 0 as const,
      prospect: false as const,
      sales: false as const,
      emailSent: false as const,
      spoken,
    };
  });

export type AgendaEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  prospectUid: string | null;
  companyName: string | null;
  kind: "sales_call" | "google";
};

export const testSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { testSettingsView } = await import("./test-flow.server");
    return testSettingsView(context.userId);
  });

export const saveTestModeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { testMode?: boolean; allowlist?: string[]; confirm?: string }) => data)
  .handler(async ({ data, context }) => {
    const { updateTestMode } = await import("./test-flow.server");
    return updateTestMode(context.userId, data);
  });

export const connectionTestFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { connectionTest } = await import("./test-flow.server");
    const result = await connectionTest(context.userId);
    return { ok: true as const, ...result };
  });

export const chooseTestRecipientFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { recipient: string }) => data)
  .handler(async ({ data, context }) => {
    const { chooseTestRecipient } = await import("./test-flow.server");
    return chooseTestRecipient(context.userId, data.recipient);
  });

export const confirmTestSendFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { confirmTestSend } = await import("./test-flow.server");
    return confirmTestSend(context.userId);
  });

export const approveTestFollowupFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { approveTestFollowup } = await import("./test-flow.server");
    return approveTestFollowup(context.userId);
  });

export const syncTestRepliesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { syncTestReplies } = await import("./test-flow.server");
    return syncTestReplies(context.userId);
  });

export const testBookingLinkFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { origin: string }) => data)
  .handler(async ({ data, context }) => {
    const { testBookingLink } = await import("./test-flow.server");
    return testBookingLink(context.userId, data.origin);
  });

export const testBookSlotFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { start: string; end: string }) => data)
  .handler(async ({ data, context }) => {
    const { testBookSlot } = await import("./test-flow.server");
    return testBookSlot(context.userId, data.start, data.end);
  });
