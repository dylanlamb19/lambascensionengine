export type CalendarFailureCode =
  | "CALENDAR_API_DISABLED"
  | "CALENDAR_NOT_AUTHORIZED"
  | "CALENDAR_SCOPE_MISSING"
  | "CALENDAR_TOKEN_INVALID"
  | "CALENDAR_TOKEN_REFRESH_FAILED"
  | "TOKEN_INVALID"
  | "FREEBUSY_FAILED"
  | "FREEBUSY_FORBIDDEN"
  | "FREEBUSY_BAD_REQUEST"
  | "FREEBUSY_PROVIDER_ERROR"
  | "EVENT_CREATE_FAILED"
  | "OAUTH_FAILED";

export const CALENDAR_API_DISABLED_MESSAGE = "Google Calendar is connected, but the Google Calendar API itself still needs to be enabled in Google Cloud.";
export const CALENDAR_AVAILABILITY_UNREADABLE = "Calendar availability couldn’t be read.";
export const CALENDAR_NOT_AUTHORIZED_MESSAGE = "Google Calendar still needs to be connected. (CALENDAR_NOT_AUTHORIZED)";
export const CALENDAR_TOKEN_INVALID_MESSAGE = "The Calendar token is invalid. Reconnect Google Calendar. (CALENDAR_TOKEN_INVALID)";
export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function googleErrorReason(body: string): string {
  const text = (body || "").slice(0, 2000);
  try {
    const json = JSON.parse(text) as {
      error?: { status?: string; message?: string; errors?: { reason?: string }[] };
      calendars?: Record<string, { errors?: { reason?: string }[] }>;
    };
    const top = json.error?.status || json.error?.errors?.[0]?.reason || "";
    if (top) return String(top).slice(0, 80);
    const cals = json.calendars || {};
    for (const entry of Object.values(cals)) {
      const reason = entry.errors?.[0]?.reason;
      if (reason) return String(reason).slice(0, 80);
    }
    if (json.error?.message) return String(json.error.message).replace(/https?:\/\/\S+/g, "").slice(0, 120).trim();
  } catch {
    /* not json */
  }
  return "";
}

export function classifyGoogleCalendarHttp(status: number, body: string): CalendarFailureCode {
  const text = body || "";
  const reason = googleErrorReason(text);
  if (
    /has not been used in project|is disabled|ACCESS_NOT_CONFIGURED|API_NOT_ENABLED/i.test(text)
    || /calendar-json\.googleapis\.com/i.test(text) && /enable it|disabled|not been used/i.test(text)
  ) {
    return "CALENDAR_API_DISABLED";
  }
  if (/Google Calendar API has not been used in project/i.test(text)) return "CALENDAR_API_DISABLED";
  if (status === 401 || reason === "authError") return "CALENDAR_TOKEN_INVALID";
  if (/insufficient.{0,40}scope|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
    return "CALENDAR_SCOPE_MISSING";
  }
  if (status === 400) return "FREEBUSY_BAD_REQUEST";
  if (status === 403) return "FREEBUSY_FORBIDDEN";
  if (status >= 500) return "FREEBUSY_PROVIDER_ERROR";
  if (reason === "notFound") return "FREEBUSY_BAD_REQUEST";
  return "FREEBUSY_FAILED";
}

export function calendarFailureReason(code: CalendarFailureCode): string {
  switch (code) {
    case "CALENDAR_API_DISABLED":
      return CALENDAR_API_DISABLED_MESSAGE;
    case "CALENDAR_NOT_AUTHORIZED":
      return CALENDAR_NOT_AUTHORIZED_MESSAGE;
    case "CALENDAR_SCOPE_MISSING":
      return "The Calendar token is missing the free/busy scope. Reconnect Google Calendar only — not Gmail. (CALENDAR_SCOPE_MISSING)";
    case "CALENDAR_TOKEN_INVALID":
    case "TOKEN_INVALID":
      return CALENDAR_TOKEN_INVALID_MESSAGE;
    case "CALENDAR_TOKEN_REFRESH_FAILED":
      return "The Calendar token could not be refreshed. Reconnect Google Calendar only — not Gmail. (CALENDAR_TOKEN_REFRESH_FAILED)";
    case "FREEBUSY_FORBIDDEN":
      return "Google refused to read Calendar availability. (FREEBUSY_FORBIDDEN)";
    case "FREEBUSY_BAD_REQUEST":
      return "Calendar availability request was rejected. (FREEBUSY_BAD_REQUEST)";
    case "FREEBUSY_PROVIDER_ERROR":
      return "Google Calendar had a provider error while reading availability. (FREEBUSY_PROVIDER_ERROR)";
    case "FREEBUSY_FAILED":
      return CALENDAR_AVAILABILITY_UNREADABLE;
    case "EVENT_CREATE_FAILED":
      return "The calendar event could not be created. (EVENT_CREATE_FAILED)";
    case "OAUTH_FAILED":
      return "Google Calendar sign-in didn’t finish. Nothing was connected. (OAUTH_FAILED)";
  }
}

export function calendarScopeFlags(scope: string | undefined): { listed: boolean; freebusy: boolean; events: boolean } {
  const s = (scope || "").trim();
  if (!s) return { listed: false, freebusy: true, events: true };
  const freebusy =
    s.includes("auth/calendar.freebusy")
    || s.includes("auth/calendar.readonly")
    || s.includes("auth/calendar.events.freebusy")
    || /(^|\s)https:\/\/www\.googleapis\.com\/auth\/calendar(\s|$)/.test(s);
  const events =
    s.includes("auth/calendar.events")
    || /(^|\s)https:\/\/www\.googleapis\.com\/auth\/calendar(\s|$)/.test(s);
  return { listed: true, freebusy, events };
}
