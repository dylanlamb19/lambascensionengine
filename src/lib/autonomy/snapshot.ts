export type AcquisitionCounts = {
  discovered: number;
  qualified: number;
  emailsSent: number;
  followups: number;
  replies: number;
  interested: number;
  callsBooked: number;
  needsYou: number;
};

export function acquisitionCounts(rows: { stage?: string; research_status?: string; suppressed?: boolean; fit?: string; history?: { action?: string }[] }[]): AcquisitionCounts {
  const counts: AcquisitionCounts = {
    discovered: rows.length,
    qualified: 0,
    emailsSent: 0,
    followups: 0,
    replies: 0,
    interested: 0,
    callsBooked: 0,
    needsYou: 0,
  };
  for (const row of rows) {
    const stage = row.stage || "";
    const actions = new Set((row.history || []).map((h) => h.action || ""));
    if (stage === "Call Booked") counts.callsBooked += 1;
    if (stage === "Replied" || actions.has("reply")) counts.replies += 1;
    if (stage === "Contacted" || actions.has("email_sent") || actions.has("autonomy_sent")) counts.emailsSent += 1;
    if (actions.has("followup_sent")) counts.followups += 1;
    if (stage === "Approved for Outreach" || stage === "Qualified" || row.fit === "strong") counts.qualified += 1;
    if (actions.has("autonomy_escalate")) counts.needsYou += 1;
    if (row.suppressed) continue;
  }
  return counts;
}
