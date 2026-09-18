import type { Prospect } from "../review-brief.ts";
import { hypothesesFor } from "./hypotheses.ts";
import type { OpportunityCode, PriorityResult, ProspectPriority } from "./types.ts";

const UNKNOWN_DEFAULT = [
  "Average customer / case value",
  "Close rate",
  "Advertising budget",
  "Whether a meaningful retainer makes sense",
];

export function unknownEconomics(p: Prospect): string[] {
  const extra: string[] = [];
  const d = p.discovery || {};
  const out = UNKNOWN_DEFAULT.filter((label) => {
    if (label.startsWith("Average") && d.customer_value) return false;
    if (label.startsWith("Close") && d.close_rate) return false;
    if (label.startsWith("Advertising") && d.monthly_ad_budget) return false;
    return true;
  });
  if (!p.website || p.website === "UNKNOWN") extra.push("Whether they have a working website");
  return [...out, ...extra];
}

/** Explainable priority. No opaque AI score. */
export function priorityFor(p: Prospect): PriorityResult {
  if (p.suppressed || p.stage === "Do Not Contact") {
    return { priority: "DO NOT CONTACT", why: ["Already marked Do Not Contact."] };
  }
  if (p.stage === "Lost") {
    return { priority: "DO NOT CONTACT", why: ["Marked Lost. Do not reopen outreach from Get Clients."] };
  }

  const why: string[] = [];
  const researched = p.research_status === "complete" || p.research_status === "partial";
  const hy = hypothesesFor(p);
  const useful = hy.filter((h) => h.code !== "NO CLEAR OPPORTUNITY YET");
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const adsOn = (p.ads || []).some((a) => a.label === "ADVERTISING DETECTED");

  if (p.vertical) why.push(`${p.name} is a ${p.vertical} company${p.city ? ` in ${p.city}` : ""}.`);
  if (p.website && p.website !== "UNKNOWN") why.push("Public website is on file.");
  if (adsOn) why.push("Public advertising observation is on file (not proof of spend or waste).");
  if (useful.length) why.push(`${useful.length} evidence-grounded opportunit${useful.length === 1 ? "y" : "ies"} from pages we actually checked.`);
  if (named.length) why.push(`A named contact is on file: ${named[0].name}.`);
  if (p.review_count > 0) why.push(`${p.review_count} public reviews — a demand signal, not a requirement and not revenue.`);

  if (!researched && p.research_status !== "blocked" && p.research_status !== "failed") {
    return {
      priority: "NEEDS MORE RESEARCH",
      why: why.length ? why.concat(["We have not finished a website review."]) : ["We have not opened their website yet."],
    };
  }

  if (p.readiness === "LOW PRIORITY") {
    return { priority: "LOW PRIORITY", why: why.concat(p.readiness_why || ["Research classed this as low priority."]) };
  }

  if (p.research_status === "blocked" || p.research_status === "failed") {
    return {
      priority: "NEEDS MORE RESEARCH",
      why: why.concat(["Website research did not finish. We did not invent findings."]),
    };
  }

  const strongReadiness = p.readiness === "STRONG CANDIDATE FOR FURTHER QUALIFICATION";
  const hasPitch = useful.length >= 1 && useful[0].code !== "NO CLEAR OPPORTUNITY YET";
  const mature = Boolean(p.website && p.website !== "UNKNOWN") && (adsOn || named.length || p.review_count >= 20 || strongReadiness);

  if ((strongReadiness && hasPitch) || (hasPitch && mature && named.length)) {
    return {
      priority: "STRONG CANDIDATE FOR OUTREACH",
      why: why.slice(0, 4),
    };
  }

  if (hasPitch || strongReadiness || p.readiness === "POSSIBLE CANDIDATE") {
    return {
      priority: "WORTH REVIEWING",
      why: why.slice(0, 4),
    };
  }

  if (p.readiness === "NOT ENOUGH INFORMATION" || !researched) {
    return { priority: "NEEDS MORE RESEARCH", why: why.concat(["Not enough verified public facts yet."]) };
  }

  return { priority: "LOW PRIORITY", why: why.concat(["No clear public opportunity, and we will not invent one."]) };
}

export function applyAttackFields(p: Prospect): Prospect {
  const hy = hypothesesFor(p);
  const pri = priorityFor(p);
  return {
    ...p,
    opportunity_codes: hy.map((h) => h.code) as OpportunityCode[],
    priority: pri.priority,
    priority_why: pri.why,
  };
}
