import { importantFindings, type Prospect } from "../review-brief.ts";
import { hypothesesFor } from "./hypotheses.ts";
import { unknownEconomics } from "./priority.ts";
import type { CallPrepDoc, IcpConfig } from "./types.ts";

const DEFAULT_OBJECTIONS = [
  "We already have an agency.",
  "We’re not spending on ads right now.",
  "Send a price first.",
  "We’re too busy / call back next quarter.",
];

export function callPrep(p: Prospect, icp?: IcpConfig | null): CallPrepDoc {
  const found = importantFindings(p);
  const hy = hypothesesFor(p);
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const ads = p.ads || [];
  const questions = icp?.questions_to_verify?.length
    ? icp.questions_to_verify
    : [
      "What is an average new customer worth?",
      "How many leads become customers?",
      "What are you currently spending on advertising?",
      "Where are leads getting lost?",
      "What would 10 additional customers/month be worth?",
    ];

  const know: string[] = [];
  know.push(`${p.name} is a ${p.vertical || "company"}${p.city ? ` in ${p.city}` : ""}.`);
  if (p.website && p.website !== "UNKNOWN") know.push(`Public website: ${p.website}.`);
  if (p.phone && p.phone !== "UNKNOWN") know.push(`Public phone: ${p.phone}.`);
  if (named.length) know.push(`Named contact on file: ${named.map((c) => c.name).join(", ")}.`);
  else know.push("Named decision-maker: UNKNOWN.");
  for (const f of found.slice(0, 6)) know.push(`${f.label}: ${f.plain}`);

  const marketing: string[] = [];
  if (ads.length) {
    for (const a of ads) marketing.push(`${a.network}: ${a.label}. ${a.detail}`);
  } else {
    marketing.push("No advertising observation on file. That is not proof they do not advertise.");
  }

  const pitch = hy.find((h) => h.code !== "NO CLEAR OPPORTUNITY YET");

  return {
    company: p.name,
    what_we_know: know,
    why_contacted: pitch
      ? `We contacted them because of a verified public observation: ${pitch.title.toLowerCase()}.`
      : "We contacted them as a possible fit in this industry. We did not invent a problem.",
    marketing,
    opportunities: hy.map((h) => `${h.code}: ${h.plain}`),
    unknown_economics: unknownEconomics(p),
    questions,
    objections: DEFAULT_OBJECTIONS,
    offer: "Help them get more of the right customers. Management fee is separate from ad spend. Do not name a price until they share economics.",
    next_step: "Ask the first economics questions. Do not pitch a package until they answer.",
  };
}
