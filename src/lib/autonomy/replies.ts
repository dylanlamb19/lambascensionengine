export type InboundClass =
  | "INTERESTED"
  | "WANTS_MORE_INFORMATION"
  | "WANTS_AUDIT"
  | "PRICING_QUESTION"
  | "OBJECTION"
  | "NOT_NOW"
  | "BOOKING_REQUEST"
  | "QUESTION"
  | "NOT_INTERESTED"
  | "NEGATIVE"
  | "UNSUBSCRIBE"
  | "OUT_OF_OFFICE"
  | "WRONG_PERSON"
  | "REFERRAL"
  | "ALREADY_SOLVED"
  | "MEETING_BOOKED"
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
  if (/unsub|remove me|do not contact|stop emailing|take me off/.test(t)) return { cls: "UNSUBSCRIBE", confidence: "high" };
  if (/scam|lawyer|sue you|harass|terrible|this is spam/.test(t)) return { cls: "NEGATIVE", confidence: "high" };
  if (/out of office|automatic reply|ooo\b|away from/.test(t)) return { cls: "OUT_OF_OFFICE", confidence: "high" };
  if (/wrong person|not the right person|no longer (here|with)|left the company/.test(t)) return { cls: "WRONG_PERSON", confidence: "low" };
  if (/i (just )?booked|meeting is (set|booked)|see you (on|at)/.test(t)) return { cls: "MEETING_BOOKED", confidence: "high" };
  if (/talk to|reach out to|contact my|forward you to/.test(t) && /@|manager|partner|owner/.test(t)) return { cls: "REFERRAL", confidence: "low" };
  if (/already (have|solved|fixed)|we already|in-house|have an agency/.test(t)) return { cls: "ALREADY_SOLVED", confidence: "high" };
  if (/not now|next quarter|next month|circle back|busy right now/.test(t)) return { cls: "NOT_NOW", confidence: "high" };
  if (/too expensive|can't afford|cannot afford|not in the budget|we tried that/.test(t)) return { cls: "OBJECTION", confidence: "high" };
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
  if (confidence === "low") {
    return { cls, confidence, stop: true, dnc: false, escalate: true, send: false, body: "" };
  }
  const hi = opts.name && opts.name !== "UNKNOWN" ? opts.name.split(" ")[0] : "there";
  const link = bookingLine(opts.bookingUrl, opts.company.length);
  const base = { cls, confidence, stop: true, dnc: false, escalate: false, send: false, body: "" };
  if (cls === "UNSUBSCRIBE") return { ...base, dnc: true, send: false, body: "" };
  if (cls === "NEGATIVE") return { ...base, escalate: true, send: false };
  if (cls === "MEETING_BOOKED") return { ...base, send: false };
  if (cls === "NOT_INTERESTED" || cls === "ALREADY_SOLVED") {
    return { ...base, send: true, body: `Hi ${hi},\n\nUnderstood. I won’t follow up.\n\nDylan\nLamb Ascension` };
  }
  if (cls === "NOT_NOW") {
    return { ...base, send: true, body: `Hi ${hi},\n\nNo problem. I’ll leave it here. If timing changes later, just reply.\n\nDylan\nLamb Ascension` };
  }
  if (cls === "OUT_OF_OFFICE") return { ...base, stop: false, send: false };
  if (cls === "OBJECTION") {
    return {
      ...base,
      send: true,
      body: `Hi ${hi},\n\nFair. I’m not going to argue with that, and I won’t guess a price from one email.\n\nDylan\nLamb Ascension`,
    };
  }
  if (cls === "PRICING_QUESTION") {
    return {
      ...base,
      send: true,
      body: `Hi ${hi},\n\nIt depends on the job, so I don’t quote a number from a single email. Lamb Ascension builds the path from a visit to a real inquiry.\n\nIf you want to see whether it fits ${opts.company}, ${link}\n\nDylan\nLamb Ascension`,
    };
  }
  const finding = (opts.finding || "").trim();
  if (cls === "WANTS_AUDIT") {
    const noted = finding ? `What I actually saw: ${finding}.` : "I only have what the research pass stored. I won’t add anything past that.";
    return { ...base, send: true, body: `Hi ${hi},\n\n${noted}\n\n${link}\n\nDylan\nLamb Ascension` };
  }
  return {
    ...base,
    send: true,
    body: `Hi ${hi},\n\nHappy to walk through ${opts.company} with you. ${finding ? `The verified piece was: ${finding}.` : "I won’t add findings that weren’t checked."}\n\n${link}\n\nDylan\nLamb Ascension`,
  };
}
