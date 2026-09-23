import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/book/$token")({
  component: BookPage,
});

function BookPage() {
  const { token } = Route.useParams();
  const [msg, setMsg] = useState("Looking up open times…");
  const [slots, setSlots] = useState<{ label: string; start: string; end: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/book/${token}`);
        const data = (await res.json()) as { ok: boolean; reason?: string; timezoneLabel?: string; slots?: { label: string; start: string; end: string }[] };
        if (!data.ok) {
          setMsg(data.reason || "This booking link is not valid.");
          return;
        }
        setSlots(data.slots || []);
        setMsg(data.slots?.length ? `Pick a time. Times are shown in ${data.timezoneLabel || "Central Time"}.` : "No open times this week.");
      } catch {
        setMsg("Could not load times. Try again later.");
      }
    })();
  }, [token]);

  async function pick(slot: { start: string; end: string; label: string }) {
    setMsg("Booking…");
    try {
      const res = await fetch(`/api/book/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: slot.start, end: slot.end }),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      setMsg(data.ok ? `Booked ${slot.label}.` : data.reason || "Could not book that time.");
    } catch {
      setMsg("Could not book that time. Try again.");
    }
  }

  return (
    <main className="la-login la-shell">
      <div className="la-card">
        <p className="la-kicker">Lamb Ascension</p>
        <h1 className="font-display mt-2 mb-3 text-3xl">Pick a time</h1>
        <p className="mb-4 text-sm text-muted">{msg}</p>
        <div className="flex flex-col gap-2">
          {slots.map((s) => (
            <button key={s.start} className="la-btn la-btn-primary" onClick={() => void pick(s)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
