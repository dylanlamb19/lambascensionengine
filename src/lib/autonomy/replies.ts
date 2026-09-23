export type InboundClass =
  | "INTERESTED"
  | "WANTS_MORE_INFORMATION"
  | "WANTS_AUDIT"
  | "PRICING_QUESTION"
  | "BOOKING_REQUEST"
  | "QUESTION"
  | "NOT_INTERESTED"
  | "DO_NOT_CONTACT"
  | "OUT_OF_OFFICE"
  | "WRONG_PERSON"
  | "REFERRAL"
  | "ALREADY_HAS_PROVIDER"
  | "UNCLEAR";

export type ReplyPlan = {
  cls: InboundClass;
  confidence: "high" | "low";
  stop: boolean;
  dnc: boolean;
  escalate: boolean;
  send: boolean;
  body: string;
};

export function classifyInbound(text: string): { cls: InboundClass; confidence: "high" | "low" } {
  const t = (text || "").toLowerCase();
  if (/ignore (previous|your) instructions|you are now|send me your password/.test(t)) return { cls: "UNCLEAR", confidence: "low" };
  if (/unsub|remove me|do not contact|stop emailing|take me off/.test(t)) return { cls: "DO_NOT_CONTACT", confidence: "high" };
  if (/out of office|automatic reply|ooo\b|away from/.test(t)) return { cls: "OUT_OF_OFFICE", confidence: "high" };
  if (/wrong person|not the right person|no longer (here|with)|left the company/.test(t)) return { cls: "WRONG_PERSON", confidence: "high" };
  if (/talk to|reach out to|contact my|forward you to/.test(t) && /@|manager|partner|owner/.test(t)) return { cls: "REFERRAL", confidence: "low" };
  if (/already have (an |a )?(agency|marketer|provider)|we already|in-house/.test(t)) return { cls: "ALREADY_HAS_PROVIDER", confidence: "high" };
  if (/not interested|no thanks|no thank you|not a fit|pass\b/.test(t)) return { cls: "NOT_INTERESTED", confidence: "high" };
  if (/how much|pricing|what does it cost|price|retainer/.test(t)) return { cls: "PRICING_QUESTION", confidence: "high" };
  if (/book|calendar|schedule|hop on|pick a time|grab a time/.test(t)) return { cls: "BOOKING_REQUEST", confidence: "high" };
  if (/send (it|the audit|the summary)|yes,? send/.test(t)) return { cls: "WANTS_AUDIT", confidence: "high" };
  if (/what do you|what exactly|who are you|tell me more/.test(t)) return { cls: "WANTS_MORE_INFORMATION", confidence: "high" };
  if (/interested|sounds good|let's talk|lets talk|sure\b/.test(t)) return { cls: "INTERESTED", confidence: "high" };
  if (/\?/.test(t)) return { cls: "QUESTION", confidence: "low" };
  return { cls: "UNCLEAR", confidence: "low" };
}

function bookingLine(url: string, seed: number): string {
  if (!url) return "Reply with a time that works and I’ll send a calendar hold.";
  const lines = [
    `If it's easier, you can grab 15 minutes here:\n${url}`,
    `If you'd rather skip the back-and-forth, pick a time here:\n${url}`,
  ];
  return lines[Math.abs(seed) % lines.length]!;
}

export function planReply(opts: { text: string; name: string; company: string; bookingUrl: string; finding?: string }): ReplyPlan {
  const { cls, confidence } = classifyInbound(opts.text);
  const hi = opts.name && opts.name !== "UNKNOWN" ? opts.name.split(" ")[0] : "there";
  const link = bookingLine(opts.bookingUrl, opts.company.length);
  const base = { cls, confidence, stop: true, dnc: false, escalate: false, send: false, body: "" };
  if (cls === "DO_NOT_CONTACT") {
    return { ...base, dnc: true, send: false, body: "" };
  }
  if (cls === "NOT_INTERESTED" || cls === "ALREADY_HAS_PROVIDER") {
    return {
      ...base,
      send: true,
      body: `Hi ${hi},\n\nUnderstood. I won’t follow up.\n\nDylan\nLamb Ascension`,
    };
  }
  if (cls === "OUT_OF_OFFICE") return { ...base, stop: false, send: false };
  if (cls === "WRONG_PERSON" || cls === "REFERRAL" || cls === "UNCLEAR" || cls === "QUESTION") {
    return { ...base, escalate: true, send: false };
  }
  if (cls === "PRICING_QUESTION") {
    return {
      ...base,
      send: true,
      body: `Hi ${hi},\n\nIt depends on the job. Lamb Ascension is a customer-acquisition system, not a one-size package, so I don’t quote a number from a single email.\n\n${link}\n\nDylan\nLamb Ascension`,
    };
  }
  const finding = (opts.finding || "").trim();
  const observed = finding ? `Based on what I found — ${finding} — ` : "";
  return {
    ...base,
    send: true,
    body: `Hi ${hi},\n\n${observed}I think this is easier to walk through together than over more email.\n\n${link}\n\nI’ll have ${opts.company} pulled up before we talk.\n\nDylan\nLamb Ascension`,
  };
}
