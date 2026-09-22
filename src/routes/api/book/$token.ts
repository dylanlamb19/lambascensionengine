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
        const { getBookingLink, claimBookingLink, finishBookingLink, saveCalendarEvent, audit } = await import("@/lib/mail/sql.server");
        const { accessFor } = await import("@/lib/mail/live.server");
        const { getProspectByUid } = await import("@/lib/prospects/repo.server");
        const existing = await getBookingLink(params.token);
        if (!existing || existing.status !== "open") {
          return Response.json({ ok: false, reason: "This booking link is not valid." });
        }
        const claimed = await claimBookingLink(params.token);
        if (!claimed) return Response.json({ ok: false, reason: "This booking link was already used." });
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
        });
        if (!created.ok) {
          await finishBookingLink(params.token, "open");
          return Response.json({ ok: false, reason: created.error });
        }
        await finishBookingLink(params.token, "used");
        await saveCalendarEvent(claimed.user_id, claimed.prospect_uid, created.id, "Sales call", start, end);
        await audit(claimed.user_id, "booking_link", "Prospect booked a time", { prospectUid: claimed.prospect_uid, method: "AUTOMATION", providerIds: created.id });
        return Response.json({ ok: true });
      },
    },
  },
});
