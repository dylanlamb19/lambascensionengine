import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNER_TZ_DEFAULT,
  fromZonedLocal,
  ownerEventFailureSpeech,
  ownerEventFingerprint,
  ownerEventSpeechFromState,
  ownerEventSuccessSpeech,
  parseClock,
  resolveOwnerWhen,
  sanitizeOwnerTitle,
  toOffsetIso,
  ymdInTimezone,
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
