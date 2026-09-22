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
  .validator((data: { kind: "gmail" | "calendar"; origin: string; force?: boolean }) => data)
  .handler(async ({ data, context }) => {
    try {
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
      const { saveOauthState, googleStatus } = await import("./sql.server");
      const accounts = await googleStatus(context.userId);
      if (data.kind === "calendar" && accounts.calendar === "connected" && !data.force) {
        return {
          ok: true as const,
          alreadyConnected: true as const,
          url: "",
          reason: "Google Calendar is already connected. The existing connection was not changed.",
          missing,
          next: "Use Reconnect only if Calendar actually needs a new Google sign-in.",
        };
      }
      if (data.kind === "calendar" && data.force) {
        const { accessFor } = await import("./live.server");
        const { probeCalendarApiEnabled } = await import("../google/calendar");
        const { CALENDAR_API_DISABLED_MESSAGE } = await import("../google/calendar-errors");
        try {
          const gmailTokens = await accessFor(context.userId, "gmail");
          if (gmailTokens) {
            const api = await Promise.race([
              probeCalendarApiEnabled(gmailTokens.access_token),
              new Promise<{ enabled: "unknown"; code: null; reason: string }>((resolve) => {
                setTimeout(() => resolve({ enabled: "unknown", code: null, reason: "" }), 2500);
              }),
            ]);
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
        } catch {
          /* probe is advisory — still mint an OAuth URL */
        }
      }
      const rec = await saveOauthState(context.userId, data.kind);
      const loginHint = data.kind === "calendar" ? (accounts.gmailEmail || undefined) : undefined;
      const url = authorizeUrl({ state: rec.state, kind: data.kind, requestUrl: data.origin, loginHint });
      return { ok: true as const, url, missing };
    } catch {
      return {
        ok: false as const,
        reason: data.kind === "calendar"
          ? "Could not start Google Calendar sign-in. The existing Calendar connection was not changed."
          : "Could not start Google sign-in. Nothing was connected.",
        missing: [],
        next: data.kind === "calendar"
          ? "The stored Calendar connection was left as-is. Try Reconnect only if Calendar still cannot be read."
          : "Try Connect Gmail again. We will not ask for your Gmail password.",
      };
    }
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
    const { persistConfirmedBooking } = await import("./booking-confirm.server");
    const { audit } = await import("./sql.server");
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
    const persisted = await persistConfirmedBooking({
      userId: context.userId,
      prospectUid: data.uid,
      googleEventId: created.id,
      title: `Call with ${prospect.name}`,
      start,
      end,
      method: data.method === "AUTOMATION" ? "AUTOMATION" : "MANUAL",
    });
    if (!persisted.ok) {
      await audit(context.userId, "schedule_call", `persist_failed:${created.id}`, { prospectUid: data.uid, method: data.method || "MANUAL", providerIds: created.id });
      return { ok: false as const, reason: persisted.reason, eventId: created.id };
    }
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

export const prospectUpcomingCallFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string }) => data)
  .handler(async ({ data, context }) => {
    const { upcomingCallForProspect } = await import("./sql.server");
    const row = await upcomingCallForProspect(context.userId, data.uid);
    if (!row) return { ok: true as const, call: null };
    const start = new Date(row.start_at);
    const y = start.toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric" });
    const m = start.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "2-digit" });
    const d = start.toLocaleDateString("en-US", { timeZone: "America/Chicago", day: "2-digit" });
    const googleUrl = Number.isFinite(start.getTime())
      ? `https://calendar.google.com/calendar/u/0/r/day/${y}/${m}/${d}`
      : "https://calendar.google.com";
    return {
      ok: true as const,
      call: {
        googleEventId: row.google_event_id,
        prospectUid: row.prospect_uid,
        title: row.title,
        start: row.start_at,
        end: row.end_at,
        status: row.status,
        googleUrl,
      },
    };
  });

async function loadCalendarEventsForOwner(
  userId: string,
  from: Date,
  to: Date,
): Promise<
  | { ok: true; events: import("../google/calendar").GoogleCalEvent[]; connected: true; calendarId: string }
  | { ok: false; connected: boolean; reason: string; code: string; events: [] }
> {
  const { accessFor } = await import("./live.server");
  const { refreshAccess } = await import("../google/oauth");
  const { saveGoogleAccount, loadSettings } = await import("./sql.server");
  const { listEvents, calendarListUserReason } = await import("../google/calendar");
  const { expandRangeToOwnerDays, OWNER_TZ_DEFAULT } = await import("../calendar/owner-event");

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    return { ok: false, connected: true, reason: calendarListUserReason("CALENDAR_LIST_BAD_RANGE"), code: "CALENDAR_LIST_BAD_RANGE", events: [] };
  }
  const settings = await loadSettings(userId);
  const timezone = settings.timezone || OWNER_TZ_DEFAULT;
  const covered = expandRangeToOwnerDays(from, to, timezone);
  if (covered.from.getTime() >= covered.to.getTime()) {
    return { ok: false, connected: true, reason: calendarListUserReason("CALENDAR_LIST_BAD_RANGE"), code: "CALENDAR_LIST_BAD_RANGE", events: [] };
  }

  let tokens = await accessFor(userId, "calendar");
  if (!tokens) {
    return { ok: false, connected: false, reason: calendarListUserReason("CALENDAR_TOKEN_MISSING"), code: "CALENDAR_TOKEN_MISSING", events: [] };
  }

  const run = (tok: NonNullable<typeof tokens>) => listEvents(tok.access_token, covered.from, covered.to, fetch, tok.email);
  let listed = await run(tokens);
  if (!listed.ok && listed.code === "CALENDAR_LIST_AUTH_FAILED" && tokens.refresh_token) {
    try {
      const next = await refreshAccess(tokens.refresh_token);
      next.refresh_token = tokens.refresh_token;
      next.email = tokens.email;
      next.sub = tokens.sub;
      await saveGoogleAccount(userId, "calendar", next);
      tokens = next;
      listed = await run(tokens);
    } catch {
      return { ok: false, connected: true, reason: calendarListUserReason("CALENDAR_TOKEN_REFRESH_FAILED"), code: "CALENDAR_TOKEN_REFRESH_FAILED", events: [] };
    }
  }
  if (!listed.ok) {
    console.info("[calendar-list]", {
      code: listed.code,
      httpStatus: listed.httpStatus,
      googleReason: listed.googleReason,
      calendarId: listed.calendarId,
    });
    return { ok: false, connected: true, reason: listed.reason, code: listed.code, events: [] };
  }
  return { ok: true, events: listed.events, connected: true, calendarId: listed.calendarId };
}

export const calendarAgendaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { from: string; to: string }) => data)
  .handler(async ({ data, context }) => {
    const { asIsoTimestamp, compareEventStart, calendarListUserReason } = await import("../google/calendar");
    const events: AgendaEvent[] = [];
    try {
      const { listCallsInRange } = await import("./sql.server");
      const { getProspectByUid } = await import("@/lib/prospects/repo.server");
      const from = new Date(data.from);
      const to = new Date(data.to);
      const listed = await loadCalendarEventsForOwner(context.userId, from, to);
      if (!listed.ok) {
        return { ok: false as const, connected: listed.connected, reason: listed.reason, code: listed.code, events: [] as AgendaEvent[] };
      }
      let sales: Awaited<ReturnType<typeof listCallsInRange>> = [];
      try {
        sales = await listCallsInRange(context.userId, from, to);
      } catch {
        sales = [];
      }
      const byGoogle = new Map(sales.filter((s) => s.google_event_id).map((s) => [s.google_event_id as string, s]));
      for (const ev of listed.events) {
        try {
          const sale = byGoogle.get(ev.id);
          let companyName: string | null = null;
          if (sale?.prospect_uid) {
            try {
              const p = await getProspectByUid(context.userId, sale.prospect_uid);
              companyName = p?.name || null;
            } catch {
              companyName = null;
            }
          }
          const start = asIsoTimestamp(ev.start) || String(ev.start || "");
          if (!start) continue;
          events.push({
            id: ev.id,
            title: ev.title,
            start,
            end: asIsoTimestamp(ev.end) || String(ev.end || ev.start || "") || start,
            status: sale ? "booked" : ev.status,
            prospectUid: sale?.prospect_uid || null,
            companyName,
            kind: sale ? "sales_call" : "google",
            htmlLink: ev.htmlLink || null,
          });
        } catch {
          console.info("[calendar-list]", { skipped: true, id: typeof ev?.id === "string" ? ev.id : "unknown" });
        }
      }
      for (const sale of sales) {
        try {
          if (sale.google_event_id && listed.events.some((e) => e.id === sale.google_event_id)) continue;
          let companyName: string | null = null;
          try {
            const p = sale.prospect_uid ? await getProspectByUid(context.userId, sale.prospect_uid) : null;
            companyName = p?.name || null;
          } catch {
            companyName = null;
          }
          const start = asIsoTimestamp(sale.start_at);
          const end = asIsoTimestamp(sale.end_at) || start;
          if (!start) continue;
          events.push({
            id: sale.id,
            title: sale.title,
            start,
            end,
            status: sale.status,
            prospectUid: sale.prospect_uid,
            companyName,
            kind: "sales_call",
            htmlLink: null,
          });
        } catch {
          console.info("[calendar-list]", { skipped: true, sale: true });
        }
      }
      events.sort(compareEventStart);
      return { ok: true as const, connected: true, events };
    } catch (err) {
      console.info("[calendar-list]", { code: "CALENDAR_LIST_PARSE_FAILED", err: err instanceof Error ? err.name : "error", kept: events.length });
      if (events.length) {
        try { events.sort(compareEventStart); } catch { /* keep insertion order */ }
        return { ok: true as const, connected: true, events };
      }
      return {
        ok: false as const,
        connected: true,
        reason: calendarListUserReason("CALENDAR_LIST_PARSE_FAILED"),
        code: "CALENDAR_LIST_PARSE_FAILED",
        events: [] as AgendaEvent[],
      };
    }
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
    origin?: string;
  }) => data)
  .handler(async ({ data, context }) => {
    const { createHash } = await import("node:crypto");
    const { loadSettings, audit } = await import("./sql.server");
    const { accessFor } = await import("./live.server");
    const { createEvent, findMatchingEvent } = await import("../google/calendar");
    const { listProspects } = await import("@/lib/prospects/repo.server");
    const { matchProspectsBySpokenName } = await import("@/lib/prospects/dedupe");
    const { prospectProfileUrl } = await import("@/lib/prospects/ids");
    const { persistConfirmedBooking } = await import("./booking-confirm.server");
    const {
      resolveOwnerWhen,
      sanitizeOwnerTitle,
      parseOwnerCalendarSpeech,
      ownerEventFingerprint,
      ownerEventSuccessSpeech,
      ownerEventFailureSpeech,
      ownerGenericNameQuestion,
      ownerLinkedCallSpeech,
      ownerUnlinkedCallSpeech,
      ownerAmbiguousProspectSpeech,
      isGenericOwnerTitle,
      OWNER_TZ_DEFAULT,
    } = await import("../calendar/owner-event");

    const parsedSpeech = parseOwnerCalendarSpeech(
      [data.title, data.when, data.date, data.time].filter((s) => typeof s === "string" && s.trim()).join(" "),
    );
    const incoming = sanitizeOwnerTitle(data.title || "");
    const parsedTitle = parsedSpeech.matched ? parsedSpeech.title : "";
    const title = !isGenericOwnerTitle(incoming)
      ? incoming
      : (parsedTitle && !isGenericOwnerTitle(parsedTitle) ? parsedTitle : (parsedTitle || incoming));
    const whenBlob = data.when || (parsedSpeech.matched ? parsedSpeech.when : undefined);

    if (isGenericOwnerTitle(title)) {
      const question = ownerGenericNameQuestion(title || "call");
      return {
        ok: false as const,
        created: false as const,
        need: "name" as const,
        question,
        spoken: question,
        title: title || "Call",
        when: whenBlob || "",
      };
    }
    if (!title) {
      return {
        ok: false as const,
        created: false as const,
        need: "name" as const,
        question: "What should I name the call?",
        spoken: "What should I name the call?",
      };
    }
    const settings = await loadSettings(context.userId);
    const timezone = settings.timezone || OWNER_TZ_DEFAULT;
    const resolved = resolveOwnerWhen({
      when: whenBlob,
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
        title,
        when: whenBlob || "",
      };
    }

    const prospects = await listProspects(context.userId);
    const hits = matchProspectsBySpokenName(
      prospects.map((p) => ({
        uid: p.uid || "",
        name: p.name,
        city: p.city,
        provider_place_id: p.provider_place_id,
      })),
      title,
    ).filter((h) => h.uid);
    if (hits.length > 1) {
      const spoken = ownerAmbiguousProspectSpeech(hits.map((h) => ({ name: h.name, city: h.city })));
      return {
        ok: false as const,
        created: false as const,
        need: "which" as const,
        question: spoken,
        spoken,
        title,
        when: whenBlob || "",
        matches: hits.map((h) => ({ uid: h.uid, name: h.name, city: h.city || "" })),
      };
    }
    const linked = hits.length === 1 ? prospects.find((p) => p.uid === hits[0].uid) : null;
    const origin = safeAppOrigin(data.origin);
    const profileUrl = linked?.uid ? prospectProfileUrl(origin, linked.uid) : "";
    const eventTitle = linked ? linked.name : title;
    const eventDescription = linked
      ? prospectCallDescription(linked, profileUrl)
      : (data.description || "").slice(0, 1000);

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
      title: eventTitle,
      startIso: resolved.start.toISOString(),
      durationMinutes: resolved.durationMinutes,
    });
    const eventId = createHash("sha256").update(`${context.userId}:${fingerprint}`).digest("hex").slice(0, 32);

    const created = await createEvent(tokens.access_token, {
      title: eventTitle,
      start: resolved.start,
      end: resolved.end,
      description: eventDescription,
      location: (data.location || "").slice(0, 200) || undefined,
      timeZone: timezone,
      eventId,
      reminderMinutes: [0],
    });

    let id = created.ok ? created.id : "";
    let alreadyExisted = created.ok ? Boolean(created.alreadyExisted) : false;
    if (!created.ok) {
      const existing = await findMatchingEvent(tokens.access_token, { title: eventTitle, start: resolved.start });
      if (existing) {
        id = existing.id;
        alreadyExisted = true;
      } else {
        await audit(context.userId, "create_owner_calendar_event", `failed:${eventTitle}`, { method: "VOICE" });
        return {
          ok: false as const,
          created: false as const,
          reason: created.error,
          spoken: ownerEventFailureSpeech(),
          code: created.code,
        };
      }
    }

    let sales = false;
    if (linked?.uid) {
      const persisted = await persistConfirmedBooking({
        userId: context.userId,
        prospectUid: linked.uid,
        googleEventId: id,
        title: eventTitle,
        start: resolved.start,
        end: resolved.end,
        method: "MANUAL",
      });
      if (!persisted.ok) {
        await audit(context.userId, "create_owner_calendar_event", `link_failed:${eventTitle}`, {
          method: "VOICE",
          providerIds: id,
          prospectUid: linked.uid,
        });
        return {
          ok: false as const,
          created: false as const,
          reason: persisted.reason,
          spoken: "The Calendar event was created, but I couldn't link it to the prospect. No second event was created.",
          eventId: id,
          title: eventTitle,
        };
      }
      sales = true;
    }

    await audit(context.userId, "create_owner_calendar_event", alreadyExisted ? `exists:${eventTitle}` : `created:${eventTitle}`, {
      method: "VOICE",
      providerIds: id,
      prospectUid: linked?.uid,
    });
    const spoken = linked
      ? ownerLinkedCallSpeech(eventTitle, resolved.whenLabel)
      : (isCallLikeTitle(title)
        ? ownerUnlinkedCallSpeech(eventTitle, resolved.whenLabel)
        : ownerEventSuccessSpeech(eventTitle, resolved.whenLabel));
    return {
      ok: true as const,
      created: true as const,
      alreadyExisted,
      eventId: id,
      title: eventTitle,
      whenLabel: resolved.whenLabel,
      start: resolved.start.toISOString(),
      end: resolved.end.toISOString(),
      fingerprint,
      attendees: 0 as const,
      guests: 0 as const,
      prospect: Boolean(linked),
      prospectUid: linked?.uid || null,
      profileUrl: profileUrl || null,
      sales,
      emailSent: false as const,
      spoken,
    };
  });

function safeAppOrigin(candidate?: string): string {
  const prod = "https://lamb-ascension-engine.vercel.app";
  const raw = (candidate || "").trim().replace(/\/$/, "");
  if (raw === prod) return raw;
  if (/^https:\/\/lamb-ascension-engine(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(raw)) return raw;
  const vercel = process.env.VERCEL_URL?.replace(/^https?:\/\//, "").trim();
  if (vercel) return `https://${vercel}`;
  return prod;
}

function isCallLikeTitle(title: string): boolean {
  return /\b(call|meeting)\b/i.test(title);
}

function prospectCallDescription(
  prospect: { name: string; phone?: string; contacts?: { name?: string; title?: string; email?: string }[] },
  profileUrl: string,
): string {
  const named = (prospect.contacts || []).find((c) => c.name && c.name !== "UNKNOWN");
  const phone = prospect.phone && prospect.phone !== "UNKNOWN" ? prospect.phone : "";
  const lines = [
    prospect.name,
    "Lamb Ascension prospect call",
    "",
    "Open prospect in LambAscensionEngine:",
    profileUrl,
  ];
  if (named?.name) {
    lines.push("", `Contact: ${named.name}${named.title && named.title !== "UNKNOWN" ? ` — ${named.title}` : ""}`);
  }
  if (named?.email) lines.push(`Email: ${named.email}`);
  if (phone) lines.push(`Phone: ${phone}`);
  return lines.join("\n").slice(0, 1000);
}

type OwnerManageInput = {
  eventId?: string;
  title?: string;
  when?: string;
  lastEvent?: boolean;
  lastEventId?: string;
  confirm?: boolean;
  newTime?: string;
  newTitle?: string;
};

export const listOwnerCalendarEventsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: OwnerManageInput) => data)
  .handler(async ({ data, context }) => {
    const { loadSettings, audit, listCallsInRange } = await import("./sql.server");
    const {
      resolveOwnerWindow,
      ownerListSpeech,
      pickCalendarMatches,
      formatEventWhen,
      OWNER_TZ_DEFAULT,
    } = await import("../calendar/owner-event");

    const settings = await loadSettings(context.userId);
    const timezone = settings.timezone || OWNER_TZ_DEFAULT;
    const now = new Date();
    const named = (data.title || "").trim();
    const win = named && !data.when
      ? { ok: true as const, from: now, to: new Date(now.getTime() + 14 * 86400000), label: "the next two weeks", hasClock: false as const }
      : resolveOwnerWindow({ when: data.when, timezone, now });
    const window = win.ok ? win : { from: now, to: new Date(now.getTime() + 24 * 3600 * 1000), label: "today", hasClock: false };
    const listed = await loadCalendarEventsForOwner(context.userId, window.from, window.to);
    if (!listed.ok) {
      return {
        ok: false as const,
        listed: false as const,
        reason: listed.reason,
        code: listed.code,
        spoken: listed.reason,
        events: [] as { id: string; title: string; start: string; end: string; attendees: number; sales: boolean }[],
      };
    }
    const salesRows = await listCallsInRange(context.userId, window.from, window.to);
    const byGoogle = new Map(salesRows.filter((s) => s.google_event_id).map((s) => [s.google_event_id as string, s]));
    const events = listed.events.map((ev) => ({
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      attendees: ev.attendees,
      sales: Boolean(byGoogle.get(ev.id)),
    }));
    const focused = named ? pickCalendarMatches(events, { title: named }) : { matches: events, ambiguous: false };
    const shown = named ? focused.matches : events;
    let spoken = ownerListSpeech(shown, window.label, timezone, now);
    if (named && shown.length === 1) {
      spoken = `Your ‘${shown[0].title}’ call is ${formatEventWhen(shown[0].start, timezone, now)}.`;
    } else if (named && !shown.length) {
      spoken = `I don't see a ‘${named}’ call on your calendar in the next two weeks.`;
    }
    await audit(context.userId, "list_owner_calendar_events", `${window.label}:${shown.length}`, { method: "VOICE" });
    return {
      ok: true as const,
      listed: true as const,
      label: window.label,
      timezone,
      spoken,
      events: shown,
    };
  });

export const deleteOwnerCalendarEventFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: OwnerManageInput) => data)
  .handler(async ({ data, context }) => {
    const { loadSettings, audit, findBookedByGoogleEventId, cancelBookedCalendarEvent } = await import("./sql.server");
    const { accessFor } = await import("./live.server");
    const { listEvents, getEvent, deleteEvent } = await import("../google/calendar");
    const {
      ownerDeleteSuccessSpeech,
      ownerSalesDeleteConfirmSpeech,
      ownerGuestDeleteConfirmSpeech,
      ownerAlreadyGoneSpeech,
      OWNER_TZ_DEFAULT,
    } = await import("../calendar/owner-event");

    const settings = await loadSettings(context.userId);
    const timezone = settings.timezone || OWNER_TZ_DEFAULT;
    const now = new Date();
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) {
      return {
        ok: false as const,
        deleted: false as const,
        spoken: "Calendar isn’t connected, so nothing was deleted.",
      };
    }

    const located = await locateOwnerEvent({
      accessToken: tokens.access_token,
      userId: context.userId,
      timezone,
      now,
      eventId: data.eventId,
      lastEventId: data.lastEventId,
      lastEvent: data.lastEvent,
      title: data.title,
      when: data.when,
      calendarId: tokens.email,
      listEvents,
      getEvent,
      findBookedByGoogleEventId,
    });
    if (!located.ok) {
      return {
        ok: false as const,
        deleted: false as const,
        ambiguous: located.kind === "ambiguous",
        spoken: located.spoken,
        matches: located.events || [],
      };
    }

    const sale = located.sales;
    const needsConfirm = Boolean((sale && sale.status === "booked") || located.event.attendees > 0);
    if (needsConfirm && !data.confirm) {
      const spoken = sale && sale.status === "booked"
        ? ownerSalesDeleteConfirmSpeech(located.event.title, located.event.attendees)
        : ownerGuestDeleteConfirmSpeech(located.event.title);
      return {
        ok: false as const,
        deleted: false as const,
        needsConfirm: true as const,
        eventId: located.event.id,
        title: located.event.title,
        sales: Boolean(sale && sale.status === "booked"),
        attendees: located.event.attendees,
        spoken,
      };
    }

    const gone = await deleteEvent(tokens.access_token, located.event.id);
    if (!gone.ok) {
      await audit(context.userId, "delete_owner_calendar_event", `failed:${located.event.title}`, { method: "VOICE", providerIds: located.event.id });
      return {
        ok: false as const,
        deleted: false as const,
        spoken: "I couldn't update that event, so nothing changed.",
        reason: gone.error,
      };
    }
    if (sale && sale.status === "booked") {
      await cancelBookedCalendarEvent(context.userId, located.event.id);
    }
    await audit(context.userId, "delete_owner_calendar_event", gone.alreadyGone ? `gone:${located.event.title}` : `deleted:${located.event.title}`, {
      method: "VOICE",
      providerIds: located.event.id,
    });
    return {
      ok: true as const,
      deleted: true as const,
      alreadyGone: Boolean(gone.alreadyGone),
      eventId: located.event.id,
      title: located.event.title,
      sales: Boolean(sale && sale.status === "booked"),
      spoken: gone.alreadyGone ? ownerAlreadyGoneSpeech() : ownerDeleteSuccessSpeech(located.event.title),
    };
  });

type BulkDeleteInput = {
  when?: string;
  horizon?: "unspecified" | "future" | "range" | "all";
  filter?: "all" | "personal" | "sales" | "test";
  confirm?: boolean;
  bulkActionId?: string;
  eventIds?: string[];
  completedIds?: string[];
};

export const deleteOwnerCalendarEventsBulkFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: BulkDeleteInput) => data)
  .handler(async ({ data, context }) => {
    const { loadSettings, audit, findBookedByGoogleEventId, cancelBookedCalendarEvent, listCallsInRange } = await import("./sql.server");
    const { accessFor } = await import("./live.server");
    const { listEvents, deleteEvent, asIsoTimestamp } = await import("../google/calendar");
    const {
      resolveBulkOwnerWindow,
      filterBulkEvents,
      ownerBulkConfirmSpeech,
      ownerBulkSuccessSpeech,
      ownerBulkScopeQuestion,
      OWNER_TZ_DEFAULT,
    } = await import("../calendar/owner-event");
    const { createHash } = await import("node:crypto");

    const settings = await loadSettings(context.userId);
    const timezone = settings.timezone || OWNER_TZ_DEFAULT;
    const now = new Date();
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) {
      return {
        ok: false as const,
        deleted: false as const,
        spoken: "Calendar isn’t connected, so nothing was deleted.",
        terminal: "FAILED" as const,
      };
    }

    const horizon = data.horizon || "unspecified";
    const filter = data.filter || "all";
    if (horizon === "unspecified" && !data.confirm && !(data.eventIds && data.eventIds.length)) {
      return {
        ok: false as const,
        deleted: false as const,
        needsScope: true as const,
        spoken: ownerBulkScopeQuestion(),
        terminal: "NEEDS_CLARIFICATION" as const,
        filter,
      };
    }

    const window = resolveBulkOwnerWindow({ when: data.when, horizon, timezone, now });
    const listed = await listEvents(tokens.access_token, window.from, window.to, fetch, tokens.email);
    if (!listed.ok) {
      return {
        ok: false as const,
        deleted: false as const,
        spoken: listed.reason,
        code: listed.code,
        terminal: "FAILED" as const,
      };
    }

    let salesRows: Awaited<ReturnType<typeof listCallsInRange>> = [];
    try {
      salesRows = await listCallsInRange(context.userId, window.from, window.to);
    } catch {
      salesRows = [];
    }
    const salesIds = new Set(salesRows.filter((s) => s.google_event_id && s.status === "booked").map((s) => s.google_event_id as string));
    const tagged = listed.events.map((ev) => ({
      ...ev,
      start: asIsoTimestamp(ev.start) || ev.start,
      end: asIsoTimestamp(ev.end) || ev.end,
      sales: salesIds.has(ev.id),
    }));
    const filtered = filterBulkEvents(tagged, filter);
    const requested = (data.eventIds || []).map((id) => String(id).trim()).filter(Boolean);
    const targets = requested.length
      ? filtered.filter((e) => requested.includes(e.id))
      : filtered;
    const guestCount = targets.filter((e) => e.attendees > 0).length;
    const salesCount = targets.filter((e) => e.sales).length;
    const ids = targets.map((e) => e.id);
    const bulkActionId = data.bulkActionId || createHash("sha256").update(`bulk:${context.userId}:${ids.slice().sort().join(",")}`).digest("hex").slice(0, 24);

    if (!data.confirm) {
      const spoken = ownerBulkConfirmSpeech({
        count: targets.length,
        sales: salesCount,
        guests: guestCount,
        label: window.label,
      });
      return {
        ok: false as const,
        deleted: false as const,
        needsConfirm: true as const,
        bulkActionId,
        eventIds: ids,
        count: targets.length,
        sales: salesCount,
        guests: guestCount,
        label: window.label,
        spoken,
        terminal: "NEEDS_CONFIRMATION" as const,
      };
    }

    const done = new Set((data.completedIds || []).map((id) => String(id)));
    let deleted = 0;
    let skipped = 0;
    const completed: string[] = [...done];
    for (const event of targets) {
      if (done.has(event.id)) {
        skipped += 1;
        continue;
      }
      const gone = await deleteEvent(tokens.access_token, event.id);
      if (!gone.ok) continue;
      if (gone.alreadyGone) skipped += 1;
      else deleted += 1;
      done.add(event.id);
      completed.push(event.id);
      if (event.sales) {
        try {
          const row = await findBookedByGoogleEventId(context.userId, event.id);
          if (row && row.status === "booked") await cancelBookedCalendarEvent(context.userId, event.id);
        } catch {
          /* keep deleting remaining events */
        }
      }
    }
    await audit(context.userId, "delete_owner_calendar_events_bulk", `${bulkActionId}:${deleted}:${skipped}`, {
      method: "VOICE",
      providerIds: completed.slice(-20).join(","),
    });
    return {
      ok: true as const,
      deleted: true as const,
      bulkActionId,
      eventIds: ids,
      completedIds: completed,
      deletedCount: deleted,
      skippedCount: skipped,
      sales: salesCount,
      spoken: ownerBulkSuccessSpeech(deleted, skipped),
      terminal: "SUCCESS" as const,
    };
  });

export const updateOwnerCalendarEventFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: OwnerManageInput) => data)
  .handler(async ({ data, context }) => {
    const { loadSettings, audit, findBookedByGoogleEventId, updateBookedCalendarTimes } = await import("./sql.server");
    const { accessFor } = await import("./live.server");
    const { listEvents, getEvent, patchEvent } = await import("../google/calendar");
    const {
      resolveOwnerWhen,
      formatOwnerWhen,
      ownerUpdateSuccessSpeech,
      ownerUpdateFailureSpeech,
      ownerSalesUpdateConfirmSpeech,
      OWNER_TZ_DEFAULT,
    } = await import("../calendar/owner-event");

    const settings = await loadSettings(context.userId);
    const timezone = settings.timezone || OWNER_TZ_DEFAULT;
    const now = new Date();
    const tokens = await accessFor(context.userId, "calendar");
    if (!tokens) {
      return {
        ok: false as const,
        updated: false as const,
        spoken: ownerUpdateFailureSpeech(),
      };
    }

    const located = await locateOwnerEvent({
      accessToken: tokens.access_token,
      userId: context.userId,
      timezone,
      now,
      eventId: data.eventId,
      lastEventId: data.lastEventId,
      lastEvent: data.lastEvent,
      title: data.title,
      when: data.when,
      calendarId: tokens.email,
      listEvents,
      getEvent,
      findBookedByGoogleEventId,
    });
    if (!located.ok) {
      return {
        ok: false as const,
        updated: false as const,
        ambiguous: located.kind === "ambiguous",
        spoken: located.kind === "ambiguous"
          ? located.spoken.replace("Which should I delete?", "Which should I change?")
          : "I couldn't find a matching event, so nothing changed.",
        matches: located.events || [],
      };
    }

    const sale = located.sales;
    const needsConfirm = Boolean(sale && sale.status === "booked");
    if (needsConfirm && !data.confirm) {
      return {
        ok: false as const,
        updated: false as const,
        needsConfirm: true as const,
        eventId: located.event.id,
        title: located.event.title,
        sales: true as const,
        spoken: ownerSalesUpdateConfirmSpeech(located.event.title),
      };
    }

    const patch: { title?: string; start?: Date; end?: Date; timeZone?: string } = {};
    const newTitle = (data.newTitle || "").trim();
    if (newTitle) patch.title = newTitle.slice(0, 200);
    if (data.newTime) {
      const currentStart = new Date(located.event.start);
      const currentEnd = new Date(located.event.end);
      const durationMs = Number.isFinite(currentEnd.getTime()) && Number.isFinite(currentStart.getTime())
        ? Math.max(5 * 60 * 1000, currentEnd.getTime() - currentStart.getTime())
        : 30 * 60 * 1000;
      const resolved = resolveOwnerWhen({
        when: data.when,
        time: data.newTime,
        timezone,
        now,
      });
      if (!resolved.ok) {
        return {
          ok: false as const,
          updated: false as const,
          spoken: resolved.question,
          need: resolved.need,
        };
      }
      patch.start = resolved.start;
      patch.end = new Date(resolved.start.getTime() + durationMs);
      patch.timeZone = timezone;
    }
    if (!patch.title && !patch.start) {
      return {
        ok: false as const,
        updated: false as const,
        spoken: "What should I change — the time or the name?",
      };
    }

    const patched = await patchEvent(tokens.access_token, located.event.id, patch);
    if (!patched.ok) {
      await audit(context.userId, "update_owner_calendar_event", `failed:${located.event.title}`, { method: "VOICE", providerIds: located.event.id });
      return {
        ok: false as const,
        updated: false as const,
        spoken: ownerUpdateFailureSpeech(),
        reason: patched.error,
      };
    }
    if (sale && sale.status === "booked" && patch.start && patch.end) {
      await updateBookedCalendarTimes(context.userId, located.event.id, patch.start, patch.end);
    }
    const whenLabel = formatOwnerWhen(new Date(patched.event.start), timezone, now);
    await audit(context.userId, "update_owner_calendar_event", `updated:${patched.event.title}`, { method: "VOICE", providerIds: patched.event.id });
    return {
      ok: true as const,
      updated: true as const,
      eventId: patched.event.id,
      title: patched.event.title,
      whenLabel,
      start: patched.event.start,
      end: patched.event.end,
      sales: Boolean(sale && sale.status === "booked"),
      spoken: ownerUpdateSuccessSpeech(patched.event.title, whenLabel),
    };
  });

async function locateOwnerEvent(opts: {
  accessToken: string;
  userId: string;
  timezone: string;
  now: Date;
  eventId?: string;
  lastEventId?: string;
  lastEvent?: boolean;
  title?: string;
  when?: string;
  calendarId?: string;
  listEvents: typeof import("../google/calendar").listEvents;
  getEvent: typeof import("../google/calendar").getEvent;
  findBookedByGoogleEventId: typeof import("./sql.server").findBookedByGoogleEventId;
}): Promise<
  | { ok: true; event: import("../google/calendar").GoogleCalEvent; sales: import("./sql.server").BookedCalendarRow | null }
  | { ok: false; kind: "missing" | "ambiguous" | "unread"; spoken: string; events?: { id: string; title: string; start: string }[] }
> {
  const {
    pickCalendarMatches,
    resolveOwnerWindow,
    ownerDeleteMissingSpeech,
    ownerAmbiguousSpeech,
    ownerAlreadyGoneSpeech,
  } = await import("../calendar/owner-event");
  const { CALENDAR_VIEW_UNREADABLE } = await import("../google/calendar");

  const directId = (opts.eventId || (opts.lastEvent && !opts.title ? opts.lastEventId : "") || "").trim();
  if (directId) {
    const got = await opts.getEvent(opts.accessToken, directId);
    if (!got.ok) {
      return { ok: false, kind: "missing", spoken: got.missing ? ownerAlreadyGoneSpeech() : (got.reason || ownerDeleteMissingSpeech()) };
    }
    const sales = await opts.findBookedByGoogleEventId(opts.userId, got.event.id);
    return { ok: true, event: got.event, sales };
  }

  const hasTitle = Boolean((opts.title || "").trim());
  const win = resolveOwnerWindow({ when: opts.when, timezone: opts.timezone, now: opts.now });
  const window = win.ok && (opts.when || !hasTitle)
    ? win
    : {
      from: new Date(opts.now.getTime() - 24 * 3600 * 1000),
      to: new Date(opts.now.getTime() + 14 * 86400000),
      label: "the next two weeks",
      hasClock: false as const,
      start: undefined as Date | undefined,
    };
  const listed = await opts.listEvents(opts.accessToken, window.from, window.to, fetch, opts.calendarId);
  if (!listed.ok) {
    return { ok: false, kind: "unread", spoken: listed.reason || CALENDAR_VIEW_UNREADABLE };
  }
  if (opts.lastEvent && opts.lastEventId) {
    const last = listed.events.find((e) => e.id === opts.lastEventId);
    if (last) {
      const sales = await opts.findBookedByGoogleEventId(opts.userId, last.id);
      return { ok: true, event: last, sales };
    }
    const got = await opts.getEvent(opts.accessToken, opts.lastEventId);
    if (got.ok) {
      const sales = await opts.findBookedByGoogleEventId(opts.userId, got.event.id);
      return { ok: true, event: got.event, sales };
    }
  }
  const picked = pickCalendarMatches(listed.events, {
    title: opts.title,
    startMs: "start" in window && window.start ? window.start.getTime() : undefined,
    windowMs: window.hasClock ? 90 * 60 * 1000 : undefined,
  });
  if (!picked.matches.length) {
    return { ok: false, kind: "missing", spoken: ownerDeleteMissingSpeech() };
  }
  if (picked.ambiguous) {
    return {
      ok: false,
      kind: "ambiguous",
      spoken: ownerAmbiguousSpeech(picked.matches, opts.timezone, opts.now, "delete"),
      events: picked.matches.map((e) => ({ id: e.id, title: e.title, start: e.start })),
    };
  }
  const event = picked.matches[0];
  const sales = await opts.findBookedByGoogleEventId(opts.userId, event.id);
  return { ok: true, event, sales };
}

export type AgendaEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  prospectUid: string | null;
  companyName: string | null;
  kind: "sales_call" | "google";
  htmlLink?: string | null;
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

export const resetTestFlowFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { confirm?: boolean }) => data)
  .handler(async ({ data, context }) => {
    if (data.confirm !== true) {
      return { ok: false as const, reason: "Confirmation required. Nothing was changed." };
    }
    const { resetTestFlow } = await import("./test-flow.server");
    return resetTestFlow(context.userId);
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
