export type DayRow = {
  stage?: string;
  discovered_at?: string;
  history?: { at?: string; action?: string; detail?: string }[];
};

export type DaySummary = {
  found: number;
  researched: number;
  qualified: number;
  contacted: number;
  replies: number;
  interested: number;
  callsBooked: number;
  needsYou: string[];
  revenue: "UNKNOWN";
  paused: boolean;
};

function onDay(at: string | undefined, day: string): boolean {
  return Boolean(at && at.slice(0, 10) === day);
}

export function dailySummary(rows: DayRow[], day: string): DaySummary {
  const summary: DaySummary = {
    found: 0,
    researched: 0,
    qualified: 0,
    contacted: 0,
    replies: 0,
    interested: 0,
    callsBooked: 0,
    needsYou: [],
    revenue: "UNKNOWN",
    paused: false,
  };
  for (const row of rows) {
    if (onDay(row.discovered_at, day)) summary.found += 1;
    const history = row.history || [];
    if (history.some((h) => h.action === "research_completed" && onDay(h.at, day))) summary.researched += 1;
    if (history.some((h) => h.action === "outreach_generated" && onDay(h.at, day))) summary.qualified += 1;
    if (history.some((h) => (h.action === "autonomy_sent" || h.action === "email_sent") && onDay(h.at, day))) summary.contacted += 1;
    if (history.some((h) => (h.action === "reply" || h.action === "autonomy_replied" || h.action === "autonomy_escalate") && onDay(h.at, day))) summary.replies += 1;
    if (history.some((h) => onDay(h.at, day) && /INTERESTED|WANTS_AUDIT|BOOKING_REQUEST/.test(h.detail || ""))) summary.interested += 1;
    if (history.some((h) => h.action === "meeting_booked" && onDay(h.at, day)) || (row.stage === "Call Booked" && history.some((h) => h.action === "call_prep" && onDay(h.at, day)))) {
      summary.callsBooked += 1;
    }
    if (history.some((h) => h.action === "autonomy_paused" && onDay(h.at, day))) summary.paused = true;
    const openReview = history.some((h) => h.action === "autonomy_escalate") && !history.some((h) => h.action === "owner_reviewed");
    if (openReview) summary.needsYou.push("Unclear reply needs a look");
  }
  if (summary.paused) summary.needsYou.unshift("Sending is paused to protect the inbox");
  if (summary.callsBooked) summary.needsYou.push(`${summary.callsBooked} upcoming call${summary.callsBooked === 1 ? "" : "s"}`);
  return summary;
}
