export type CheckItem = { id: string; label: string; done: boolean };
export type ClientStatus = "ONBOARDING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";

export function onboardingChecklist(service: string): CheckItem[] {
  const s = (service || "").toLowerCase();
  const named = /acquire|convert|system/.test(s);
  const ads = /acquire|system|\bads\b|meta|google ads/.test(s);
  const site = /convert|system|website|landing|form/.test(s);
  const items: CheckItem[] = [
    { id: "agreement", label: "Agreement", done: false },
    { id: "payment", label: "Payment", done: false },
    { id: "contact", label: "Primary contact confirmed", done: false },
    { id: "service", label: "Service confirmed", done: false },
  ];
  if (named && site) {
    items.push({ id: "website", label: "Website access", done: false });
    items.push({ id: "tracking", label: "Tracking access", done: false });
  }
  if (named && ads) items.push({ id: "ads", label: "Ad account access", done: false });
  if (named && (site || ads)) {
    items.push({ id: "offer", label: "The offer they want promoted", done: false });
    items.push({ id: "audience", label: "Who they want as a customer", done: false });
  }
  items.push({ id: "start", label: "Start date", done: false });
  return items;
}

export function handoffSummary(input: {
  company: string;
  contact?: string;
  website?: string;
  service?: string;
  price?: number | null;
  billing?: string;
  gap?: string;
  goal?: string;
  promised?: string;
  needs?: string[];
  next?: string;
}): string {
  const price = typeof input.price === "number" ? `$${input.price.toLocaleString()}${input.billing ? ` / ${input.billing}` : ""}` : "UNKNOWN";
  return [
    `CLIENT`,
    input.company || "UNKNOWN",
    input.contact ? `Contact: ${input.contact}` : "Contact: UNKNOWN",
    input.website && input.website !== "UNKNOWN" ? `Website: ${input.website}` : "Website: UNKNOWN",
    "",
    "THEY HIRED US FOR",
    input.service || "UNKNOWN",
    "",
    "WHY",
    input.gap || "UNKNOWN",
    "",
    "PRICE",
    price,
    "",
    "GOAL",
    input.goal || "UNKNOWN",
    "",
    "WHAT WE PROMISED",
    input.promised || "UNKNOWN",
    "",
    "WE NEED FROM THEM",
    input.needs?.length ? input.needs.join(", ") : "UNKNOWN",
    "",
    "NEXT",
    input.next || "Confirm the agreement and the start date.",
  ].join("\n");
}

export function applyFollowupSent<T extends { history?: { at?: string; action?: string; detail?: string }[]; followup_sent_body?: string; followup_sent_at?: string; followup_sent_to?: string }>(
  prospect: T,
  result: { ok: false; reason: string } | { ok: true; to: string; body: string; at: string },
): { ok: true; prospect: T } | { ok: false; reason: string } {
  if (!result.ok) return { ok: false, reason: result.reason };
  if (!result.body.trim()) return { ok: false, reason: "The note is empty. Nothing was sent." };
  if (prospect.followup_sent_body && prospect.followup_sent_body === result.body) {
    return { ok: false, reason: "That exact note was already sent." };
  }
  return {
    ok: true,
    prospect: {
      ...prospect,
      followup_sent_body: result.body,
      followup_sent_at: result.at,
      followup_sent_to: result.to,
      history: [...(prospect.history || []), { at: result.at, action: "sales_followup_sent", detail: `Sent to ${result.to}.` }],
    },
  };
}
