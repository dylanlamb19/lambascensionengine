import type { PackedContext } from "./pack.ts";
import type { OutreachPack, OutreachMessage } from "./types.ts";

function has(ctx: PackedContext, code: string): boolean {
  return ctx.opportunities.some((o) => o.code === code) || ctx.facts.some((f) => f.key === code);
}

function greeting(ctx: PackedContext): string {
  if (ctx.contact_name !== "UNKNOWN") return ctx.contact_name.split(" ")[0] || ctx.contact_name;
  return "there";
}

function observation(ctx: PackedContext): { text: string; evidence: string[]; angle: string; why: string } {
  if (has(ctx, "NO_HOMEPAGE_FORM") && has(ctx, "contact_form_inner")) {
    return {
      text: `I opened ${ctx.name}'s homepage and didn’t see a contact form there — a form did show up on an inside page.`,
      evidence: ["NO_HOMEPAGE_FORM", "contact_form_inner"],
      angle: "Homepage makes it harder to inquire than it needs to",
      why: "We verified no homepage form, and a form on an inner page. That’s a specific, checkable reason to talk — not a guess about their revenue.",
    };
  }
  if (has(ctx, "NO_HOMEPAGE_FORM")) {
    return {
      text: `I opened ${ctx.name}'s homepage and did not find a contact form on that page.`,
      evidence: ["NO_HOMEPAGE_FORM"],
      angle: "Homepage inquire path is weak",
      why: "Verified: no contact form on the homepage.",
    };
  }
  if (has(ctx, "NO_HOMEPAGE_CTA")) {
    return {
      text: `On ${ctx.name}'s homepage I didn’t see a clear “get a quote” / estimate ask near the top.`,
      evidence: ["NO_HOMEPAGE_CTA"],
      angle: "Next step isn’t obvious on the first screen",
      why: "Verified: no common quote/estimate CTA in the first content.",
    };
  }
  if (has(ctx, "case_studies") || ctx.facts.some((f) => /case-study/i.test(f.text))) {
    return {
      text: `${ctx.name} publishes case-study / client-story language, which is a different conversation than a local service ad.`,
      evidence: ["case_studies"],
      angle: "Demand-gen for a firm that already shows client work",
      why: "Observed case-study wording on a page we opened. That is wording, not verified contract value.",
    };
  }
  if (has(ctx, "enterprise_language") || ctx.facts.some((f) => /enterprise \/ b2b/i.test(f.text))) {
    return {
      text: `${ctx.name}’s site is written for businesses, not just local consumers.`,
      evidence: ["enterprise_language"],
      angle: "B2B / software acquisition, not a generic local-lead pitch",
      why: "Observed enterprise/B2B wording on a page we opened.",
    };
  }
  if (ctx.research_status === "blocked" || ctx.research_status === "failed") {
    const bits = [`${ctx.name} is a ${ctx.vertical.toLowerCase()} company in ${ctx.city}`];
    if (ctx.reviews) bits.push(`with ${ctx.reviews} public reviews`);
    if (ctx.rating !== "UNKNOWN") bits.push(`and a ${ctx.rating} public rating`);
    return {
      text: bits.join(" ") + ". We could not inspect the website, so I’m not going to pretend I audited the funnel.",
      evidence: ["reviews", "listing"],
      angle: "Public demand signal, website still unknown",
      why: "Website research did not finish. We only use listing facts we already have. We do not invent site problems.",
    };
  }
  if (ctx.reviews >= 80) {
    return {
      text: `${ctx.name} already has ${ctx.reviews} public reviews in ${ctx.city}.`,
      evidence: ["reviews"],
      angle: "Known local brand — conversation about the next customer, not “you need reviews”",
      why: "Verified public review count. That is not revenue and not an ad-budget claim.",
    };
  }
  return {
    text: `${ctx.name} is a ${ctx.vertical.toLowerCase()} company in ${ctx.city || "your market"}.`,
    evidence: ["identity"],
    angle: "Category + market only — keep the ask light",
    why: "We don’t have a stronger verified hook yet, so the note stays factual and short.",
  };
}

function helpLine(ctx: PackedContext): string {
  if (ctx.offer === "Convert") return "Lamb Ascension helps companies turn existing attention into inquiries — landing path, tracking hygiene, and ads that match the page — without guessing your numbers.";
  if (ctx.offer === "Acquire") return "Lamb Ascension runs Google and Meta customer-acquisition for companies where one new customer is worth a serious conversation.";
  if (ctx.offer === "System") return "Lamb Ascension builds the full acquire + convert path when the evidence says traffic and the follow-through are both in play.";
  return "Lamb Ascension helps high-ticket companies get customers through Google and Meta. I won’t pitch a package until a short call confirms it fits.";
}

function emailBody(ctx: PackedContext, obs: ReturnType<typeof observation>): string {
  const hi = greeting(ctx);
  return [
    `Hi ${hi},`,
    "",
    obs.text,
    "",
    helpLine(ctx),
    "",
    "Would you be open to me sending over the short audit?",
    "",
    "Dylan",
    "Lamb Ascension",
  ].join("\n");
}

export function buildOutreach(ctx: PackedContext): OutreachPack {
  const obs = observation(ctx);
  const hi = greeting(ctx);
  const help = helpLine(ctx);
  const who = `${ctx.name} — ${ctx.vertical}${ctx.city ? ` in ${ctx.city}` : ""}${ctx.is_demo ? " (DEMO record)" : ""}`;
  const dm = ctx.contact_name === "UNKNOWN"
    ? "UNKNOWN — we do not have a verified person. Do not guess an email."
    : `${ctx.contact_name}${ctx.contact_title !== "UNKNOWN" ? `, ${ctx.contact_title}` : ""}`;

  const mk = (kind: OutreachMessage["kind"], body: string, subject?: string): OutreachMessage => ({
    kind, body, subject, state: "READY FOR REVIEW", angle: obs.angle, angle_why: obs.why, evidence_used: obs.evidence,
  });

  const messages: OutreachMessage[] = [
    mk("email", emailBody(ctx, obs), `${ctx.name} / a short audit`),
    mk("followup1", `Hi ${hi},\n\nQuick add: ${obs.text} If useful, I can send the 1-page version of what we actually checked — nothing invented.\n\nDylan`),
    mk("followup2", `Hi ${hi},\n\nSeparate thought: ${help}\nIf now’s not the time, a one-word “later” is enough.\n\nDylan`),
    mk("followup3", `Hi ${hi},\n\nI’ll close this thread so I’m not another “just following up.” If you ever want the short audit, reply “send it.”\n\nDylan`),
  ];

  if (ctx.contact_name !== "UNKNOWN" || ctx.contact_profile) {
    messages.push(mk(
      "linkedin",
      `Hi ${hi} — I was looking at ${ctx.name} (${ctx.vertical.toLowerCase()}${ctx.city ? `, ${ctx.city}` : ""}). ${obs.text.replace(/^I opened /, "I looked at ").split(".")[0]}. If it’s useful I can send a short, evidence-based note — no pitch deck. Open to that?`,
    ));
  }

  messages.push(mk(
    "call_opener",
    `Calling ${dm}. Reason: ${obs.angle}.\n\nOpener:\n“Hi ${hi}, this is Dylan with Lamb Ascension. I’ll be brief — ${obs.text} I wanted to ask if you’d be open to a short audit based on that, not a generic sales dump.”\n\nLikely next question: “How are you getting most customers today?”\n\nDo not claim revenue, ad spend, or that they need us.`,
  ));

  return {
    fingerprint: ctx.fingerprint,
    generated_at: new Date().toISOString(),
    generator: "evidence",
    estimated_cents: 0,
    brief: {
      who,
      why: ctx.readiness ? `${ctx.readiness}. ${obs.why}` : obs.why,
      decision_maker: dm,
      help,
      angle: obs.angle,
      unknown: ctx.unknown,
    },
    messages,
    call: {
      who: dm,
      why: obs.angle,
      point: obs.text,
      opener: `Hi ${hi}, this is Dylan with Lamb Ascension. I’ll be brief — ${obs.text} Would you be open to a short audit based on what we actually reviewed?`,
      next_question: "How are you currently getting customers?",
    },
  };
}
