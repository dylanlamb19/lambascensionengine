import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/book/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getBookingLink } = await import("@/lib/mail/sql.server");
        const { accessFor } = await import("@/lib/mail/live.server");
        const link = await getBookingLink(params.token);
        if (!link || link.status !== "open") {
          return Response.json({ ok: false, reason: "This booking link is not valid." });
        }
        if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
          return Response.json({ ok: false, reason: "This booking link has expired." });
        }
        const tokens = await accessFor(link.user_id, "calendar");
        if (!tokens) return Response.json({ ok: false, reason: "Calendar is not connected for this owner." });
        const { offeredSlots, CALENDAR_UNREADABLE } = await import("@/lib/google/calendar");
        const avail = await offeredSlots(tokens.access_token, { count: 3, calendarId: tokens.email });
        if (!avail.ok) return Response.json({ ok: false, reason: CALENDAR_UNREADABLE, slots: [] });
        const slots = avail.slots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          label: s.label,
        }));
        return Response.json({ ok: true, slots });
      },
      POST: async ({ params, request }) => {
        const { getBookingLink, claimBookingLink, finishBookingLink } = await import("@/lib/mail/sql.server");
        const { accessFor } = await import("@/lib/mail/live.server");
        const { getProspectByUid } = await import("@/lib/prospects/repo.server");
        const {
          persistConfirmedBooking,
          provenBookingEventId,
          applyExistingBookingToTestState,
          publicBookingDecision,
        } = await import("@/lib/mail/booking-confirm.server");
        const { googleEventIdForBookingToken } = await import("@/lib/mail/booking-evidence");
        const existing = await getBookingLink(params.token);
        if (!existing) {
          return Response.json({ ok: false, reason: "This booking link is not valid." });
        }
        const already = await provenBookingEventId(existing.user_id, existing.prospect_uid, params.token);
        const decision = publicBookingDecision({
          linkStatus: existing.status,
          persistedGoogleEventId: already?.eventId,
        });
        if (decision.action === "return_existing") {
          await applyExistingBookingToTestState(
            existing.user_id,
            existing.prospect_uid,
            decision.eventId,
            already?.startAt,
            already?.endAt,
            already?.title,
          );
          return Response.json({ ok: true, eventId: decision.eventId, already: true });
        }
        if (decision.action === "persistence_failed") {
          return Response.json({
            ok: false,
            reason: "The Calendar event may already exist, but booking state could not be confirmed. No second event was created.",
            code: "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE",
            eventId: already?.eventId || null,
          });
        }
        if (decision.action !== "create") {
          return Response.json({ ok: false, reason: "This booking link is not valid." });
        }
        const claimed = await claimBookingLink(params.token);
        if (!claimed) {
          const race = await provenBookingEventId(existing.user_id, existing.prospect_uid, params.token);
          if (race?.eventId) {
            await applyExistingBookingToTestState(
              existing.user_id,
              existing.prospect_uid,
              race.eventId,
              race.startAt,
              race.endAt,
              race.title,
            );
            return Response.json({ ok: true, eventId: race.eventId, already: true });
          }
          return Response.json({ ok: false, reason: "This booking link was already used." });
        }
        const prospect = await getProspectByUid(claimed.user_id, claimed.prospect_uid);
        if (!prospect) {
          await finishBookingLink(params.token, "open");
          return Response.json({ ok: false, reason: "That company is no longer on the list." });
        }
        const body = (await request.json()) as { start?: string; end?: string };
        const start = new Date(body.start || "");
        const end = new Date(body.end || "");
        const tokens = await accessFor(claimed.user_id, "calendar");
        if (!tokens) {
          await finishBookingLink(params.token, "open");
          return Response.json({ ok: false, reason: "Calendar needs to be reconnected. No meeting was created." });
        }
        const { offeredSlots, createEvent, CALENDAR_UNREADABLE } = await import("@/lib/google/calendar");
        const { slotIsOffered } = await import("@/lib/mail/booking");
        const from = new Date();
        const avail = await offeredSlots(tokens.access_token, { from, count: 8, calendarId: tokens.email });
        if (!avail.ok) {
          await finishBookingLink(params.token, "open");
          return Response.json({ ok: false, reason: CALENDAR_UNREADABLE });
        }
        const check = slotIsOffered({ start, end }, avail.slots, from);
        if (!check.ok) {
          await finishBookingLink(params.token, "open");
          return Response.json({ ok: false, reason: check.reason });
        }
        const created = await createEvent(tokens.access_token, {
          title: `Lamb Ascension / ${prospect.name}`,
          start,
          end,
          eventId: googleEventIdForBookingToken(params.token),
        });
        if (!created.ok) {
          await finishBookingLink(params.token, "open");
          return Response.json({ ok: false, reason: created.error });
        }
        const persisted = await persistConfirmedBooking({
          userId: claimed.user_id,
          prospectUid: claimed.prospect_uid,
          googleEventId: created.id,
          title: "Sales call",
          start,
          end,
          token: params.token,
          method: "AUTOMATION",
        });
        if (!persisted.ok) {
          return Response.json({
            ok: false,
            reason: persisted.reason,
            code: persisted.code,
            eventId: persisted.eventId,
          });
        }
        return Response.json({ ok: true, eventId: created.id });
      },
    },
  },
});
