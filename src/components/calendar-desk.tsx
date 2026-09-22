"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AgendaEvent } from "@/lib/mail/actions";
import { formatLong, formatShort, formatTime, rangeFor, ymdInTz, type CalView } from "@/lib/calendar/range";
import type { ConnectionHealth } from "@/lib/mail/integration-status";

export function CalendarDesk({
  calView,
  calAnchor,
  events,
  selectedId,
  health,
  reason,
  loading,
  onToday,
  onPrev,
  onNext,
  onView,
  onSelect,
  onOpenProspect,
  onPrep,
  onSettings,
}: {
  calView: CalView;
  calAnchor: string;
  events: AgendaEvent[];
  selectedId: string | null;
  health: ConnectionHealth;
  reason: string;
  loading: boolean;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onView: (v: CalView) => void;
  onSelect: (id: string) => void;
  onOpenProspect: (uid: string) => void;
  onPrep: (uid: string) => void;
  onSettings: () => void;
}) {
  const range = rangeFor(calView, calAnchor);
  const selected = events.find((e) => e.id === selectedId) || null;
  const todayKey = ymdInTz();
  const now = Date.now();
  const todayCalls = events.filter((e) => e.kind === "sales_call" && ymdInTz(new Date(e.start)) === todayKey);
  const upcoming = events
    .filter((e) => e.kind === "sales_call" && new Date(e.start).getTime() >= now)
    .slice(0, 5);
  const connected = health === "connected";
  const unknown = health === "unknown";

  return (
    <section className="space-y-4" data-owner-calendar="1" data-cal-view={calView} data-cal-range={range.label} data-cal-health={health}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="la-kicker">Schedule</p>
          <h1 className="font-display mt-1 text-3xl">Calendar</h1>
          <p className="mt-1 text-sm text-muted">{range.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="la-btn la-btn-ghost" onClick={onToday}>Today</button>
          <button className="la-btn la-btn-ghost" onClick={onPrev} aria-label="Previous"><ChevronLeft size={18} /></button>
          <button className="la-btn la-btn-ghost" onClick={onNext} aria-label="Next"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="la-tabs">
        {(["day", "week", "month"] as const).map((v) => (
          <button
            key={v}
            className="la-tab capitalize"
            data-on={calView === v ? "1" : "0"}
            onClick={() => onView(v)}
          >
            {v}
          </button>
        ))}
      </div>

      {unknown ? (
        <div className="la-card">
          <p>Checking Calendar…</p>
          <p className="mt-2 text-sm text-muted">I’m not treating Calendar as disconnected until the server status loads.</p>
        </div>
      ) : !connected ? (
        <div className="la-card la-card-accent">
          <p>Calendar isn’t connected yet.</p>
          <p className="mt-2 text-sm text-muted">I will not guess what’s on your calendar. Gmail can stay connected on its own.</p>
          <button className="la-btn la-btn-primary mt-4" onClick={onSettings}>
            Connect in Settings
          </button>
        </div>
      ) : reason ? (
        <div className="la-card">
          <div className="la-ribbon la-ribbon-bad">{reason}</div>
          <p className="mt-3 text-sm text-muted">This is not an empty calendar. Nothing was assumed.</p>
          <button className="la-btn la-btn-ghost mt-4" onClick={onSettings}>Open Settings</button>
        </div>
      ) : loading ? (
        <p className="text-sm text-muted">Reading your Google Calendar…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="la-card">
              <p className="la-kicker">Today’s calls</p>
              {todayCalls.length ? todayCalls.map((e) => (
                <button key={e.id} className="mt-2 block w-full text-left" onClick={() => onSelect(e.id)}>
                  <span className="font-semibold">{formatTime(e.start)}</span>
                  <span className="mt-0.5 block text-sm">{e.companyName || e.title}</span>
                </button>
              )) : <p className="mt-2 text-sm text-muted">No sales calls today.</p>}
            </div>
            <div className="la-card">
              <p className="la-kicker">Upcoming sales calls</p>
              {upcoming.length ? upcoming.map((e) => (
                <button key={e.id} className="mt-2 block w-full text-left" onClick={() => onSelect(e.id)}>
                  <span className="font-semibold">{formatTime(e.start)}</span>
                  <span className="mt-0.5 block text-sm">{e.companyName || e.title}</span>
                </button>
              )) : <p className="mt-2 text-sm text-muted">None coming up in this range.</p>}
            </div>
          </div>
          {calView === "week" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
              {range.days.map((day) => {
                const dayEvents = events.filter((e) => ymdInTz(new Date(e.start)) === day);
                return (
                  <div key={day} className="la-cal-day">
                    <p className="text-xs text-muted">{formatLong(day).split(",")[0]} {formatShort(day)}</p>
                    {dayEvents.length ? dayEvents.map((e) => (
                      <button
                        key={e.id}
                        className="la-cal-event"
                        data-on={selectedId === e.id ? "1" : "0"}
                        onClick={() => onSelect(e.id)}
                      >
                        <span className="block font-semibold">{formatTime(e.start)}</span>
                        {e.companyName || e.title}
                      </button>
                    )) : <p className="mt-3 text-xs text-muted">—</p>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {events.length ? events.map((e) => (
                <button
                  key={e.id}
                  className={`la-card block w-full text-left ${selectedId === e.id ? "la-card-accent" : ""}`}
                  onClick={() => onSelect(e.id)}
                >
                  <p className="la-kicker">{formatTime(e.start)} · {e.kind === "sales_call" ? "Sales call" : "Calendar"}</p>
                  <p className="font-display mt-1 text-lg">{e.companyName || e.title}</p>
                  {e.companyName && e.title !== e.companyName ? <p className="text-sm text-muted">{e.title}</p> : null}
                </button>
              )) : (
                <p className="la-card la-empty">No events in this range.</p>
              )}
            </div>
          )}
        </>
      )}

      {selected ? (
        <div className="la-card la-card-accent" data-cal-selected={selected.id}>
          <p className="la-kicker">{selected.kind === "sales_call" ? "Sales Call" : "Calendar event"}</p>
          <h2 className="font-display mt-1 text-2xl">{selected.companyName || selected.title}</h2>
          <p className="mt-1">{formatTime(selected.start)}</p>
          {selected.companyName && selected.title !== selected.companyName ? <p className="text-sm text-muted">{selected.title}</p> : null}
          <p className="mt-2 text-sm text-muted">Status: {selected.status}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.prospectUid ? (
              <>
                <button className="la-btn la-btn-primary" onClick={() => onOpenProspect(selected.prospectUid!)}>Open Prospect</button>
                <button className="la-btn la-btn-ghost" onClick={() => onPrep(selected.prospectUid!)}>Call Prep</button>
              </>
            ) : (
              <p className="text-sm text-muted">This isn’t linked to a Lamb Ascension prospect.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
