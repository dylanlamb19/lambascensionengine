import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_API_DISABLED_MESSAGE,
  calendarFailureReason,
  classifyGoogleCalendarHttp,
} from "./calendar-errors.ts";

test("disabled Calendar API is a distinct stop condition", () => {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: "Google Calendar API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123 then retry.",
    },
  });
  assert.equal(classifyGoogleCalendarHttp(403, body), "CALENDAR_API_DISABLED");
  assert.equal(calendarFailureReason("CALENDAR_API_DISABLED"), CALENDAR_API_DISABLED_MESSAGE);
});

test("insufficient Gmail scopes means the API is enabled, not disabled", () => {
  const body = JSON.stringify({
    error: { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." },
  });
  assert.equal(classifyGoogleCalendarHttp(403, body), "CALENDAR_NOT_AUTHORIZED");
  assert.notEqual(classifyGoogleCalendarHttp(403, body), "CALENDAR_API_DISABLED");
});

test("401 is TOKEN_INVALID", () => {
  assert.equal(classifyGoogleCalendarHttp(401, "invalid_token"), "TOKEN_INVALID");
});

test("generic free/busy failure fails closed", () => {
  assert.equal(classifyGoogleCalendarHttp(500, "nope"), "FREEBUSY_FAILED");
  assert.match(calendarFailureReason("FREEBUSY_FAILED"), /couldn’t be read/i);
});
