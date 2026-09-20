export type CalendarFailureCode =
  | "CALENDAR_API_DISABLED"
  | "CALENDAR_NOT_AUTHORIZED"
  | "TOKEN_INVALID"
  | "FREEBUSY_FAILED"
  | "EVENT_CREATE_FAILED"
  | "OAUTH_FAILED";

export const CALENDAR_API_DISABLED_MESSAGE = "Google Calendar API still needs to be enabled.";
export const CALENDAR_AVAILABILITY_UNREADABLE = "Calendar availability couldn’t be read.";
export const CALENDAR_NOT_AUTHORIZED_MESSAGE = "Google Calendar still needs to be connected. (CALENDAR_NOT_AUTHORIZED)";
export const CALENDAR_TOKEN_INVALID_MESSAGE = "The Calendar token is invalid. Reconnect Google Calendar. (TOKEN_INVALID)";

export function classifyGoogleCalendarHttp(status: number, body: string): CalendarFailureCode {
  const text = body || "";
  if (
    /has not been used in project|is disabled|ACCESS_NOT_CONFIGURED|calendar-json\.googleapis\.com/i.test(text)
    && /enable it|disabled|not been used/i.test(text)
  ) {
    return "CALENDAR_API_DISABLED";
  }
  if (/Google Calendar API has not been used in project/i.test(text)) return "CALENDAR_API_DISABLED";
  if (status === 401) return "TOKEN_INVALID";
  if (/insufficient.{0,40}scope|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
    return "CALENDAR_NOT_AUTHORIZED";
  }
  if (status === 403 && /calendar/i.test(text) && /disabled|not been used/i.test(text)) {
    return "CALENDAR_API_DISABLED";
  }
  return "FREEBUSY_FAILED";
}

export function calendarFailureReason(code: CalendarFailureCode): string {
  switch (code) {
    case "CALENDAR_API_DISABLED":
      return CALENDAR_API_DISABLED_MESSAGE;
    case "CALENDAR_NOT_AUTHORIZED":
      return CALENDAR_NOT_AUTHORIZED_MESSAGE;
    case "TOKEN_INVALID":
      return CALENDAR_TOKEN_INVALID_MESSAGE;
    case "FREEBUSY_FAILED":
      return CALENDAR_AVAILABILITY_UNREADABLE;
    case "EVENT_CREATE_FAILED":
      return "The calendar event could not be created. (EVENT_CREATE_FAILED)";
    case "OAUTH_FAILED":
      return "Google Calendar sign-in didn’t finish. Nothing was connected. (OAUTH_FAILED)";
  }
}
