import type { PackedContext } from "./pack.ts";

export type OutreachLetter = {
  subject: string;
  body: string;
  sentence: string;
  angle: string;
  why: string;
  evidence: string[];
};

type Voice = { work: string; people: string; ask: string };

function hash(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h;
}

function pick<T>(seed: string, items: T[]): T {
  return items[hash(seed) % items.length]!;
}

function absentFact(ctx: PackedContext, key: string): boolean {
  const fact = ctx.facts.find((f) => f.key === key);
  if (!fact) return false;
  return /^(no |missing)/i.test(fact.text);
}

function presentFact(ctx: PackedContext, key: string): boolean {
  const fact = ctx.facts.find((f) => f.key === key);
  if (!fact) return false;
  return !/^(no |missing)/i.test(fact.text) && !/unknown/i.test(fact.text);
}

export function industryVoice(vertical: string, kind = ""): Voice {
  const v = `${vertical} ${kind}`.toLowerCase();
  if (/roof/.test(v)) return { work: "roofing work", people: "homeowners", ask: "estimate requests" };
  if (/hvac|air condition|heating/.test(v)) return { work: "HVAC work", people: "homeowners", ask: "service calls" };
  if (/plumb/.test(v)) return { work: "plumbing work", people: "homeowners", ask: "service requests" };
  if (/law|attorney|legal/.test(v)) return { work: "legal work", people: "potential clients", ask: "consultation requests" };
  if (/financ|lend|loan|credit/.test(v)) return { work: "financing", people: "borrowers", ask: "funding applications" };
  if (/dental|dentist/.test(v)) return { work: "dental care", people: "patients", ask: "appointment requests" };
  if (/med spa|cosmetic|aesthetic/.test(v)) return { work: "treatment options", people: "patients", ask: "appointment requests" };
  if (/foundation/.test(v)) return { work: "foundation work", people: "homeowners", ask: "estimate requests" };
  if (/remodel|contractor|construction/.test(v)) return { work: "project work", people: "homeowners", ask: "estimate requests" };
  if (/saas|software/.test(v)) return { work: "the product", people: "businesses", ask: "qualified inquiries" };
  if (/consult|b2b/.test(v)) return { work: "the work", people: "businesses", ask: "qualified inquiries" };
  const named = (vertical || "").trim();
  if (!named || named.toLowerCase() === "unknown") {
    return { work: "what you offer", people: "visitors", ask: "inquiries" };
  }
  return { work: named.toLowerCase(), people: "visitors", ask: "inquiries" };
}

function adsLive(ctx: PackedContext): boolean {
  return (ctx.ads || []).some((ad) => ad.label === "ADVERTISING DETECTED");
}

type Finding = {
  code: string;
  evidence: string[];
  sentence: string;
  soWhat: string;
  position: string;
  angle: string;
  why: string;
  auditReady: boolean;
};

function positionFor(kind: "convert" | "ads" | "tracking" | "speed" | "trust" | "light", voice: Voice, seed: string): string {
  const lead = pick(seed + "pos", [
    "At Lamb Ascension, we build customer-acquisition systems",
    "At Lamb Ascension, we design customer-acquisition systems",
  ]);
  if (kind === "ads") {
    return `${lead} that connect targeted advertising with a page built to capture ${voice.ask}, so more of that attention can become a real opportunity.`;
  }
  if (kind === "tracking") {
    return `${lead} where inquiries and calls can be tied back to the marketing that produced them, instead of guessing which channel is working.`;
  }
  if (kind === "speed") {
    return `${lead} designed to turn more mobile traffic into ${voice.ask}, starting with a page people can actually use.`;
  }
  if (kind === "trust") {
    return `${lead} designed to turn existing reputation into ${voice.ask}, by putting proof where a new visitor decides whether to reach out.`;
  }
  if (kind === "convert") {
    return `${lead} designed to turn more website traffic into qualified inquiries through a clearer path, lead capture, and follow-up.`;
  }
  return `${lead} designed to turn attention into qualified inquiries. I would rather confirm the details than guess at a package.`;
}

function chooseFinding(ctx: PackedContext, voice: Voice): Finding {
  const name = ctx.name;
  const paid = adsLive(ctx);
  const phoneOnly = Boolean(ctx.phone && ctx.phone !== "UNKNOWN") || presentFact(ctx, "phone_visible") || presentFact(ctx, "click_to_call");

  if (ctx.opportunities.some((o) => o.code === "NO_HOMEPAGE_FORM")) {
    const inner = ctx.facts.some((f) => f.key === "contact_form_inner") && !absentFact(ctx, "contact_form_inner");
    const sentence = inner
      ? `I took a look at ${name} and didn’t see a contact form on the homepage. A form did show up on an inside page.`
      : `I took a look at ${name} and did not find a contact form on the homepage.`;
    const soWhat = phoneOnly
      ? `That leaves a gap where ${voice.people} can look through your ${voice.work} and still leave if they are not ready to call — so those ${voice.ask} never get captured.`
      : `That means someone can find you, look through your ${voice.work}, and leave without ever turning into ${voice.ask}.`;
    return {
      code: "NO_HOMEPAGE_FORM",
      evidence: inner ? ["NO_HOMEPAGE_FORM", "contact_form_inner"] : ["NO_HOMEPAGE_FORM"],
      sentence,
      soWhat: paid
        ? `${soWhat} If paid traffic is landing on that homepage, more of it can leave without a next step.`
        : soWhat,
      position: positionFor(paid ? "ads" : "convert", voice, name),
      angle: "Homepage inquire path is weaker than it needs to be",
      why: "Verified homepage form gap. We only mention the form we did or did not see.",
      auditReady: true,
    };
  }

  if (ctx.opportunities.some((o) => o.code === "NO_HOMEPAGE_CTA")) {
    return {
      code: "NO_HOMEPAGE_CTA",
      evidence: ["NO_HOMEPAGE_CTA"],
      sentence: `I took a look at ${name} and didn’t see a clear quote or estimate ask near the top of the homepage.`,
      soWhat: `When the next step is easy to miss, ${voice.people} can be interested in your ${voice.work} and still leave before they become ${voice.ask}.`,
      position: positionFor("convert", voice, name),
      angle: "The next step is not obvious on the first screen",
      why: "Verified: no common quote or estimate ask in the first content.",
      auditReady: true,
    };
  }

  if (ctx.opportunities.some((o) => o.code === "NO_TRACKING" || o.code === "NO_ADS_CONVERSION_TAG")) {
    const code = ctx.opportunities.some((o) => o.code === "NO_TRACKING") ? "NO_TRACKING" : "NO_ADS_CONVERSION_TAG";
    return {
      code,
      evidence: [code],
      sentence: code === "NO_TRACKING"
        ? `On the pages we checked for ${name}, I didn’t see the usual tracking snippets that would show which visits turn into inquiries.`
        : `On the pages we checked for ${name}, I didn’t see a Google Ads conversion tag.`,
      soWhat: code === "NO_TRACKING"
        ? "Without that, it is hard to know which marketing is actually producing customers. Missing tags are not proof that you never advertise."
        : "That does not prove ads are off. It does mean a checked page would not show which clicks became inquiries.",
      position: positionFor("tracking", voice, name),
      angle: "Tracking on the pages we checked would not show where inquiries come from",
      why: "We only report tags we did not see on the pages checked. We do not claim ad spend.",
      auditReady: true,
    };
  }

  const slow = ctx.opportunities.find((o) => o.code === "SLOW_MOBILE");
  if (slow) {
    return {
      code: "SLOW_MOBILE",
      evidence: ["SLOW_MOBILE"],
      sentence: `I checked ${name} on a phone. ${slow.plain}`,
      soWhat: `A slow page gives mobile visitors a reason to leave before they ask about ${voice.work}.`,
      position: positionFor("speed", voice, name),
      angle: "Mobile speed may be costing inquiries",
      why: "The phone speed score is a stored result, not a guess.",
      auditReady: true,
    };
  }

  if (absentFact(ctx, "testimonials") && ctx.reviews >= 15) {
    return {
      code: "testimonials",
      evidence: ["testimonials", "reviews"],
      sentence: `${name} has ${ctx.reviews} public reviews, and I didn’t see that proof used on the homepage.`,
      soWhat: `New ${voice.people} may not see the reputation that could help them send ${voice.ask}. That is a trust gap on the page, not a claim about revenue.`,
      position: positionFor("trust", voice, name),
      angle: "Public reviews are not carrying the homepage",
      why: "Review count is from the public listing. The homepage testimonial check is from the pages we opened.",
      auditReady: true,
    };
  }

  if (ctx.facts.some((f) => f.key === "case_studies" || /case-study|client-story/i.test(f.text))) {
    return {
      code: "case_studies",
      evidence: ["case_studies"],
      sentence: `${name} publishes case-study / client-story language. That reads as work sold to businesses, not a generic local-service page.`,
      soWhat: `The opportunity is getting more of the right ${voice.people} to start a conversation, not pretending this is a walk-in shop.`,
      position: positionFor("convert", voice, name),
      angle: "Client stories are on the site — the ask can match that",
      why: "Observed case-study wording on a page we opened. That is wording, not verified contract value.",
      auditReady: true,
    };
  }

  if (ctx.facts.some((f) => f.key === "enterprise_language" || /enterprise \/ b2b/i.test(f.text))) {
    return {
      code: "enterprise_language",
      evidence: ["enterprise_language"],
      sentence: `${name}’s site is written for businesses, not just local consumers.`,
      soWhat: `A first note should talk about ${voice.ask} from ${voice.people}, not a consumer review pitch.`,
      position: positionFor("light", voice, name),
      angle: "The site speaks to businesses",
      why: "Observed enterprise or B2B wording on a page we opened.",
      auditReady: true,
    };
  }

  if (ctx.research_status === "blocked" || ctx.research_status === "failed") {
    const bits = [`${name} is a ${ctx.vertical.toLowerCase() || "company"} company${ctx.city ? ` in ${ctx.city}` : ""}`];
    if (ctx.reviews) bits.push(`with ${ctx.reviews} public reviews`);
    if (ctx.rating !== "UNKNOWN") bits.push(`and a ${ctx.rating} public rating`);
    return {
      code: "listing_only",
      evidence: ctx.reviews ? ["reviews", "listing"] : ["listing"],
      sentence: `${bits.join(" ")}. I could not inspect the website, so I am not going to pretend I found a site problem.`,
      soWhat: "The only honest next step is a look at the site itself before recommending anything.",
      position: positionFor("light", voice, name),
      angle: "Public listing only — website still unknown",
      why: "Website research did not finish. We only use listing facts we already have. We do not invent site problems.",
      auditReady: false,
    };
  }

  if (ctx.reviews >= 80) {
    return {
      code: "reviews",
      evidence: ["reviews"],
      sentence: `${name} already has ${ctx.reviews} public reviews${ctx.city ? ` in ${ctx.city}` : ""}.`,
      soWhat: `That is a reputation signal, not a claim about revenue. I would not invent a website problem on top of it.`,
      position: positionFor("trust", voice, name),
      angle: "Known in public — keep the note on what we actually verified",
      why: "Verified public review count. That is not revenue and not an ad-budget claim.",
      auditReady: false,
    };
  }

  return {
    code: "identity",
    evidence: ["identity"],
    sentence: `${name} is a ${ctx.vertical.toLowerCase() || "company"} company${ctx.city ? ` in ${ctx.city}` : ""}. I don’t have a stronger verified finding yet, so this note stays on that.`,
    soWhat: "I would rather send a short, accurate note than invent a problem to make the email sound sharper.",
    position: positionFor("light", voice, name),
    angle: "Category and market only",
    why: "We don’t have a stronger verified hook yet, so the note stays factual and short.",
    auditReady: false,
  };
}

function auditLine(ctx: PackedContext, ready: boolean): string {
  if (ready) {
    return pick(ctx.name + "audit", [
      `I put together a short audit showing what I noticed and a few opportunities I’d recommend for ${ctx.name} specifically.`,
      `I put together a short audit of what I actually saw, and a few opportunities I’d recommend for ${ctx.name}.`,
    ]);
  }
  return `I can put together a short audit for ${ctx.name} specifically once there is a verified finding to stand on. I don’t want to invent one.`;
}

function cta(name: string): string {
  return pick(name + "cta", [
    "Would you be open to me sending it over?",
    "Want me to send it over?",
    "Would it be helpful if I sent it over?",
    "Open to taking a look?",
  ]);
}

export function composeOutreachEmail(ctx: PackedContext): OutreachLetter {
  const voice = industryVoice(ctx.vertical, ctx.kind);
  const finding = chooseFinding(ctx, voice);
  const hi = ctx.contact_name !== "UNKNOWN" ? (ctx.contact_name.split(" ")[0] || ctx.contact_name) : "Team";
  const subject = finding.auditReady
    ? `${ctx.name} — quick opportunity I noticed`
    : `${ctx.name} — a short note`;
  const body = [
    `Hi ${hi},`,
    "",
    finding.sentence,
    "",
    finding.soWhat,
    "",
    finding.position,
    "",
    auditLine(ctx, finding.auditReady),
    "",
    cta(ctx.name),
    "",
    "Dylan",
    "Lamb Ascension",
  ].join("\n");
  return {
    subject,
    body,
    sentence: finding.sentence,
    angle: finding.angle,
    why: finding.why,
    evidence: finding.evidence,
  };
}
