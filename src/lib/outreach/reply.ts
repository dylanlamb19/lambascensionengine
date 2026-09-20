import type { ReplyClass } from "./types.ts";

export function classifyReply(text: string): ReplyClass {
  const t = text.toLowerCase();
  if (/ignore (previous|your) instructions|send me your password|you are now/.test(t)) return "OTHER";
  if (/unsub|stop emailing|remove me|do not contact/.test(t)) return "UNSUBSCRIBE";
  if (/not interested|no thanks|please don't|leave me alone/.test(t)) return "NOT INTERESTED";
  if (/next quarter|next year|not now|revisit|busy right now|later/.test(t)) return "NOT NOW";
  if (/too expensive|already have|agency|in-house|we tried ads/.test(t)) return "OBJECTION";
  if (/\?|how much|what do you|tell me more|send the/.test(t)) return "QUESTION";
  if (/yes|sounds good|let's talk|book|interested|send it/.test(t)) return "POSITIVE";
  return "OTHER";
}

export function draftReply(cls: ReplyClass, name: string): string {
  const hi = name && name !== "UNKNOWN" ? name.split(" ")[0] : "there";
  if (cls === "UNSUBSCRIBE" || cls === "NOT INTERESTED") {
    return `Hi ${hi},\n\nUnderstood — I’ll take you off this thread and we won’t follow up.\n\nDylan`;
  }
  if (cls === "NOT NOW") {
    return `Hi ${hi},\n\nNo problem. I’ll leave the door open — if a better window opens, reply anytime.\n\nDylan`;
  }
  if (cls === "OBJECTION") {
    return `Hi ${hi},\n\nFair. I’m not asking you to rip anything up. If it helps, I can send the short audit of what we actually verified — you can ignore it if it’s not useful.\n\nDylan`;
  }
  if (cls === "POSITIVE") {
    return `Hi ${hi},\n\nGreat — what day this week is easiest for a 15-minute call?\n\nDylan`;
  }
  return `Hi ${hi},\n\nHappy to answer that. The honest version: we only know what we verified on public pages — not your revenue or ad spend. Tell me which part you want first (audit vs. a quick call).\n\nDylan`;
}
