import type { Prospect } from "../review-brief.ts";
import type { LearningInsight } from "./types.ts";

/** Refuse insights until there is enough real history. Never invent close rates. */
export const LEARNING_MIN = {
  contacted: 20,
  replies: 8,
  calls: 5,
  won: 3,
} as const;

export function outcomeSample(rows: Prospect[]): LearningInsight["sample"] {
  const live = rows.filter((p) => !p.is_demo);
  const contacted = live.filter((p) =>
    ["Contacted", "Replied", "Call Booked", "Proposal Sent", "Negotiation", "Won", "Lost"].includes(p.stage),
  ).length;
  const replies = live.filter((p) =>
    p.stage === "Replied" || p.stage === "Call Booked" || p.stage === "Proposal Sent" || p.stage === "Won"
    || (p.history || []).some((h) => /^reply:/i.test(h.action)),
  ).length;
  const calls = live.filter((p) => p.stage === "Call Booked" || p.stage === "Won" || p.stage === "Proposal Sent").length;
  const won = live.filter((p) => p.stage === "Won").length;
  return { contacted, replies, calls, won };
}

export function learningInsight(rows: Prospect[]): LearningInsight {
  const sample = outcomeSample(rows);
  if (sample.contacted < LEARNING_MIN.contacted) {
    return {
      ready: false,
      sample,
      text: `Not enough real outcomes yet. ${sample.contacted} compan${sample.contacted === 1 ? "y" : "ies"} contacted — Lamb Ascension will not invent a pattern until at least ${LEARNING_MIN.contacted} real contacts.`,
    };
  }
  if (sample.replies < LEARNING_MIN.replies) {
    return {
      ready: false,
      sample,
      text: `${sample.contacted} contacted, ${sample.replies} replies. That is still too few replies to claim which industries or angles work.`,
    };
  }

  const byVertical: Record<string, { contacted: number; replies: number }> = {};
  for (const p of rows.filter((r) => !r.is_demo)) {
    const v = p.vertical || "Other";
    if (!byVertical[v]) byVertical[v] = { contacted: 0, replies: 0 };
    if (["Contacted", "Replied", "Call Booked", "Proposal Sent", "Negotiation", "Won", "Lost"].includes(p.stage)) {
      byVertical[v].contacted += 1;
    }
    if (p.stage === "Replied" || p.stage === "Call Booked" || p.stage === "Won" || (p.history || []).some((h) => /^reply:/i.test(h.action))) {
      byVertical[v].replies += 1;
    }
  }
  const ranked = Object.entries(byVertical)
    .filter(([, n]) => n.contacted >= 8)
    .map(([vertical, n]) => ({ vertical, rate: n.replies / n.contacted, ...n }))
    .sort((a, b) => b.rate - a.rate);
  if (ranked.length < 2) {
    return {
      ready: false,
      sample,
      text: `Observed: ${sample.contacted} contacted, ${sample.replies} replies, ${sample.calls} calls, ${sample.won} won. Not enough industry groups yet to compare.`,
    };
  }
  const top = ranked[0];
  const low = ranked[ranked.length - 1];
  if (top.vertical === low.vertical || top.rate <= low.rate) {
    return {
      ready: true,
      sample,
      text: `Observed: ${sample.contacted} contacted, ${sample.replies} replies, ${sample.won} won. No industry is clearly ahead yet.`,
    };
  }
  return {
    ready: true,
    sample,
    text: `${top.vertical} has been replying more often than ${low.vertical} in your real history (${top.replies}/${top.contacted} vs ${low.replies}/${low.contacted}). This is observed, not a guarantee.`,
  };
}
