export type ThreadMessage = {
  id: string;
  from: string;
  body: string;
  labelIds?: string[];
};

export function extractEmail(from: string): string {
  const m = (from || "").match(/<([^>]+)>/);
  return (m ? m[1] : from || "").trim().toLowerCase();
}

export function isOwnOutbound(msg: ThreadMessage, opts: { outboundIds: Set<string>; ownerEmail?: string }): boolean {
  if (opts.outboundIds.has(msg.id)) return true;
  const labels = (msg.labelIds || []).map((l) => l.toUpperCase());
  if (labels.includes("SENT")) return true;
  const owner = (opts.ownerEmail || "").trim().toLowerCase();
  if (owner && extractEmail(msg.from) === owner) return true;
  return false;
}

/** Only genuinely inbound messages. Our own sent mail is never a reply. */
export function inboundReplies(messages: ThreadMessage[], opts: { outboundIds: Set<string>; ownerEmail?: string }): ThreadMessage[] {
  return messages.filter((m) => !isOwnOutbound(m, opts));
}
