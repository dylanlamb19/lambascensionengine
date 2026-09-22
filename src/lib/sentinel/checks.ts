import { makeFinding } from "./ledger.ts";
import { evaluateInvariants } from "./invariants.ts";
import { workerStale } from "./health.ts";
import type { LiveProbeInput, SentinelCheckResult, SentinelFinding } from "./types.ts";

export function evaluateChecks(input: LiveProbeInput): SentinelCheckResult[] {
  const checks: SentinelCheckResult[] = [];

  checks.push(checkHttp(input));
  checks.push(checkDb(input));
  checks.push(checkWorker(input));
  checks.push(checkGmail(input));
  checks.push(checkCalendar(input));
  checks.push(checkParser(input));
  checks.push(checkPlaces(input));
  checks.push(checkInvariants(input));
  checks.push(checkTestMode(input));

  return checks;
}

function checkHttp(input: LiveProbeInput): SentinelCheckResult {
  if (input.http.ok) {
    return ok("http", "sentinel", "Live site responded.", true, "cheap");
  }
  return fail("http", "sentinel", makeFinding(
    "HTTP_UNHEALTHY",
    "The live Lamb Ascension site did not return a healthy response.",
    { status: input.http.status || 0 },
  ), true, "cheap");
}

function checkDb(input: LiveProbeInput): SentinelCheckResult {
  if (input.db.ok) {
    return ok("db", "database", `Database responded (${input.db.source}).`, true, "cheap");
  }
  return fail("db", "database", makeFinding(
    "DATABASE_UNAVAILABLE",
    "Production database did not respond.",
    { error: input.db.error || "unavailable", source: input.db.source },
  ), false, "cheap");
}

function checkWorker(input: LiveProbeInput): SentinelCheckResult {
  if (!input.worker.secretPresent && input.worker.lastCompletedAt == null) {
    return fail("worker", "worker", makeFinding(
      "WORKER_NOT_CONFIGURED",
      "Outreach worker is not configured and has never been observed.",
      {},
    ), false, "none");
  }
  const stale = workerStale(input.worker.lastCompletedAt, input.now);
  if (stale || (input.worker.lastResult || "").startsWith("error")) {
    return fail("worker", "worker", makeFinding(
      "WORKER_STALE",
      "Outreach worker heartbeat is stale or the last run failed.",
      {
        lastCompletedAt: input.worker.lastCompletedAt,
        lastResult: input.worker.lastResult,
      },
    ), Boolean(input.worker.lastCompletedAt), "none");
  }
  return ok("worker", "worker", "Worker heartbeat is fresh.", true, "none");
}

function checkGmail(input: LiveProbeInput): SentinelCheckResult {
  if (!input.gmail.connected) {
    return fail("gmail", "gmail", makeFinding(
      "GMAIL_NOT_CONNECTED",
      "Gmail is not connected.",
      {},
    ), false, "none");
  }
  if (!input.gmail.tokenValid) {
    return fail("gmail", "gmail", makeFinding(
      "GMAIL_TOKEN_INVALID",
      "Gmail is connected, but the token is not valid.",
      { identity: input.gmail.identity },
    ), input.gmail.probed, "cheap");
  }
  return ok(
    "gmail",
    "gmail",
    input.gmail.identity ? `Gmail token valid (${input.gmail.identity}).` : "Gmail token valid.",
    input.gmail.probed || input.gmail.tokenValid,
    "cheap",
  );
}

function checkCalendar(input: LiveProbeInput): SentinelCheckResult {
  if (!input.calendar.connected) {
    return fail("calendar", "calendar", makeFinding(
      "CALENDAR_NOT_AUTHORIZED",
      "Google Calendar is not connected.",
      {},
    ), false, "none");
  }
  if (!input.calendar.tokenValid) {
    return fail("calendar", "calendar", makeFinding(
      "CALENDAR_TOKEN_REFRESH_FAILED",
      "Calendar is connected, but the token could not be used.",
      { listCode: input.calendar.listCode || "" },
    ), input.calendar.probed, "cheap");
  }
  if (input.calendar.probed && !input.calendar.listOk) {
    const code = input.calendar.listCode === "CALENDAR_LIST_PARSE_FAILED"
      ? "CALENDAR_LIST_PARSE_FAILED"
      : input.calendar.listCode === "CALENDAR_TOKEN_REFRESH_FAILED"
        ? "CALENDAR_TOKEN_REFRESH_FAILED"
        : "CALENDAR_LIST_AUTH_FAILED";
    return fail("calendar", "calendar", makeFinding(
      code,
      "Calendar event list did not succeed.",
      { listCode: input.calendar.listCode || "", skipped: input.calendar.skipped },
    ), true, "provider_read");
  }
  return ok(
    "calendar",
    "calendar",
    input.calendar.probed
      ? `Calendar list parsed (${input.calendar.parsedEvents} events).`
      : "Calendar token is present.",
    input.calendar.probed || input.calendar.tokenValid,
    input.calendar.probed ? "provider_read" : "cheap",
  );
}

function checkParser(input: LiveProbeInput): SentinelCheckResult {
  if (input.parser.threw || input.parser.kept === 0) {
    return fail("calendar-parser", "calendar", makeFinding(
      "CALENDAR_LIST_PARSE_FAILED",
      "The Calendar list parser failed a known malformed-event fixture.",
      { kept: input.parser.kept, skipped: input.parser.skipped, threw: input.parser.threw },
      { reproduction: "Parse a Google events.list body that includes a cancelled event, a missing start, and a conference payload. Readable events must still render." },
    ), true, "none");
  }
  return ok("calendar-parser", "calendar", `Parser kept ${input.parser.kept} readable events.`, true, "none");
}

function checkPlaces(input: LiveProbeInput): SentinelCheckResult {
  if (!input.places.keyConfigured) {
    return fail("places", "places", makeFinding(
      "PLACES_KEY_MISSING",
      "GOOGLE_PLACES_API_KEY is not configured. Find Clients stays fail-closed.",
      {},
    ), false, "none");
  }
  return ok("places", "places", "Google Places key is configured. No search was performed.", true, "none");
}

function checkInvariants(input: LiveProbeInput): SentinelCheckResult {
  const findings = evaluateInvariants(input.invariants);
  if (!findings.length) {
    return ok("invariants", "pipeline", "Pipeline, booking, and outreach invariants hold.", true, "cheap");
  }
  const feature = findings[0]?.feature || "pipeline";
  return {
    id: "invariants",
    feature,
    ok: false,
    observed: true,
    code: findings[0]!.code,
    detail: findings.map((f) => f.summary).join(" "),
    findings,
    cost: "cheap",
  };
}

function checkTestMode(input: LiveProbeInput): SentinelCheckResult {
  const leaks = input.invariants.testModeLeak;
  if (leaks.length) {
    return fail("test-mode", "test_mode", makeFinding(
      "TEST_MODE_INVARIANT_FAILED",
      "Test Mode is on, but a non-allowlisted send was recorded.",
      { count: leaks.length },
    ), true, "cheap");
  }
  return ok(
    "test-mode",
    "test_mode",
    input.testMode ? "Test Mode is on. Allowlist still enforced." : "Test Mode is off. Live outreach rules apply.",
    true,
    "none",
  );
}

function ok(
  id: string,
  feature: SentinelCheckResult["feature"],
  detail: string,
  observed: boolean,
  cost: SentinelCheckResult["cost"],
): SentinelCheckResult {
  return { id, feature, ok: true, observed, code: "SENTINEL_OK", detail, findings: [], cost };
}

function fail(
  id: string,
  feature: SentinelCheckResult["feature"],
  finding: SentinelFinding,
  observed: boolean,
  cost: SentinelCheckResult["cost"],
): SentinelCheckResult {
  return {
    id,
    feature,
    ok: false,
    observed,
    code: finding.code,
    detail: finding.summary,
    findings: [finding],
    cost,
  };
}
