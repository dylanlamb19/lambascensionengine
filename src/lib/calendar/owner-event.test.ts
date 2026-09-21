import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNER_TZ_DEFAULT,
  fromZonedLocal,
  isOwnerCalendarFollowupTime,
  isPersonalCalendarCommand,
  isOwnerCalendarManageCommand,
  isOwnerCalendarRefusalSpeech,
  shouldSilenceAraForOwnerCalendar,
  ownerEventFailureSpeech,
  ownerEventFingerprint,
  ownerEventSpeechFromState,
  ownerEventSuccessSpeech,
  parseClock,
  parseOwnerCalendarSpeech,
  parseOwnerCalendarManage,
  pickCalendarMatches,
  resolveOwnerWhen,
  resolveOwnerWindow,
  sanitizeOwnerTitle,
  toOffsetIso,
  ymdInTimezone,
  ownerDeleteMissingSpeech,
  ownerDeleteSuccessSpeech,
  ownerUpdateSuccessSpeech,
  ownerAmbiguousSpeech,
  ownerSalesDeleteConfirmSpeech,
} from "./owner-event.ts";

/** Sunday, Sep 20, 2026 11:05 AM CDT */
const NOW = new Date("2026-09-20T16:05:00.000Z");

describe("owner calendar timezone resolution", () => {
  it("tomorrow at 4 PM is 4 PM in America/Chicago, not server UTC", () => {
    const r = resolveOwnerWhen({ when: "tomorrow at 4 PM", now: NOW, timezone: OWNER_TZ_DEFAULT });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(ymdInTimezone(r.start, OWNER_TZ_DEFAULT), "2026-09-21");
    assert.equal(r.start.toISOString(), "2026-09-21T21:00:00.000Z");
    assert.equal(r.timeLabel, "4:00 PM");
    assert.match(r.whenLabel, /tomorrow at 4:00 PM/);
    assert.equal(r.durationMinutes, 30);
  });

  it("fromZonedLocal 4 PM Chicago in September is 21:00 UTC", () => {
    const d = fromZonedLocal(2026, 9, 21, 16, 0, "America/Chicago");
    assert.equal(d.toISOString(), "2026-09-21T21:00:00.000Z");
    assert.equal(toOffsetIso(d, "America/Chicago"), "2026-09-21T16:00:00-05:00");
  });

  it("Friday at noon is the upcoming Friday in owner TZ", () => {
    const r = resolveOwnerWhen({ when: "Friday at noon", now: NOW, timezone: "America/Chicago" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(ymdInTimezone(r.start, "America/Chicago"), "2026-09-25");
    assert.equal(r.start.toISOString(), "2026-09-25T17:00:00.000Z");
  });

  it("next Monday at 9 is Monday in owner TZ", () => {
    const r = resolveOwnerWhen({ when: "next Monday at 9", now: NOW, timezone: "America/Chicago" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(ymdInTimezone(r.start, "America/Chicago"), "2026-09-21");
    assert.equal(r.start.toISOString(), "2026-09-21T14:00:00.000Z");
  });

  it("tonight at 7 is 7 PM today in owner TZ", () => {
    const r = resolveOwnerWhen({ when: "tonight at 7", now: NOW, timezone: "America/Chicago" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(ymdInTimezone(r.start, "America/Chicago"), "2026-09-20");
    assert.equal(r.start.toISOString(), "2026-09-21T00:00:00.000Z");
  });

  it("does not invent a time when only the day is given", () => {
    const r = resolveOwnerWhen({ when: "tomorrow", now: NOW, timezone: "America/Chicago" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.need, "time");
    assert.match(r.question, /What time tomorrow/i);
  });

  it("dentist tomorrow asks for the time", () => {
    const r = resolveOwnerWhen({ when: "Add a dentist appointment tomorrow", now: NOW, timezone: "America/Chicago" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.need, "time");
  });

  it("does not treat a day-of-month as a clock hour", () => {
    const r = resolveOwnerWhen({ when: "September 21 at 4 PM", now: NOW, timezone: "America/Chicago" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.start.toISOString(), "2026-09-21T21:00:00.000Z");
  });

  it("same fingerprint for identical title+start+duration", () => {
    const a = ownerEventFingerprint({ title: "Go to SouthState Bank", startIso: "2026-09-21T21:00:00.000Z", durationMinutes: 30 });
    const b = ownerEventFingerprint({ title: "  go to southstate bank ", startIso: "2026-09-21T21:00:00.000Z", durationMinutes: 30 });
    assert.equal(a, b);
    const c = ownerEventFingerprint({ title: "Go to SouthState Bank", startIso: "2026-09-21T21:00:00.000Z", durationMinutes: 15 });
    assert.notEqual(a, c);
  });

  it("success speech matches the SouthState reminder wording", () => {
    const spoken = ownerEventSuccessSpeech("Go to SouthState Bank and withdraw cash", "tomorrow at 4:00 PM");
    assert.equal(spoken, "Done — I added ‘Go to SouthState Bank and withdraw cash’ to your calendar for tomorrow at 4:00 PM.");
    assert.match(ownerEventFailureSpeech(), /couldn.t create that event/i);
    assert.match(ownerEventSpeechFromState(null), /haven.t added/i);
  });

  it("parseClock 4 PM stays 16:00", () => {
    assert.deepEqual(parseClock("tomorrow at 4 PM"), { hour: 16, minute: 0 });
    assert.deepEqual(parseClock("4:00 PM"), { hour: 16, minute: 0 });
    assert.equal(parseClock("dentist tomorrow"), null);
  });

  it("title sanitizer keeps the bank errand", () => {
    const t = sanitizeOwnerTitle("Go to SouthState Bank and withdraw cash");
    assert.equal(t, "Go to SouthState Bank and withdraw cash");
  });
});

describe("personal calendar speech parsing", () => {
  it("extracts the SouthState reminder from a full Ara command", () => {
    const p = parseOwnerCalendarSpeech(
      "Ara, set a reminder on my calendar for 4 PM tomorrow that I need to go to SouthState Bank and withdraw cash.",
    );
    assert.equal(p.matched, true);
    if (!p.matched) return;
    assert.equal(p.title, "Go to SouthState Bank and withdraw cash");
    const r = resolveOwnerWhen({ when: p.when, now: NOW, timezone: OWNER_TZ_DEFAULT });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.start.toISOString(), "2026-09-21T21:00:00.000Z");
    assert.equal(r.durationMinutes, 30);
  });

  it("parses dentist / lunch / gym / quoted title commands", () => {
    const dentist = parseOwnerCalendarSpeech("Add a dentist appointment tomorrow at 2 PM.");
    assert.equal(dentist.matched, true);
    if (dentist.matched) assert.match(dentist.title, /dentist appointment/i);

    const lunch = parseOwnerCalendarSpeech("Put lunch with Mom on my calendar Friday at noon.");
    assert.equal(lunch.matched, true);
    if (lunch.matched) assert.match(lunch.title, /lunch with Mom/i);

    const gym = parseOwnerCalendarSpeech("Schedule gym tomorrow at 6 PM.");
    assert.equal(gym.matched, true);
    if (gym.matched) assert.equal(gym.title.toLowerCase(), "gym");

    const quoted = parseOwnerCalendarSpeech("Add 'Call insurance company' to my calendar Monday at 10.");
    assert.equal(quoted.matched, true);
    if (quoted.matched) assert.match(quoted.title, /Call insurance company/i);
  });

  it("does not invent a time for dentist tomorrow", () => {
    const p = parseOwnerCalendarSpeech("Add a dentist appointment tomorrow.");
    assert.equal(p.matched, true);
    if (!p.matched) return;
    const r = resolveOwnerWhen({ when: p.when, now: NOW, timezone: OWNER_TZ_DEFAULT });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.need, "time");
  });

  it("does not treat sales booking or calendar view as a personal event", () => {
    assert.equal(isPersonalCalendarCommand("Schedule the call"), false);
    assert.equal(isPersonalCalendarCommand("Book them"), false);
    assert.equal(isPersonalCalendarCommand("Pull up my calendar"), false);
    assert.equal(isPersonalCalendarCommand("What's on my calendar"), false);
    assert.equal(parseOwnerCalendarSpeech("Show my calendar").matched, false);
  });

  it("treats a bare time as a follow-up after asking what time", () => {
    assert.equal(isOwnerCalendarFollowupTime("2 PM"), true);
    assert.equal(isOwnerCalendarFollowupTime("noon"), true);
    assert.equal(isOwnerCalendarFollowupTime("Add a dentist appointment tomorrow"), false);
    assert.equal(isOwnerCalendarFollowupTime("never mind"), false);
  });

  it("silences Ara on personal calendar speech, including partials and the old refusal", () => {
    assert.equal(
      shouldSilenceAraForOwnerCalendar(
        "Ara, set a reminder on my calendar for 4 PM tomorrow that I need to go to SouthState Bank",
      ),
      true,
    );
    assert.equal(shouldSilenceAraForOwnerCalendar("Add a dentist appointment tomorrow"), true);
    assert.equal(shouldSilenceAraForOwnerCalendar("what did you just add"), true);
    assert.equal(shouldSilenceAraForOwnerCalendar("2 PM", { title: "Dentist appointment", when: "tomorrow" }), true);
    assert.equal(shouldSilenceAraForOwnerCalendar("Pull up my calendar"), false);
    assert.equal(shouldSilenceAraForOwnerCalendar("Schedule the call"), false);
    assert.equal(shouldSilenceAraForOwnerCalendar("Delete my dentist appointment tomorrow at 2"), true);
    assert.equal(shouldSilenceAraForOwnerCalendar("What do I have tomorrow?"), true);
    assert.equal(isOwnerCalendarRefusalSpeech("I'll prepare that calendar booking for you. I can open your calendar or help with sales call bookings, but I don't have a tool to add personal reminders or events."), true);
    assert.equal(isOwnerCalendarRefusalSpeech("I can remove calendar events, but only the ones I created myself. The only calendar tool I have is for adding personal reminders and events. I can't delete or remove anything from your Google Calendar."), true);
    assert.equal(isOwnerCalendarRefusalSpeech("Done — I added ‘Go to SouthState Bank and withdraw cash’ to your calendar for tomorrow at 4:00 PM."), false);
  });
});

describe("owner calendar manage speech", () => {
  it("parses delete / list / reschedule commands", () => {
    const del = parseOwnerCalendarManage("Delete my dentist appointment tomorrow at 2.");
    assert.equal(del.kind, "delete");
    if (del.kind === "delete") {
      assert.match(del.title, /dentist/i);
      assert.match(del.when, /tomorrow/i);
    }
    const bank = parseOwnerCalendarManage("Remove the bank reminder tomorrow at 4.");
    assert.equal(bank.kind, "delete");
    const gym = parseOwnerCalendarManage("Cancel the gym event tonight.");
    assert.equal(gym.kind, "delete");
    const last = parseOwnerCalendarManage("Delete the event I just added.");
    assert.equal(last.kind, "delete");
    if (last.kind === "delete") assert.equal(last.lastEvent, true);
    const list = parseOwnerCalendarManage("What do I have tomorrow?");
    assert.equal(list.kind, "list");
    const afternoon = parseOwnerCalendarManage("What's on my calendar this afternoon?");
    assert.equal(afternoon.kind, "list");
    const move = parseOwnerCalendarManage("Move my dentist appointment from 2 PM to 4 PM tomorrow.");
    assert.equal(move.kind, "update");
    if (move.kind === "update") {
      assert.match(move.title, /dentist/i);
      assert.match(String(move.newTime), /4/i);
    }
    const rename = parseOwnerCalendarManage("Change lunch Friday to noon.");
    assert.equal(rename.kind, "update");
    const that = parseOwnerCalendarManage("Move that to 5 PM.");
    assert.equal(that.kind, "update");
    if (that.kind === "update") assert.equal(that.lastEvent, true);
  });

  it("does not steal sales booking or visual move commands", () => {
    assert.equal(isOwnerCalendarManageCommand("Schedule the call"), false);
    assert.equal(isOwnerCalendarManageCommand("Pull up my calendar"), false);
    assert.equal(isPersonalCalendarCommand("Delete my dentist appointment tomorrow at 2"), false);
    assert.equal(isOwnerCalendarManageCommand("Move the focal point left"), false);
    assert.equal(isOwnerCalendarManageCommand("Change the overlay"), false);
  });

  it("tomorrow at 2 PM window is America/Chicago, not UTC", () => {
    const w = resolveOwnerWindow({ when: "dentist tomorrow at 2 PM", now: NOW, timezone: OWNER_TZ_DEFAULT });
    assert.equal(w.ok, true);
    if (!w.ok) return;
    assert.equal(w.hasClock, true);
    assert.equal(w.start?.toISOString(), "2026-09-21T19:00:00.000Z");
    const afternoon = resolveOwnerWindow({ when: "this afternoon", now: NOW, timezone: OWNER_TZ_DEFAULT });
    assert.equal(afternoon.ok, true);
    if (!afternoon.ok) return;
    assert.equal(ymdInTimezone(afternoon.from, OWNER_TZ_DEFAULT), "2026-09-20");
  });

  it("asks when two events match and refuses when none match", () => {
    const events = [
      { id: "a", title: "Dentist appointment", start: "2026-09-21T19:00:00.000Z" },
      { id: "b", title: "Team call", start: "2026-09-21T19:00:00.000Z" },
      { id: "c", title: "Gym", start: "2026-09-21T23:00:00.000Z" },
    ];
    const two = pickCalendarMatches(events, { title: "", startMs: Date.parse("2026-09-21T19:00:00.000Z"), windowMs: 90 * 60 * 1000 });
    assert.equal(two.ambiguous, true);
    assert.equal(two.matches.length, 2);
    assert.match(ownerAmbiguousSpeech(two.matches, OWNER_TZ_DEFAULT, NOW, "delete"), /Which should I delete/);
    const none = pickCalendarMatches(events, { title: "bank reminder", startMs: Date.parse("2026-09-21T19:00:00.000Z") });
    assert.equal(none.matches.length, 0);
    assert.match(ownerDeleteMissingSpeech(), /didn.t delete anything/);
    const one = pickCalendarMatches(events, { title: "dentist", startMs: Date.parse("2026-09-21T19:00:00.000Z") });
    assert.equal(one.ambiguous, false);
    assert.equal(one.matches[0]?.id, "a");
    assert.match(ownerDeleteSuccessSpeech("Dentist appointment"), /removed/);
    assert.match(ownerUpdateSuccessSpeech("Dentist appointment", "tomorrow at 4:00 PM"), /moved/);
    assert.match(ownerSalesDeleteConfirmSpeech("Sales call", 1), /booked sales call/);
  });
});
