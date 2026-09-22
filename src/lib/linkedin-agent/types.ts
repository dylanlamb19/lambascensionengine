/** JSON-safe values for TanStack server-fn serialization. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** LinkedIn agent chat + order types. No invented emails/ROAS. */

export type LinkedInAgentRole = "user" | "linkedin" | "ara" | "system";

export type LinkedInAgentOrderStatus =
  | "queued"
  | "claimed"
  | "done"
  | "failed"
  | "cancelled";

export type LinkedInAgentOrderKind =
  | "fill_leads"
  | "enrich"
  | "outreach"
  | "chat_reply"
  | "custom";

export type LinkedInAgentMessage = {
  id: string;
  user_id: string;
  role: LinkedInAgentRole;
  body: string;
  created_at: string;
  meta: { [key: string]: JsonValue };
};

export type LinkedInAgentOrder = {
  id: string;
  user_id: string;
  status: LinkedInAgentOrderStatus;
  kind: LinkedInAgentOrderKind;
  payload: { [key: string]: JsonValue };
  result: { [key: string]: JsonValue };
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
};

/** Contract the external LinkedIn Grok Bot must follow. */
export const GROK_BOT_HANDOFF_NOTE =
  "Email-only contactability. A usable email is required before READY TO CONTACT. Do not invent emails. Phone, LinkedIn, and contact forms are not autonomous contact routes. Do not send Gmail. Outreach is draft-only under soft caps. Finish with POST /api/jobs/linkedin-agent mode=complete.";

/** Drop functions and undefined so order payloads stay JSON the bot can round-trip. */
export function toJsonBag(value: unknown): { [key: string]: JsonValue } {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    const clean = sanitizeJson(item);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function sanitizeJson(item: unknown): JsonValue | undefined {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) return item;
  if (Array.isArray(item)) {
    const arr: JsonValue[] = [];
    for (const entry of item) {
      const clean = sanitizeJson(entry);
      if (clean !== undefined) arr.push(clean);
    }
    return arr;
  }
  if (item && typeof item === "object") {
    const nested: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(item as Record<string, unknown>)) {
      const clean = sanitizeJson(entry);
      if (clean !== undefined) nested[key] = clean;
    }
    return nested;
  }
  return undefined;
}

/** Soft-cap note for outreach orders — agent drafts/requests connects externally. */
export const LINKEDIN_OUTREACH_SOFT_CAP_NOTE =
  "draft/request LinkedIn connects under soft caps";

export const HIGH_TICKET_VERTICALS = [
  "Dental",
  "Med spa / cosmetic",
  "Law / personal injury",
  "B2B consulting",
  "SaaS / software",
  "Commercial real estate",
] as const;

export const HIGH_TICKET_CITIES = [
  "Dallas, TX",
  "Houston, TX",
  "Austin, TX",
  "Fort Worth, TX",
  "San Antonio, TX",
] as const;

export function isOrderKind(value: string): value is LinkedInAgentOrderKind {
  return (
    value === "fill_leads"
    || value === "enrich"
    || value === "outreach"
    || value === "chat_reply"
    || value === "custom"
  );
}

export function isAgentRole(value: string): value is LinkedInAgentRole {
  return value === "user" || value === "linkedin" || value === "ara" || value === "system";
}
