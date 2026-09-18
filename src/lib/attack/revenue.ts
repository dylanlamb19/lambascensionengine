import type { Prospect } from "../review-brief.ts";
import type { OwnerGoal, RevenueLane, RevenueSnapshot } from "./types.ts";

export function revenueLane(stage: string): RevenueLane | null {
  if (stage === "New" || stage === "Researching") return "researching";
  if (stage === "Qualified" || stage === "Ready for Review" || stage === "Approved for Outreach") return "ready";
  if (stage === "Contacted") return "contacted";
  if (stage === "Replied") return "replied";
  if (stage === "Call Booked") return "calls";
  if (stage === "Proposal Sent" || stage === "Negotiation") return "proposals";
  if (stage === "Won") return "won";
  if (stage === "Lost") return "lost";
  return null;
}

export function isQualified(p: Prospect): boolean {
  const d = p.discovery || {};
  return Boolean(d.customer_value || d.monthly_ad_budget || d.close_rate);
}

/** VERIFIED MRR = Won clients with an owner-entered monthly fee. Never inferred. */
export function verifiedMrr(rows: Prospect[]): number {
  let sum = 0;
  for (const p of rows) {
    if (p.stage !== "Won") continue;
    const fee = p.monthly_fee;
    if (typeof fee === "number" && Number.isFinite(fee) && fee > 0) sum += fee;
  }
  return sum;
}

export function clientsNeeded(goal: OwnerGoal): number | null {
  const m = goal.monthly_mrr_target;
  const a = goal.average_retainer_target;
  if (!m || !a || m <= 0 || a <= 0) return null;
  return Math.ceil(m / a);
}

export function revenueSnapshot(rows: Prospect[], goal: OwnerGoal = { monthly_mrr_target: null, average_retainer_target: null }): RevenueSnapshot {
  const live = rows.filter((p) => !p.suppressed);
  const counts: Omit<RevenueSnapshot, "verified_mrr" | "clients_needed" | "goal"> = {
    researching: 0,
    ready: 0,
    contacted: 0,
    replied: 0,
    qualified: 0,
    calls: 0,
    proposals: 0,
    won: 0,
    lost: 0,
  };
  for (const p of live) {
    const lane = revenueLane(p.stage);
    if (lane && lane in counts) counts[lane] += 1;
    if (isQualified(p) && p.stage !== "Won" && p.stage !== "Lost" && p.stage !== "Do Not Contact") {
      counts.qualified += 1;
    }
  }
  return {
    ...counts,
    verified_mrr: verifiedMrr(live),
    clients_needed: clientsNeeded(goal),
    goal,
  };
}

export function moneyLabel(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
