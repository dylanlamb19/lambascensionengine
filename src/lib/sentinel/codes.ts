/** Stable Sentinel error codes. Never rely on human-readable text alone. */

export const SENTINEL_CODES = [
  "CALENDAR_LIST_PARSE_FAILED",
  "CALENDAR_TOKEN_REFRESH_FAILED",
  "CALENDAR_TOKEN_INVALID",
  "CALENDAR_NOT_AUTHORIZED",
  "CALENDAR_LIST_AUTH_FAILED",
  "PLACES_AUTH_FAILED",
  "PLACES_KEY_MISSING",
  "DATABASE_UNAVAILABLE",
  "WORKER_STALE",
  "WORKER_NOT_CONFIGURED",
  "GMAIL_SEND_FAILED",
  "GMAIL_TOKEN_INVALID",
  "GMAIL_NOT_CONNECTED",
  "UNKNOWN_DELIVERY",
  "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE",
  "ARA_ACTION_DUPLICATE",
  "ARA_ACTION_ROUTING_FAILED",
  "ARA_VOICE_PROVIDER_AUTH_FAILED",
  "ARA_VOICE_SESSION_CREATE_FAILED",
  "ARA_VOICE_PROVIDER_UNAVAILABLE",
  "ARA_VOICE_NETWORK_FAILED",
  "PIPELINE_STATE_MISMATCH",
  "TEST_MODE_INVARIANT_FAILED",
  "PROSPECT_DUPLICATE_IDENTITY",
  "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY",
  "DNC_SEQUENCE_ACTIVE",
  "BOUNCE_FUTURE_SEND_SCHEDULED",
  "HTTP_UNHEALTHY",
  "CONTACTABILITY_MISMATCH",
  "CONTACTABLE_WITHOUT_EMAIL",
  "PIPELINE_QUEUE_INVARIANT",
  "SENTINEL_OK",
] as const;

export type SentinelCode = (typeof SENTINEL_CODES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type SentinelSeverity = (typeof SEVERITIES)[number];

export const FEATURES = [
  "gmail",
  "calendar",
  "places",
  "database",
  "worker",
  "booking",
  "outreach",
  "pipeline",
  "ara",
  "ara_voice",
  "auth",
  "test_mode",
  "sentinel",
] as const;
export type SentinelFeature = (typeof FEATURES)[number];

export const SENTINEL_MODES = ["light", "deep", "post_deploy", "owner", "fixture"] as const;
export type SentinelMode = (typeof SENTINEL_MODES)[number];

export function isSentinelCode(raw: string): raw is SentinelCode {
  return (SENTINEL_CODES as readonly string[]).includes(raw);
}

export function defaultSeverity(code: SentinelCode): SentinelSeverity {
  switch (code) {
    case "TEST_MODE_INVARIANT_FAILED":
    case "DNC_SEQUENCE_ACTIVE":
    case "BOUNCE_FUTURE_SEND_SCHEDULED":
    case "GMAIL_SEND_FAILED":
    case "ARA_ACTION_DUPLICATE":
    case "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE":
    case "UNKNOWN_DELIVERY":
      return "critical";
    case "CALENDAR_LIST_PARSE_FAILED":
    case "CALENDAR_TOKEN_REFRESH_FAILED":
    case "CALENDAR_TOKEN_INVALID":
    case "CALENDAR_LIST_AUTH_FAILED":
    case "PLACES_AUTH_FAILED":
    case "DATABASE_UNAVAILABLE":
    case "WORKER_STALE":
    case "GMAIL_TOKEN_INVALID":
    case "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY":
    case "PROSPECT_DUPLICATE_IDENTITY":
    case "PIPELINE_STATE_MISMATCH":
    case "ARA_VOICE_PROVIDER_AUTH_FAILED":
    case "ARA_VOICE_SESSION_CREATE_FAILED":
    case "ARA_VOICE_PROVIDER_UNAVAILABLE":
    case "ARA_VOICE_NETWORK_FAILED":
    case "HTTP_UNHEALTHY":
    case "CONTACTABILITY_MISMATCH":
    case "CONTACTABLE_WITHOUT_EMAIL":
    case "PIPELINE_QUEUE_INVARIANT":
      return "high";
    case "CALENDAR_NOT_AUTHORIZED":
    case "GMAIL_NOT_CONNECTED":
    case "PLACES_KEY_MISSING":
    case "WORKER_NOT_CONFIGURED":
    case "ARA_ACTION_ROUTING_FAILED":
      return "medium";
    default:
      return "low";
  }
}

export function featureForCode(code: SentinelCode): SentinelFeature {
  if (code.startsWith("CALENDAR")) return "calendar";
  if (code.startsWith("PLACES")) return "places";
  if (code.startsWith("GMAIL") || code === "UNKNOWN_DELIVERY") return "gmail";
  if (code.startsWith("WORKER")) return "worker";
  if (code.startsWith("ARA_VOICE")) return "ara_voice";
  if (code.startsWith("ARA")) return "ara";
  if (code === "DATABASE_UNAVAILABLE") return "database";
  if (code === "HTTP_UNHEALTHY") return "sentinel";
  if (code === "TEST_MODE_INVARIANT_FAILED") return "test_mode";
  if (code === "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE") return "booking";
  if (
    code === "PIPELINE_STATE_MISMATCH"
    || code === "PROSPECT_DUPLICATE_IDENTITY"
    || code === "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY"
    || code === "DNC_SEQUENCE_ACTIVE"
    || code === "BOUNCE_FUTURE_SEND_SCHEDULED"
    || code === "CONTACTABILITY_MISMATCH"
    || code === "CONTACTABLE_WITHOUT_EMAIL"
    || code === "PIPELINE_QUEUE_INVARIANT"
  ) return "pipeline";
  return "sentinel";
}

export function ownerLabel(code: SentinelCode): string {
  switch (code) {
    case "CALENDAR_LIST_PARSE_FAILED": return "Calendar list could not be read";
    case "CALENDAR_TOKEN_REFRESH_FAILED":
    case "CALENDAR_TOKEN_INVALID":
    case "CALENDAR_LIST_AUTH_FAILED": return "Calendar needs attention";
    case "CALENDAR_NOT_AUTHORIZED": return "Calendar isn’t connected";
    case "PLACES_AUTH_FAILED":
    case "PLACES_KEY_MISSING": return "Google Places isn’t ready";
    case "DATABASE_UNAVAILABLE": return "Database isn’t responding";
    case "WORKER_STALE": return "Outreach worker looks stalled";
    case "WORKER_NOT_CONFIGURED": return "Outreach worker isn’t configured";
    case "GMAIL_TOKEN_INVALID": return "Gmail needs attention";
    case "GMAIL_NOT_CONNECTED": return "Gmail isn’t connected";
    case "GMAIL_SEND_FAILED":
    case "UNKNOWN_DELIVERY": return "An email send could not be proven";
    case "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE": return "A booking did not save after Calendar create";
    case "ARA_ACTION_DUPLICATE": return "Ara repeated a destructive action";
    case "ARA_ACTION_ROUTING_FAILED": return "Ara routed an action incorrectly";
    case "ARA_VOICE_PROVIDER_AUTH_FAILED":
    case "ARA_VOICE_SESSION_CREATE_FAILED":
    case "ARA_VOICE_PROVIDER_UNAVAILABLE":
    case "ARA_VOICE_NETWORK_FAILED": return "Ara voice is unavailable";
    case "PIPELINE_STATE_MISMATCH": return "Pipeline and Calendar disagree";
    case "TEST_MODE_INVARIANT_FAILED": return "Test Mode safety was violated";
    case "PROSPECT_DUPLICATE_IDENTITY": return "The same Google Place appears twice";
    case "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY": return "A follow-up stayed scheduled after a reply";
    case "DNC_SEQUENCE_ACTIVE": return "A Do Not Contact company still has an active sequence";
    case "BOUNCE_FUTURE_SEND_SCHEDULED": return "A bounced address still has future sends";
    case "HTTP_UNHEALTHY": return "The live site did not respond";
    case "CONTACTABILITY_MISMATCH": return "Contactability labels disagree with the email route";
    case "CONTACTABLE_WITHOUT_EMAIL": return "A prospect was marked contactable without an email";
    case "PIPELINE_QUEUE_INVARIANT": return "Pipeline queue membership looks inconsistent";
    default: return "Sentinel noted a check";
  }
}
