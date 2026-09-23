export type LifeStage =
  | "FOUND"
  | "RESEARCHED"
  | "QUALIFIED"
  | "READY_FOR_OUTREACH"
  | "CONTACTED"
  | "FOLLOW_UP"
  | "REPLIED"
  | "INTERESTED"
  | "BOOKED"
  | "SHOWED"
  | "NO_SHOW"
  | "FOLLOW_UP_NEEDED"
  | "WON"
  | "LOST"
  | "DO_NOT_CONTACT";

export type SalesOutcome = "" | "SHOWED" | "NO_SHOW" | "FOLLOW_UP_NEEDED" | "WON" | "LOST";
export type BillingType = "" | "one-time" | "monthly";
export type LostReason = "" | "Too expensive" | "Not ready" | "No fit" | "Went with competitor" | "No decision" | "Other";

export type OutcomeProspect = {
  name?: string;
  stage?: string;
  suppressed?: boolean;
  research_status?: string;
  meeting_at?: string;
  meeting_event_id?: string;
  sales_outcome?: SalesOutcome;
  client_value?: number | null;
  billing_type?: BillingType;
  lost_reason?: LostReason;
  outcome_note?: string;
  follow_up_at?: string;
  follow_up_reason?: string;
  call_notes?: { recommended?: string; desired?: string; notes?: string; nextStep?: string };
  client_record?: {
    company: string;
    contact: string;
    service: string;
    price: number | null;
    billing: string;
    startDate: string;
    notes: string;
    expectations: string;
    nextAction: string;
  };
  history?: { at?: string; action?: string; detail?: string }[];
};

const LOST_REASONS = new Set(["", "Too expensive", "Not ready", "No fit", "Went with competitor", "No decision", "Other"]);

export function lifecycle(p: OutcomeProspect): LifeStage {
  if (p.suppressed || p.stage === "Do Not Contact") return "DO_NOT_CONTACT";
  if (p.sales_outcome === "WON" || p.stage === "Won") return "WON";
  if (p.sales_outcome === "LOST" || p.stage === "Lost") return "LOST";
  if (p.sales_outcome === "FOLLOW_UP_NEEDED") return "FOLLOW_UP_NEEDED";
  if (p.sales_outcome === "SHOWED") return "SHOWED";
  if (p.sales_outcome === "NO_SHOW") return "NO_SHOW";
  if (p.stage === "Call Booked" || (p.history || []).some((h) => h.action === "meeting_booked")) return "BOOKED";
  const text = (p.history || []).map((h) => `${h.action || ""} ${h.detail || ""}`).join(" ");
  if (/INTERESTED|WANTS_AUDIT|BOOKING_REQUEST/.test(text)) return "INTERESTED";
  if (p.stage === "Replied" || /reply|autonomy_replied/.test(text)) return "REPLIED";
  if (p.stage === "Contacted" && /followup/.test(text)) return "FOLLOW_UP";
  if (p.stage === "Contacted" || /autonomy_sent|email_sent/.test(text)) return "CONTACTED";
  if (p.stage === "Approved for Outreach" || /outreach_generated/.test(text)) return "READY_FOR_OUTREACH";
  if (p.stage === "Qualified" || /autonomy_disqualified/.test(text) === false && (p.research_status === "complete" || p.research_status === "partial") && p.stage === "Qualified") return "QUALIFIED";
  if (p.research_status === "complete" || p.research_status === "partial") return "RESEARCHED";
  return "FOUND";
}

function stamp<T extends OutcomeProspect>(p: T, action: string, detail: string): T {
  return { ...p, history: [...(p.history || []), { at: new Date().toISOString(), action, detail }] };
}

export function meetingIsPast(meetingAt: string | undefined, now: Date): boolean {
  if (!meetingAt) return true;
  const t = new Date(meetingAt).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= now.getTime();
}

export function markCallOutcome<T extends OutcomeProspect>(p: T, outcome: "SHOWED" | "NO_SHOW", now: Date): { ok: true; prospect: T } | { ok: false; reason: string } {
  if (p.sales_outcome === outcome) return { ok: true, prospect: p };
  const life = lifecycle(p);
  if (life !== "BOOKED" && life !== "NO_SHOW") return { ok: false, reason: "There is no booked call to mark." };
  if (!meetingIsPast(p.meeting_at, now)) return { ok: false, reason: "That call has not happened yet." };
  const next = stamp({ ...p, sales_outcome: outcome }, outcome === "SHOWED" ? "showed" : "no_show", outcome === "SHOWED" ? "They showed. No new cold email." : "No-show. Cold outreach stays off. They can rebook.");
  return { ok: true, prospect: next };
}

export function markRescheduleWaiting<T extends OutcomeProspect>(p: T): { ok: true; prospect: T } | { ok: false; reason: string } {
  if (p.sales_outcome !== "NO_SHOW") return { ok: false, reason: "Reschedule is only for a no-show. A new cold sequence was not started." };
  if ((p.history || []).some((h) => h.action === "reschedule_waiting")) return { ok: true, prospect: p };
  return { ok: true, prospect: stamp(p, "reschedule_waiting", "Waiting for them to rebook. No cold email will be sent.") };
}

export function markSalesOutcome<T extends OutcomeProspect>(p: T, input: {
  outcome: "WON" | "LOST" | "FOLLOW_UP_NEEDED";
  clientValue?: number | null;
  billing?: BillingType;
  note?: string;
  lostReason?: string;
  followUpAt?: string;
  followUpReason?: string;
}): { ok: true; prospect: T } | { ok: false; reason: string } {
  if (lifecycle(p) !== "SHOWED" && p.sales_outcome !== "FOLLOW_UP_NEEDED") {
    return { ok: false, reason: "Mark that they showed before recording won, lost, or follow-up." };
  }
  if (input.outcome === "WON") {
    const value = input.clientValue;
    const hasValue = typeof value === "number" && Number.isFinite(value) && value >= 0;
    const billing = input.billing === "one-time" || input.billing === "monthly" ? input.billing : "";
    const next = stamp({
      ...p,
      stage: "Won",
      stage_plain: "Signed client",
      sales_outcome: "WON" as SalesOutcome,
      client_value: hasValue ? value : null,
      billing_type: billing,
      outcome_note: (input.note || "").slice(0, 500),
      client_record: {
        company: p.name || "",
        contact: "",
        service: p.call_notes?.recommended || "Not chosen on the call",
        price: hasValue ? (value as number) : null,
        billing,
        startDate: new Date().toISOString().slice(0, 10),
        notes: p.call_notes?.notes || input.note || "",
        expectations: p.call_notes?.desired || "",
        nextAction: p.call_notes?.nextStep || "Send the agreement and book onboarding.",
      },
    }, "sales_won", hasValue ? `Won. Value entered: ${value} ${billing || "billing not set"}.` : "Won. Revenue left UNKNOWN until you enter it.");
    return { ok: true, prospect: next as T };
  }
  if (input.outcome === "LOST") {
    const reason = LOST_REASONS.has(input.lostReason || "") ? (input.lostReason as LostReason) || "" : "";
    const next = stamp({
      ...p,
      stage: "Lost",
      stage_plain: "Not moving forward",
      sales_outcome: "LOST" as SalesOutcome,
      lost_reason: reason,
      client_value: null,
      outcome_note: (input.note || "").slice(0, 500),
    }, "sales_lost", reason ? `Lost. ${reason}.` : "Lost. No reason given.");
    return { ok: true, prospect: next as T };
  }
  const next = stamp({
    ...p,
    sales_outcome: "FOLLOW_UP_NEEDED" as SalesOutcome,
    outcome_note: (input.note || "").slice(0, 500),
    follow_up_at: input.followUpAt || p.follow_up_at || "",
    follow_up_reason: (input.followUpReason || "").slice(0, 200),
  }, "follow_up_needed", "Needs a decision from you. No automatic cold email.");
  return { ok: true, prospect: next as T };
}

export function knownRevenue(rows: { client_value?: number | null; sales_outcome?: string; billing_type?: string }[]): { amount: number | null; monthly: number; once: number } {
  let amount = 0;
  let monthly = 0;
  let once = 0;
  let any = false;
  for (const row of rows) {
    if (row.sales_outcome !== "WON") continue;
    if (typeof row.client_value !== "number") continue;
    any = true;
    amount += row.client_value;
    if (row.billing_type === "monthly") monthly += row.client_value;
    if (row.billing_type === "one-time") once += row.client_value;
  }
  return { amount: any ? amount : null, monthly, once };
}

export type LearnSlice = { key: string; bookings: number; wins: number; revenue: number | null };

export function learningSlices(rows: {
  vertical?: string;
  city?: string;
  sales_outcome?: string;
  client_value?: number | null;
  stage?: string;
  history?: { action?: string; detail?: string }[];
  opportunity?: string;
  angle?: string;
  subject?: string;
}[]): { industry: LearnSlice[]; tooSmall: boolean } {
  const map = new Map<string, LearnSlice>();
  let decided = 0;
  for (const row of rows) {
    const booked = row.stage === "Call Booked" || row.sales_outcome === "SHOWED" || row.sales_outcome === "WON" || row.sales_outcome === "NO_SHOW" || row.sales_outcome === "LOST" || (row.history || []).some((h) => h.action === "meeting_booked");
    const won = row.sales_outcome === "WON" || row.stage === "Won";
    if (booked || won) decided += 1;
    const key = (row.vertical || "Unknown").trim() || "Unknown";
    const cur = map.get(key) || { key, bookings: 0, wins: 0, revenue: null };
    if (booked) cur.bookings += 1;
    if (won) {
      cur.wins += 1;
      if (typeof row.client_value === "number") cur.revenue = (cur.revenue || 0) + row.client_value;
    }
    map.set(key, cur);
  }
  return { industry: [...map.values()], tooSmall: decided < 8 };
}
