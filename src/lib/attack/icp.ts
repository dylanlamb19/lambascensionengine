import { newUid } from "../prospects/ids.ts";
import { defaultAngle, defaultOffer, emptyEconomics, icpFor } from "./icp-core.ts";
import { plainIndustrySummary } from "./parse-brief.ts";
import type { IndustryAttack } from "./types.ts";

export { defaultAngle, defaultOffer, emptyEconomics, icpFor };
export { parseIndustryAsk } from "./parse-ask.ts";

export function createAttack(opts: {
  industry: string;
  geography: string;
  count?: number;
  spoken: string;
}): IndustryAttack {
  const now = new Date().toISOString();
  const industry = opts.industry.trim();
  const geography = (opts.geography || "").trim();
  const icp = icpFor(industry, geography);
  return {
    id: newUid(),
    industry,
    geography,
    target_count: Math.min(50, Math.max(5, Math.floor(opts.count || 50))),
    status: "researching",
    spoken: opts.spoken,
    offer: defaultOffer(industry),
    outreach_angle: defaultAngle(industry),
    icp,
    economics: emptyEconomics(),
    claims: [
      { label: "Industry", value: industry, kind: "VERIFIED", source: "Owner request" },
      { label: "Geography", value: geography || "UNKNOWN until you name a market", kind: geography ? "VERIFIED" : "UNKNOWN", source: "Owner request" },
    ],
    research_notes: "",
    plain_summary: plainIndustrySummary(industry, geography, ""),
    sources: [],
    created_at: now,
    updated_at: now,
  };
}
