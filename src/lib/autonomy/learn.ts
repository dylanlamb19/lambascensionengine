export type LearnRow = {
  vertical?: string;
  stage?: string;
  history?: { action?: string; detail?: string }[];
};

const POSITIVE = /INTERESTED|WANTS_AUDIT|BOOKING|meeting_booked|Call Booked|Won/;

/** Nudge only after 8 sends in that industry. Tiny samples do not change who we contact. */
export function industryNudge(rows: LearnRow[], vertical: string): number {
  const key = vertical.trim().toLowerCase();
  if (!key) return 0;
  let sent = 0;
  let good = 0;
  for (const row of rows) {
    if ((row.vertical || "").trim().toLowerCase() !== key) continue;
    const sentThis = (row.history || []).some((h) => h.action === "autonomy_sent" || h.action === "email_sent");
    if (!sentThis && row.stage !== "Contacted" && row.stage !== "Replied" && row.stage !== "Call Booked" && row.stage !== "Won") continue;
    sent += 1;
    const text = `${row.stage || ""} ${(row.history || []).map((h) => `${h.action || ""} ${h.detail || ""}`).join(" ")}`;
    if (POSITIVE.test(text) || row.stage === "Call Booked" || row.stage === "Won" || row.stage === "Replied") good += 1;
  }
  if (sent < 8) return 0;
  const rate = good / sent;
  if (rate >= 0.25) return 8;
  if (rate === 0) return -6;
  return 0;
}
