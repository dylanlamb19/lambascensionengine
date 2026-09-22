import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHealth, falseZeroForbidden, homeIssueLine } from "./system-health.ts";
import type { SentinelBug, SentinelSnapshot } from "./types.ts";

function bug(over: Partial<SentinelBug> = {}): SentinelBug {
  return {
    bug_id: "sen_1",
    signature: "sig",
    first_seen_at: "2026-09-21T17:42:00.000Z",
    last_seen_at: "2026-09-21T20:15:00.000Z",
    status: "open",
    severity: "high",
    feature: "booking",
    environment: "production",
    production_sha: "533f7dc",
    error_code: "PIPELINE_STATE_MISMATCH",
    summary: "A Google Calendar booking exists without a matching Call Booked pipeline state.",
    evidence: { googleEventId: "gcal-abc", prospectUid: "uid-fire" },
    reproduction_steps: "",
    affected_records: [{ googleEventId: "gcal-abc", prospectUid: "uid-fire" }],
    suspected_commit: "",
    regression_test: "",
    fix_branch: "",
    fix_commit: "",
    verification_status: "unverified",
    occurrence_count: 1,
    resolved_at: null,
    ...over,
  };
}

function snap(over: Partial<SentinelSnapshot> = {}): SentinelSnapshot {
  const open = over.bugs || [bug()];
  return {
    overall: "red",
    overallLabel: "1 regression detected",
    lastRunAt: "2026-09-21T20:15:00.000Z",
    lastRunMode: "light",
    productionSha: "533f7dc",
    previousSha: "",
    openIssues: open.filter((b) => b.status === "open" || b.status === "acknowledged").length,
    criticalOpen: open.filter((b) => b.status === "open" && b.severity === "critical").length,
    highOpen: open.filter((b) => b.status === "open" && b.severity === "high").length,
    subsystems: [{ feature: "booking", light: "red", label: "Booking", detail: "mismatch", observedAt: "2026-09-21T20:15:00.000Z" }],
    alerts: open.filter((b) => (b.status === "open" || b.status === "acknowledged") && (b.severity === "high" || b.severity === "critical")),
    bugs: open,
    lastDeploy: null,
    rollback: null,
    watching: [],
    autoFix: false,
    ...over,
  };
}

test("unresolved Sentinel issue increments Home issue count", () => {
  const health = canonicalHealth({ snapshot: snap(), prospectIssueCount: 0 });
  assert.equal(health.systemIssues, 1);
  assert.equal(health.prospectIssues, 0);
  assert.equal(health.openIssues, 1);
  assert.equal(health.highCount, 1);
  assert.match(homeIssueLine(health), /1 system issue/);
  assert.doesNotMatch(homeIssueLine(health), /^0 issues need attention$/);
  assert.equal(falseZeroForbidden(health), true);
});

test("resolved issue disappears from open count but remains in history", () => {
  const resolved = bug({ status: "resolved", resolved_at: "2026-09-21T21:00:00.000Z", fix_commit: "abc1234", verification_status: "observed_clear" });
  const health = canonicalHealth({
    snapshot: snap({
      overall: "green",
      overallLabel: "Everything is healthy",
      bugs: [resolved],
      alerts: [],
      openIssues: 0,
      highOpen: 0,
      criticalOpen: 0,
      subsystems: [{ feature: "booking", light: "green", label: "Booking", detail: "invariants hold", observedAt: "2026-09-21T21:00:00.000Z" }],
    }),
    prospectIssueCount: 0,
  });
  assert.equal(health.systemIssues, 0);
  assert.equal(health.openIssues, 0);
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolved_at);
  assert.equal(resolved.fix_commit, "abc1234");
});

test("Home, System Health, and Ara all report the same open issue count", () => {
  const snapshot = snap();
  const health = canonicalHealth({ snapshot, prospectIssueCount: 0 });
  assert.equal(health.openIssues, snapshot.openIssues);
  assert.equal(health.systemIssues, snapshot.alerts.length);
  assert.equal(health.overallLabel, snapshot.overallLabel);
});

test("no false 0 issues while any unresolved HIGH/CRITICAL issue exists", () => {
  const health = canonicalHealth({ snapshot: snap(), prospectIssueCount: 0 });
  assert.equal(health.prospectIssues, 0);
  assert.ok(health.systemIssues >= 1);
  assert.notEqual(homeIssueLine(health), "Everything is good");
  assert.doesNotMatch(homeIssueLine(health), /0 issues need attention/);
});
