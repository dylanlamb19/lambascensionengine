import { useState } from "react";
import { recordOutcomeFn } from "@/lib/autonomy/actions";
import { dailySummary } from "@/lib/autonomy/daily";
import { knownRevenue, lifecycle, type OutcomeProspect } from "@/lib/autonomy/outcomes";

type Row = OutcomeProspect & {
  uid?: string;
  discovered_at?: string;
  vertical?: string;
  website?: string;
  history?: { at?: string; action?: string; detail?: string }[];
};

export function BookingLinkField() {
  return (
    <section className="la-card mb-4" data-booking-link="1">
      <p className="la-kicker">Booking</p>
      <p className="mt-1 text-sm text-muted">Each interested company gets its own private booking link. There is nothing to paste here.</p>
    </section>
  );
}

export function AutonomyHome({
  rows,
  testMode,
  onUpdated,
}: {
  rows: Row[];
  testMode: boolean;
  onUpdated?: (row: Row) => void;
}) {
  const [busy, setBusy] = useState("");
  const [value, setValue] = useState("");
  const [billing, setBilling] = useState<"" | "one-time" | "monthly">("");
  const calendarDown = rows.some((r) => (r.history || []).some((h) => h.action === "calendar_unavailable"));
  const day = new Date().toISOString().slice(0, 10);
  const today = dailySummary(rows, day);
  const now = new Date();
  const upcoming = rows.filter((r) => lifecycle(r) === "BOOKED");
  const needOutcome = upcoming.filter((r) => !r.meeting_at || new Date(r.meeting_at).getTime() <= now.getTime());
  const needDecision = rows.filter((r) => lifecycle(r) === "FOLLOW_UP_NEEDED" || lifecycle(r) === "SHOWED");
  const showed = rows.filter((r) => lifecycle(r) === "SHOWED").length;
  const won = rows.filter((r) => lifecycle(r) === "WON").length;
  const lost = rows.filter((r) => lifecycle(r) === "LOST").length;
  const money = knownRevenue(rows);

  async function mark(row: Row, kind: "SHOWED" | "NO_SHOW" | "RESCHEDULE" | "WON" | "LOST" | "FOLLOW_UP_NEEDED", extra?: { lostReason?: string }) {
    if (!row.uid) return;
    setBusy(row.uid + kind);
    const result = await recordOutcomeFn({
      data: {
        uid: row.uid,
        kind,
        clientValue: value.trim() ? Number(value) : null,
        billing,
        lostReason: extra?.lostReason,
      },
    });
    setBusy("");
    if (result.ok) onUpdated?.(result.prospect as Row);
  }

  return (
    <section className="la-card mb-5" data-autonomy="1">
      <p className="la-kicker">Today</p>
      <p className="mt-1 text-sm">{testMode ? "Acquisition is running in Test Mode. Nothing is emailed to real companies." : "Acquisition is running. New email stays inside the daily limit."}</p>
      {calendarDown ? <p className="mt-2 text-sm">Google Calendar is not connected. Interested replies will not include a booking link until it is.</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <p><b>{today.found}</b> found</p>
        <p><b>{today.researched}</b> researched</p>
        <p><b>{today.qualified}</b> qualified</p>
        <p><b>{today.contacted}</b> contacted</p>
        <p><b>{today.replies}</b> replies</p>
        <p><b>{today.interested}</b> interested</p>
        <p><b>{upcoming.length}</b> booked</p>
        <p><b>{money.amount === null ? "UNKNOWN" : `$${money.amount.toLocaleString()}`}</b> revenue</p>
      </div>
      <div className="mt-3 text-sm">
        <p className="la-kicker">Upcoming calls</p>
        {upcoming.length ? upcoming.slice(0, 3).map((row) => (
          <p key={row.uid || row.name} className="mt-1">{row.name}{row.meeting_at ? ` — ${new Date(row.meeting_at).toLocaleString()}` : " — time not on file"}</p>
        )) : <p className="mt-1 text-muted">No calls booked.</p>}
      </div>
      <div className="mt-3 text-sm">
        <p className="la-kicker">Needs you</p>
        {!needOutcome.length && !needDecision.length && !today.needsYou.length ? <p className="mt-1 text-muted">Nothing needs you right now.</p> : null}
        {today.needsYou.slice(0, 3).map((item) => <p key={item} className="mt-1">{item}</p>)}
        {needOutcome.map((row) => (
          <div key={row.uid} className="mt-2">
            <p>{row.name} needs a call result.</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className="la-btn la-btn-quiet" disabled={busy === (row.uid || "") + "SHOWED"} onClick={() => void mark(row, "SHOWED")}>Showed</button>
              <button type="button" className="la-btn la-btn-quiet" disabled={busy === (row.uid || "") + "NO_SHOW"} onClick={() => void mark(row, "NO_SHOW")}>No-show</button>
            </div>
          </div>
        ))}
        {rows.filter((r) => lifecycle(r) === "NO_SHOW").slice(0, 2).map((row) => (
          <div key={row.uid} className="mt-2">
            <p>{row.name} missed the call. No new cold email.</p>
            <button type="button" className="la-btn la-btn-quiet mt-1" onClick={() => void mark(row, "RESCHEDULE")}>Waiting for them to rebook</button>
          </div>
        ))}
        {needDecision.map((row) => (
          <div key={row.uid} className="mt-2">
            <p>{row.name} showed. What happened?</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <input className="la-field w-28" inputMode="decimal" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
              <button type="button" className="la-btn la-btn-quiet" onClick={() => setBilling("monthly")}>Monthly</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => setBilling("one-time")}>One-time</button>
              <button type="button" className="la-btn la-btn-primary" onClick={() => void mark(row, "WON")}>Won</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => void mark(row, "LOST", { lostReason: "No decision" })}>Lost</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => void mark(row, "FOLLOW_UP_NEEDED")}>Follow up later</button>
            </div>
            <p className="mt-1 text-muted">{billing ? `Billing: ${billing}. ` : ""}Leave value blank and revenue stays UNKNOWN.</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">Pipeline: {upcoming.length} booked, {showed} showed, {won} won, {lost} lost.</p>
    </section>
  );
}
