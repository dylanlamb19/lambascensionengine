import { dailySummary } from "@/lib/autonomy/daily";

export function AutonomyHome({
  rows,
  testMode,
}: {
  rows: { stage?: string; discovered_at?: string; history?: { at?: string; action?: string; detail?: string }[] }[];
  testMode: boolean;
}) {
  const day = new Date().toISOString().slice(0, 10);
  const today = dailySummary(rows, day);
  return (
    <section className="la-card mb-5" data-autonomy="1">
      <p className="la-kicker">Today</p>
      <p className="mt-1 text-sm">{testMode ? "Acquisition is running in Test Mode. Nothing is emailed to real companies." : "Acquisition is running. New email stays inside the daily limit."}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <p><b>{today.found}</b> found</p>
        <p><b>{today.researched}</b> researched</p>
        <p><b>{today.qualified}</b> qualified</p>
        <p><b>{today.contacted}</b> contacted</p>
        <p><b>{today.replies}</b> replies</p>
        <p><b>{today.interested}</b> interested</p>
        <p><b>{today.callsBooked}</b> calls booked</p>
        <p><b>{today.revenue}</b> revenue</p>
      </div>
      {today.needsYou.length ? (
        <div className="mt-3 text-sm">
          <p className="la-kicker">Needs you</p>
          {today.needsYou.slice(0, 4).map((item) => <p key={item} className="mt-1">{item}</p>)}
        </div>
      ) : <p className="mt-3 text-sm text-muted">Nothing needs you right now. Calls will show up here when someone books.</p>}
    </section>
  );
}
