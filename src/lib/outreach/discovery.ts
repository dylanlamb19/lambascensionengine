import type { DiscoveryAnswers, ValueFit } from "./types.ts";

function money(raw?: string): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function qualifyValueOffer(a: DiscoveryAnswers): { fit: ValueFit; why: string[]; unknown: string[] } {
  const why: string[] = [];
  const unknown: string[] = [];
  const value = money(a.customer_value);
  const budget = money(a.monthly_ad_budget);
  const filled = Object.values(a).filter((v) => v && String(v).trim()).length;

  if (value != null) why.push(`CLIENT-PROVIDED average customer/client value: about $${value.toLocaleString()}.`);
  else unknown.push("Average customer/client value");
  if (budget != null) why.push(`CLIENT-PROVIDED monthly ad budget: about $${budget.toLocaleString()}.`);
  else unknown.push("Monthly advertising budget");
  if (a.capacity) why.push(`CLIENT-PROVIDED capacity: ${a.capacity}.`);
  else unknown.push("How many new customers they can handle");
  if (a.current_channels) why.push(`CLIENT-PROVIDED channels: ${a.current_channels}.`);
  else unknown.push("Current acquisition channels");
  if (a.close_rate) why.push(`CLIENT-PROVIDED close rate: ${a.close_rate}.`);
  else unknown.push("Close rate");
  if (a.lead_handling) why.push(`CLIENT-PROVIDED lead handling: ${a.lead_handling}.`);
  else unknown.push("What happens after a lead comes in");

  if (filled === 0) {
    return { fit: "NEED MORE INFORMATION", why: ["No discovery answers yet. Looking successful online is not enough."], unknown };
  }
  if (value != null && value < 500) {
    return { fit: "NOT A FIT", why: [...why, "Customer value is too low for a $2,500–$10,000/month retainer."], unknown };
  }
  if (value != null && value >= 8000 && (budget == null || budget >= 3000) && a.capacity) {
    return { fit: "HIGH-VALUE OFFER MAY MAKE SENSE", why: [...why, "This is still not a promise they will pay $10K. It only means the economics they described could support a high-ticket conversation."], unknown };
  }
  if (value != null && value >= 2000) {
    return { fit: "STANDARD OFFER MAY FIT BETTER", why: [...why, "Economics may support Acquire/Convert before a $10K system."], unknown };
  }
  return { fit: "NEED MORE INFORMATION", why: [...why, "Ask the remaining questions before labeling this a high-value retainer."], unknown };
}

export const DISCOVERY_QUESTIONS = [
  "How are you currently getting customers?",
  "What channels are working?",
  "What is your average customer/client value?",
  "What happens after a lead comes in?",
  "How many new customers can you realistically handle?",
  "Are you currently running Google or Meta Ads?",
  "What monthly advertising budget are you comfortable deploying?",
  "What would make a marketing partnership successful for you?",
];
