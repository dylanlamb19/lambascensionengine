import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateChecks } from "./checks.ts";
import { EMPTY_INVARIANTS } from "./invariants.ts";
import { runCalendarParserFixture, MALFORMED_CALENDAR_FIXTURE } from "./parser.ts";
import { overallFromSubsystems, overallLabel, rollupSubsystems } from "./health.ts";
import { sentinelSpeech } from "./speech.ts";
import { parseSentinelAsk } from "./speech.ts";
import { mayAutoFix, SENTINEL_AUTO_FIX } from "./fix-prep.ts";
import type { LiveProbeInput } from "./types.ts";

function healthy(over: Partial<LiveProbeInput> = {}): LiveProbeInput {
  const now = Date.parse("2026-09-21T20:15:00-05:00");
  return {
    now,
    mode: "fixture",
    environment: "test",
    productionSha: "abc1234",
    previousSha: "aaa1111",
    db: { ok: true, source: "neon" },
    http: { ok: true, status: 200 },
    worker: { lastCompletedAt: now - 60_000, lastResult: "ok sent=0", secretPresent: true },
    gmail: { connected: true, tokenValid: true, identity: "owner@x.com", probed: true },
    calendar: {
      connected: true,
      tokenValid: true,
      listOk: true,
      freeBusyOk: true,
      parsedEvents: 3,
      skipped: 2,
      probed: true,
    },
    places: { keyConfigured: true },
    testMode: true,
    parser: { kept: 3, skipped: 2, threw: false },
    invariants: EMPTY_INVARIANTS,
    ...over,
  };
}

describe("Sentinel checks", () => {
  it("Example E: all healthy → no findings and green rollup", () => {
    const checks = evaluateChecks(healthy());
    assert.ok(checks.every((c) => c.ok));
    const now = Date.parse("2026-09-21T20:15:00.000Z");
    const subsystems = rollupSubsystems(checks, [], {
      gmail: "2026-09-21T20:15:00.000Z",
      calendar: "2026-09-21T20:15:00.000Z",
      places: "2026-09-21T20:15:00.000Z",
      database: "2026-09-21T20:15:00.000Z",
      worker: "2026-09-21T20:14:00.000Z",
      booking: "2026-09-21T20:15:00.000Z",
      outreach: "2026-09-21T20:15:00.000Z",
      ara: "2026-09-21T20:15:00.000Z",
    }, now);
    assert.equal(overallFromSubsystems(subsystems), "green");
    assert.ok(subsystems.every((s) => s.light === "green"));
    assert.match(overallLabel("green", 0), /healthy/i);
  });

  it("Example A: Calendar parser fixture with unexpected event shape", () => {
    const parsed = runCalendarParserFixture(MALFORMED_CALENDAR_FIXTURE);
    assert.equal(parsed.threw, false);
    assert.equal(parsed.kept, 3);
    assert.ok(parsed.skipped >= 1);
    const broken = runCalendarParserFixture([{ totally: "wrong" }]);
    const checks = evaluateChecks(healthy({ parser: { kept: broken.kept, skipped: broken.skipped, threw: broken.threw || broken.kept === 0 } }));
    const parser = checks.find((c) => c.id === "calendar-parser");
    assert.equal(parser?.ok, false);
    assert.equal(parser?.code, "CALENDAR_LIST_PARSE_FAILED");
  });

  it("Example B: stale worker heartbeat is WORKER_STALE", () => {
    const checks = evaluateChecks(healthy({
      worker: { lastCompletedAt: Date.parse("2026-09-21T18:00:00-05:00"), lastResult: "ok", secretPresent: true },
    }));
    const worker = checks.find((c) => c.id === "worker");
    assert.equal(worker?.ok, false);
    assert.equal(worker?.code, "WORKER_STALE");
  });

  it("Example C: reply but follow-up remains scheduled", () => {
    const checks = evaluateChecks(healthy({
      invariants: {
        ...EMPTY_INVARIANTS,
        replyButFollowupScheduled: [{ prospectUid: "p1", followupId: "fu-9" }],
      },
    }));
    const inv = checks.find((c) => c.id === "invariants");
    assert.equal(inv?.ok, false);
    assert.equal(inv?.code, "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY");
    const subsystems = rollupSubsystems(checks, [], {});
    assert.equal(subsystems.find((s) => s.feature === "outreach")?.light, "red");
  });

  it("Example D: duplicate Place ID", () => {
    const checks = evaluateChecks(healthy({
      invariants: {
        ...EMPTY_INVARIANTS,
        duplicatePlaceIds: [{ placeId: "ChIJ-dup", uids: ["a", "b"] }],
      },
    }));
    const inv = checks.find((c) => c.id === "invariants");
    assert.equal(inv?.code, "PROSPECT_DUPLICATE_IDENTITY");
    const subsystems = rollupSubsystems(checks, [], {});
    assert.equal(subsystems.find((s) => s.feature === "places")?.light, "red");
    assert.equal(overallFromSubsystems(subsystems), "red");
  });

  it("does not treat configuration-only as green for worker", () => {
    const checks = evaluateChecks(healthy({
      worker: { lastCompletedAt: null, lastResult: "", secretPresent: true },
    }));
    assert.equal(checks.find((c) => c.id === "worker")?.code, "WORKER_STALE");
  });

  it("Ara speech comes from persisted snapshot, not invention", () => {
    const spoken = sentinelSpeech({
      overall: "red",
      overallLabel: "1 regression detected",
      lastRunAt: "2026-09-21T20:15:00.000Z",
      lastRunMode: "light",
      productionSha: "4427fde",
      previousSha: "438b77f",
      openIssues: 1,
      criticalOpen: 0,
      highOpen: 1,
      subsystems: [],
      alerts: [],
      bugs: [{
        bug_id: "bug-1",
        signature: "sig",
        first_seen_at: "2026-09-21T17:42:00.000Z",
        last_seen_at: "2026-09-21T20:15:00.000Z",
        status: "open",
        severity: "high",
        feature: "calendar",
        environment: "production",
        production_sha: "438b77f",
        error_code: "CALENDAR_LIST_PARSE_FAILED",
        summary: "Calendar list could not be read",
        evidence: {},
        reproduction_steps: "",
        affected_records: [],
        suspected_commit: "",
        regression_test: "",
        fix_branch: "",
        fix_commit: "",
        verification_status: "unverified",
        occurrence_count: 2,
        resolved_at: null,
      }],
      lastDeploy: {
        id: "d1",
        previous_sha: "438b77f",
        new_sha: "4427fde",
        recorded_at: "2026-09-21T20:00:00.000Z",
        test_result: "pass",
        smoke_result: "pass",
        new_errors: [],
        resolved_errors: ["CALENDAR_LIST_PARSE_FAILED"],
        rollback_recommended: false,
        rollback_reason: "",
        known_good_sha: "4427fde",
      },
      rollback: null,
      watching: ["Calendar"],
      autoFix: false,
    }, "bugs");
    assert.match(spoken.bugs, /CALENDAR_LIST_PARSE_FAILED/);
    assert.match(spoken.healthy, /No/);
  });

  it("Auto-Fix stays OFF", () => {
    assert.equal(SENTINEL_AUTO_FIX, false);
    assert.equal(mayAutoFix("calendar_parser").allowed, false);
  });

  it("parses owner health questions without treating them as mutations", () => {
    assert.equal(parseSentinelAsk("Is lascengine healthy?").kind, "status");
    assert.equal(parseSentinelAsk("Are there any bugs?").kind, "status");
    assert.equal(parseSentinelAsk("Open System Health").kind, "open");
    assert.equal(parseSentinelAsk("delete everything from my calendar").kind, "none");
  });
});
