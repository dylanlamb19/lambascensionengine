import type { Prospect } from "../review-brief.ts";
import { applyAttackFields, priorityFor, unknownEconomics } from "./priority.ts";
import { hypothesesFor } from "./hypotheses.ts";
import type { GetClientsBriefing, GetClientsItem, ProspectPriority } from "./types.ts";

const SKIP_STAGES = new Set(["Do Not Contact", "Won", "Lost"]);

function rank(priority: ProspectPriority, stage: string, research: string): number {
  if (stage === "Replied") return 0;
  if (stage === "Call Booked") return 1;
  if (stage === "Proposal Sent" || stage === "Negotiation") return 2;
  if (stage === "Approved for Outreach") return 3;
  if (priority === "STRONG CANDIDATE FOR OUTREACH") return 4;
  if (priority === "WORTH REVIEWING") return 5;
  if (priority === "NEEDS MORE RESEARCH" || research === "none" || research === "queued") return 6;
  if (priority === "LOW PRIORITY") return 7;
  return 8;
}

export function inAttack(p: Prospect, attackId: string | null | undefined): boolean {
  if (!attackId) return true;
  return p.attack_id === attackId;
}

export function queueProspects(rows: Prospect[], attackId?: string | null): Prospect[] {
  return rows
    .filter((p) => !p.suppressed && !SKIP_STAGES.has(p.stage) && !p.get_clients_skipped)
    .filter((p) => inAttack(p, attackId))
    .map(applyAttackFields)
    .sort((a, b) => {
      const pa = priorityFor(a).priority;
      const pb = priorityFor(b).priority;
      const d = rank(pa, a.stage, a.research_status) - rank(pb, b.stage, b.research_status);
      if (d !== 0) return d;
      return (b.score || 0) - (a.score || 0);
    });
}

export function toQueueItem(p: Prospect): GetClientsItem {
  const enriched = applyAttackFields(p);
  const pri = priorityFor(enriched);
  return {
    uid: enriched.uid || "",
    name: enriched.name,
    priority: pri.priority,
    why: (enriched.priority_why || pri.why).slice(0, 4),
    codes: hypothesesFor(enriched).map((h) => h.code),
    unknown: unknownEconomics(enriched),
    stage: enriched.stage,
    research_status: enriched.research_status,
  };
}

export function briefingFor(rows: Prospect[], attackId?: string | null): GetClientsBriefing {
  const scoped = attackId ? rows.filter((p) => inAttack(p, attackId)) : rows;
  const live = scoped.filter((p) => !p.suppressed && p.stage !== "Do Not Contact");
  const items = queueProspects(rows, attackId).map(toQueueItem);
  const researched = live.filter((p) => ["complete", "partial", "blocked", "failed"].includes(p.research_status)).length;
  const attention = items.filter((i) => i.priority === "STRONG CANDIDATE FOR OUTREACH" || i.priority === "WORTH REVIEWING").length;
  const outreachReady = live.filter((p) => p.stage === "Approved for Outreach").length;
  const replies = live.filter((p) => p.stage === "Replied").length;
  const calls = live.filter((p) => p.stage === "Call Booked").length;
  const found = live.length;
  const spoken = found
    ? `I found ${found} compan${found === 1 ? "y" : "ies"}. I researched ${researched}. ${attention} look worth your attention. ${outreachReady} already have outreach ready.`
    : "No companies in this attack yet. Build a target list, or add a company you already know.";
  return { found, researched, attention, outreachReady, replies, calls, spoken, items };
}

export function recommendContact(p: Prospect): string {
  const hy = hypothesesFor(p);
  const pitch = hy.find((h) => h.code !== "NO CLEAR OPPORTUNITY YET");
  if (p.research_status !== "complete" && p.research_status !== "partial") {
    return "Research them before you contact. We do not have a verified public observation yet.";
  }
  if (!pitch) {
    return "No clear public gap. You can still contact them, but do not invent a compliment or a problem.";
  }
  return `Contact them and use the ${pitch.title.toLowerCase()} angle — only what we actually saw.`;
}
