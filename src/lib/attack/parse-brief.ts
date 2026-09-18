import type { Claim } from "./types.ts";
import { emptyEconomics } from "./icp.ts";

const MONEY = /\$\s?[\d,]+(?:\.\d+)?|\b\d+\s?(?:k|thousand|million)\b/i;

/** Web research is REPORTED at best. Never promote a web number to VERIFIED economics. */
export function notesToClaims(summary: string, industry: string): Claim[] {
  const text = (summary || "").trim();
  const claims: Claim[] = [
    {
      label: "Industry",
      value: industry,
      kind: "VERIFIED",
      source: "Owner request",
    },
  ];
  if (!text) {
    claims.push({
      label: "Market economics",
      value: "UNKNOWN — MUST VERIFY ON SALES CALL",
      kind: "UNKNOWN",
    });
    return claims;
  }
  claims.push({
    label: "Public market notes",
    value: text.slice(0, 800),
    kind: "REPORTED",
    source: "Web research — not verified for any specific company",
  });
  if (MONEY.test(text)) {
    claims.push({
      label: "Dollar figures in sources",
      value: "Sources mentioned numbers. Those are REPORTED, not verified, and must not be used as this company’s economics.",
      kind: "REPORTED",
      source: "Web research",
    });
  }
  claims.push({
    label: "This company’s customer value",
    value: "UNKNOWN — MUST VERIFY ON SALES CALL",
    kind: "UNKNOWN",
  });
  return claims;
}

export function industryResearchQuery(industry: string, geography: string): string {
  const geo = geography.trim() || "United States";
  return `${industry} customer acquisition how businesses get customers Google Ads Meta Ads typical sales funnel lead handling ${geo} 2025 2026`;
}

export function plainIndustrySummary(industry: string, geography: string, notes: string): string {
  const geo = geography.trim() ? ` in ${geography.trim()}` : "";
  const hasNotes = Boolean(notes && notes.trim());
  const body = hasNotes
    ? notes.trim().slice(0, 420)
    : "I have the industry on file. Market economics stay UNKNOWN until a company tells us, or a source we can cite. I will not invent customer value or ad spend.";
  return `${industry}${geo} looks like a market worth a targeted list if companies already show marketing maturity. ${body} I would look for companies with a public offer and a way to inquire — then verify economics on the call.`;
}

export { emptyEconomics };
