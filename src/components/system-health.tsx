"use client";

import { useState } from "react";
import type { HealthLight, SentinelSnapshot } from "@/lib/sentinel/types";
import { featureLabel } from "@/lib/sentinel/health";
import { canonicalHealth } from "@/lib/sentinel/system-health";

function lightClass(light: HealthLight): string {
  if (light === "green") return "la-dot-good";
  if (light === "red") return "la-dot-bad";
  if (light === "yellow") return "la-dot-warn";
  return "la-dot-warn";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Not yet";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Not yet";
  return d.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

function shortSha(sha: string): string {
  return (sha || "").slice(0, 7) || "unknown";
}

function isBookingMismatch(errorCode: string | undefined): boolean {
  const code = (errorCode || "").toUpperCase();
  return code.includes("PIPELINE_STATE_MISMATCH") || (code.includes("BOOKING") && code.includes("MISMATCH"));
}

export function SystemHealthAlert({
  snapshot,
  onOpen,
  onRepair,
  repairing,
}: {
  snapshot: SentinelSnapshot | null;
  onOpen: () => void;
  onRepair?: () => void;
  repairing?: boolean;
}) {
  const alert = snapshot?.alerts[0];
  if (!snapshot || !alert) return null;
  const showRepair = Boolean(onRepair) && isBookingMismatch(alert.error_code);
  return (
    <div className="la-ribbon la-ribbon-bad mb-3">
      <span>
        <b>{alert.summary}</b>
        <span className="mt-1 block text-sm">
          Sentinel found {alert.error_code}. First seen {formatWhen(alert.first_seen_at)}.
          Production SHA {shortSha(alert.production_sha)}. Sentinel did not change production.
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        {showRepair ? (
          <button type="button" className="la-btn la-btn-primary" disabled={Boolean(repairing)} onClick={onRepair}>
            {repairing ? "Fixing\u2026" : "Fix booking mismatch"}
          </button>
        ) : null}
        <button type="button" className="la-btn la-btn-quiet" onClick={onOpen}>Open System Health</button>
      </span>
    </div>
  );
}

export function SystemHealthStrip({
  snapshot,
  onOpen,
}: {
  snapshot: SentinelSnapshot | null;
  onOpen: () => void;
}) {
  const light = snapshot?.overall || "unknown";
  return (
    <button type="button" className="la-quiet-status mb-3" onClick={onOpen}>
      <span className={`la-dot la-dot-inline ${lightClass(light)}`} />
      System Health \u00b7 {snapshot?.overallLabel || "Checking\u2026"}
      {snapshot?.lastRunAt ? ` \u00b7 ${formatWhen(snapshot.lastRunAt)}` : ""}
    </button>
  );
}

export function SystemHealthPage({
  snapshot,
  running,
  onBack,
  onRun,
  onRepair,
  repairing,
}: {
  snapshot: SentinelSnapshot | null;
  running: boolean;
  onBack: () => void;
  onRun: () => void;
  onRepair?: () => void;
  repairing?: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const snap = snapshot;
  const health = canonicalHealth({ snapshot: snap });
  const mismatchOpen = Boolean(
    onRepair && (snap?.alerts || []).some((a) => isBookingMismatch(a.error_code)),
  );
  return (
    <section className="la-card">
      <p className="la-kicker">Lascengine Sentinel</p>
      <h2 className="font-display mt-2 text-2xl">System Health</h2>
      <p className="mt-2 text-sm text-muted">
        Sentinel watches Lamb Ascension. It inspects production. It does not send email, change Calendar, or merge fixes.
      </p>
      <p className="mt-4 text-sm">
        <span className={`la-dot la-dot-inline ${lightClass(snap?.overall || "unknown")}`} />
        {snap?.overallLabel || "Sentinel has not observed production yet."}
      </p>
      <p className="mt-1 text-sm text-muted">
        Latest Sentinel run: {formatWhen(health.latestRun)}
        {snap?.lastRunMode ? ` \u00b7 ${snap.lastRunMode}` : ""} \u00b7 Open issues: {health.openIssues}
      </p>
      <div className="mt-5 grid gap-2">
        {(snap?.subsystems || []).map((row) => (
          <div key={row.feature} className="la-list-row">
            <span>
              <span className={`la-dot la-dot-inline ${lightClass(row.light)}`} />
              <b>{row.label}</b>
              <span className="mt-0.5 block text-sm text-muted">{row.detail}</span>
            </span>
          </div>
        ))}
      </div>
      {snap?.alerts.length ? (
        <div className="la-ribbon la-ribbon-bad mt-5">
          {snap.alerts.map((a) => (
            <span key={a.bug_id} className="block">
              <b>{a.summary}</b> \u00b7 {a.error_code} \u00b7 SHA {shortSha(a.production_sha)} \u00b7 seen {a.occurrence_count}\u00d7
            </span>
          ))}
        </div>
      ) : (
        <div className="la-ribbon la-ribbon-good mt-5">No high or critical regressions on the ledger.</div>
      )}
      {snap?.rollback?.recommended ? (
        <div className="la-ribbon la-ribbon-bad mt-3">{snap.rollback.reason}</div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="la-btn la-btn-primary" disabled={running} onClick={onRun}>
          {running ? "Checking\u2026" : "Check now"}
        </button>
        {mismatchOpen ? (
          <button type="button" className="la-btn la-btn-primary" disabled={Boolean(repairing) || running} onClick={onRepair}>
            {repairing ? "Fixing\u2026" : "Fix booking mismatch"}
          </button>
        ) : null}
        <button type="button" className="la-btn la-btn-ghost" onClick={onBack}>Back</button>
        <button type="button" className="la-btn la-btn-quiet" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "Hide details" : "Advanced details"}
        </button>
      </div>
      {advanced && snap ? (
        <div className="mt-5 text-sm text-muted">
          <p>Production SHA {shortSha(snap.productionSha) || "unknown"}{snap.previousSha ? ` \u00b7 previous ${shortSha(snap.previousSha)}` : ""}</p>
          <p className="mt-1">Auto-Fix is OFF. Sentinel will not merge or deploy.</p>
          {snap.lastDeploy ? (
            <p className="mt-1">Last deployment smoke: {snap.lastDeploy.smoke_result || "n/a"}.</p>
          ) : null}
          {snap.bugs.length ? (
            <ul className="mt-3 list-disc pl-5">
              {snap.bugs.map((b) => (
                <li key={b.bug_id}>
                  {b.error_code} \u00b7 {featureLabel(b.feature)} \u00b7 {b.severity} \u00b7 {b.status}
                </li>
              ))}
            </ul>
          ) : <p className="mt-3">Ledger is clear.</p>}
          <p className="mt-3">Watching: {(snap.watching || []).join(", ")}.</p>
        </div>
      ) : null}
    </section>
  );
}
