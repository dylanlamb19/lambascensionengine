import { acquisitionCounts } from "@/lib/autonomy/snapshot";

export function AutonomyHome({
  rows,
  testMode,
}: {
  rows: { stage?: string; research_status?: string; suppressed?: boolean; fit?: string; history?: { action?: string }[] }[];
  testMode: boolean;
}) {
  const counts = acquisitionCounts(rows);
  return (
    <section className="la-card mb-5" data-autonomy="1">
      <p className="la-kicker">Client acquisition</p>
      <p className="mt-1 text-sm">{testMode ? "Running in Test Mode. It can find, research, and write emails. It will not email real companies." : "Running. Qualified emails can send inside the daily limit."}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <p><b>{counts.discovered}</b> found</p>
        <p><b>{counts.qualified}</b> qualified</p>
        <p><b>{counts.emailsSent}</b> emails sent</p>
        <p><b>{counts.callsBooked}</b> calls booked</p>
        <p><b>{counts.replies}</b> replies</p>
        <p><b>{counts.needsYou}</b> need you</p>
      </div>
      <p className="mt-3 text-sm text-muted">You do not have to press Start My Tasks for this. The worker keeps the pipeline moving. Upcoming calls stay the thing that needs you.</p>
    </section>
  );
}
