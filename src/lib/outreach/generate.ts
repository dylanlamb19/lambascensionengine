import { packContext } from "./pack.ts";
import { buildOutreach } from "./deterministic.ts";
import type { Prospect } from "../review-brief.ts";
import type { OutreachPack } from "./types.ts";

export function generateOutreach(p: Prospect): OutreachPack {
  return buildOutreach(packContext(p));
}

export function explainAngle(p: Prospect): string {
  const pack = p.outreach || generateOutreach(p);
  const email = pack.messages.find((m) => m.kind === "email");
  return [
    `Why this outreach angle for ${p.name}?`,
    "",
    email?.angle_why || pack.brief.why,
    "",
    "Verified facts used:",
    ...(email?.evidence_used || []).map((e) => `• ${e}`),
    "",
    "Still UNKNOWN: " + pack.brief.unknown.join("; ") + ".",
    "",
    "This was written from stored research. It is not a claim about revenue, ad spend, or that they already want to buy.",
  ].join("\n");
}
