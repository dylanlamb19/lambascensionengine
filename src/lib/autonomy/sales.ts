export type CallNotes = {
  problem?: string;
  leadSource?: string;
  leadVolume?: string;
  customerValue?: string;
  tried?: string;
  frustration?: string;
  desired?: string;
  timeline?: string;
  budget?: string;
  decisionMaker?: string;
  objections?: string;
  recommended?: string;
  nextStep?: string;
  notes?: string;
};

export type SalesInput = {
  company: string;
  contact?: string;
  website?: string;
  vertical?: string;
  city?: string;
  gaps?: string[];
  angle?: string;
  replySummary?: string;
  emailsSent?: number;
  researchDone?: boolean;
  offerName?: string;
  offerWhy?: string;
  notes?: CallNotes;
};

const GAP_QUESTION: Record<string, string> = {
  NO_HOMEPAGE_FORM: "Someone who is not ready to call — where do they leave their info today?",
  NO_HOMEPAGE_CTA: "What is the first thing you want a visitor to do?",
  NO_CLICK_TO_CALL: "How many people call versus filling something out?",
  NO_TRACKING: "Can you tell which page or ad actually turns into a job?",
  SLOW_MOBILE: "How often are customers finding you on a phone?",
  testimonials: "Where do new customers see proof before they reach out?",
};

const BASE = [
  "How are you getting customers right now?",
  "What have you already tried?",
  "When a lead comes in, what happens next?",
  "What is one new customer worth to you?",
  "Where does this break down most — the lead, the follow-up, or the close?",
  "What would have to be true for this to be worth doing?",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function discoveryQuestions(input: SalesInput): string[] {
  const gaps = input.gaps || [];
  const specific = gaps.map((g) => GAP_QUESTION[g]).filter(Boolean);
  const start = hash(input.company || "x") % BASE.length;
  const rotated = [...BASE.slice(start), ...BASE.slice(0, start)];
  const picked = [...specific, ...rotated];
  const unique: string[] = [];
  for (const q of picked) {
    if (!unique.includes(q)) unique.push(q);
    if (unique.length >= 8) break;
  }
  return unique;
}

export function callGuide(input: SalesInput): string[] {
  const finding = (input.gaps || [])[0] ? `the gap we actually saw (${input.gaps![0]})` : "what we verified, and nothing past that";
  return [
    `Intro — You looked at ${input.company}. Mention ${finding}. Do not praise them generically.`,
    "Discovery — Ask how they get customers before you explain anything.",
    "Problem — Stay on the one gap. Do not pile on minor website issues.",
    "Current process — Ask what happens after the inquiry. Do not assume they have no follow-up.",
    "Impact — Ask what a missed inquiry costs them. Do not state their revenue or ad spend.",
    "Desired outcome — Ask what they want more of in the next few months.",
    "Recommendation — Only name Acquire, Convert, or System if the notes and research support it. Otherwise say you need a little more.",
    "Next step — Proposal, another call, or no. You decide. Do not discount or promise results.",
  ];
}

export function salesBrief(input: SalesInput): string {
  const notes = input.notes || {};
  const gaps = (input.gaps || []).filter(Boolean);
  const unknowns = ["Revenue", "Ad spend", "Lead volume", "Close rate", "Budget", "Team size"].filter((u) => {
    if (u === "Lead volume" && notes.leadVolume) return false;
    if (u === "Budget" && notes.budget) return false;
    return true;
  });
  return [
    input.company,
    input.contact ? `Contact: ${input.contact}` : "Contact: not on file",
    input.website && input.website !== "UNKNOWN" ? `Website: ${input.website}` : "Website: unknown",
    `Sells: ${input.vertical || "Unknown"}${input.city ? ` in ${input.city}` : ""}.`,
    "Who they sell to: not verified unless they say so on the call.",
    gaps.length ? `Verified gaps: ${gaps.join(", ")}.` : "Verified gaps: none stored. Do not invent one.",
    input.researchDone ? "Qualified because research found a real acquisition gap and a way to reach them." : "Research is thin. Do not treat them as fully qualified.",
    input.angle ? `Outreach angle: ${input.angle}` : "Outreach angle: not stored.",
    input.replySummary ? `Replies: ${input.replySummary}` : "Replies: none stored.",
    `Emails sent: ${input.emailsSent || 0}.`,
    notes.problem ? `They said the problem is: ${notes.problem}` : "Likely problem: only the verified gap above. Impact is unknown until you ask.",
    input.offerName && input.offerName !== "Unknown" ? `Possible fit: ${input.offerName}. ${input.offerWhy || ""}` : "Offer: more discovery needed before naming a package.",
    `Still unknown: ${unknowns.join(", ")}.`,
  ].join("\n");
}

export function recommendService(input: SalesInput): { name: "Acquire" | "Convert" | "System" | "MORE DISCOVERY NEEDED"; why: string } {
  const notes = input.notes || {};
  const gaps = input.gaps || [];
  const funnel = gaps.some((g) => ["NO_HOMEPAGE_FORM", "NO_HOMEPAGE_CTA", "NO_CLICK_TO_CALL"].includes(g));
  const tracking = gaps.includes("NO_TRACKING");
  if (!input.researchDone && !notes.problem && !notes.frustration) {
    return { name: "MORE DISCOVERY NEEDED", why: "Research and call notes are too thin to name a service." };
  }
  if (funnel && tracking && /whole|everything|system/i.test(`${notes.desired || ""} ${notes.recommended || ""}`)) {
    return { name: "System", why: "The site is weak on both inquiries and tracking, and they asked for the whole path. Still not a price." };
  }
  if (funnel || /form|website|inquir/i.test(notes.problem || "")) {
    return { name: "Convert", why: "The verified problem is turning attention into an inquiry. Convert fits that. Do not add ads unless they ask." };
  }
  if (input.offerName === "Acquire" || input.offerName === "Convert" || input.offerName === "System") {
    return { name: input.offerName, why: input.offerWhy || "This matches the stored research. It is not a promise they will buy." };
  }
  if (notes.problem) {
    return { name: "MORE DISCOVERY NEEDED", why: "They described a problem, but it does not map cleanly to Acquire, Convert, or System yet." };
  }
  return { name: "MORE DISCOVERY NEEDED", why: "Not enough to recommend a service." };
}

export function followupDraft(input: SalesInput): string {
  const notes = input.notes || {};
  const hi = input.contact && input.contact !== "UNKNOWN" ? input.contact.split(" ")[0] : "there";
  const heard = notes.problem || notes.frustration || "";
  const next = notes.nextStep || "";
  const gap = (input.gaps || [])[0] || "";
  const lines = [`Hi ${hi},`, "", `Thanks for the time on ${input.company}.`];
  if (heard) lines.push("", `You mentioned ${heard}.`);
  else if (gap) lines.push("", `The only piece I had going in was ${gap}. I am not adding anything we did not cover.`);
  else lines.push("", "I am not going to add findings we did not actually cover.");
  if (next) lines.push("", `Next step on my side: ${next}.`);
  else lines.push("", "If you want, I can send a short written version of what we discussed. I will not turn that into a proposal until you ask.");
  lines.push("", "Dylan", "Lamb Ascension");
  return lines.join("\n");
}

export function proposalDraft(input: SalesInput & { price?: number | null; billing?: string }): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof input.price !== "number" || !Number.isFinite(input.price) || input.price < 0) {
    return { ok: false, reason: "Enter a price first. A proposal was not written." };
  }
  const notes = input.notes || {};
  const rec = recommendService(input);
  const billing = input.billing === "monthly" || input.billing === "one-time" ? input.billing : "billing not set";
  const text = [
    input.company,
    `Problem: ${notes.problem || "Only the verified research gap. Nothing added."}`,
    `What we found: ${(input.gaps || []).join(", ") || "No verified gap stored."}`,
    `What they want: ${notes.desired || "Not stated on the call."}`,
    `Recommendation: ${rec.name}. ${rec.why}`,
    "Scope: the service above, nothing beyond what was discussed.",
    "Lamb Ascension handles the agreed work. The client provides access, offers, and a person who can answer questions.",
    `Price entered by you: $${input.price.toLocaleString()} (${billing}).`,
    notes.timeline ? `Timing they mentioned: ${notes.timeline}.` : "No timeline was agreed. None is promised.",
    "No guaranteed lead counts, revenue, or rankings.",
    "Next step: you review this, then send it yourself if you want.",
  ].join("\n");
  return { ok: true, text };
}

export type ClientRecord = {
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

export function clientRecord(input: SalesInput & { price?: number | null; billing?: string; startDate: string }): ClientRecord {
  const notes = input.notes || {};
  return {
    company: input.company,
    contact: input.contact || "",
    service: notes.recommended || recommendService(input).name,
    price: typeof input.price === "number" ? input.price : null,
    billing: input.billing || "",
    startDate: input.startDate,
    notes: notes.notes || "",
    expectations: notes.desired || "",
    nextAction: notes.nextStep || "Send the agreement and book onboarding.",
  };
}
