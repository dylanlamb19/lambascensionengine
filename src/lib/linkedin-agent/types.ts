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
