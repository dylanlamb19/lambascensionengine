import { featureLabel } from "./health.ts";
import type { SentinelSnapshot } from "./types.ts";

export type SentinelSpeech = {
  healthy: string;
  bugs: string;
  brokeToday: string;
  lastDeploy: string;
  worker: string;
  watching: string;
  spoken: string;
};

export function sentinelSpeech(snap: SentinelSnapshot, topic?: string): SentinelSpeech {
  const healthy = snap.overall === "green"
    ? "Yes. Sentinel last observed production as healthy."
    : snap.overall === "red"
      ? `No. Sentinel found ${snap.criticalOpen || snap.openIssues} production problem${(snap.criticalOpen || snap.openIssues) === 1 ? "" : "s"}.`
      : snap.overall === "yellow"
        ? "Not fully. Sentinel sees something that needs attention, but no critical outage."
        : "I don’t have a completed Sentinel observation yet, so I won’t guess.";

  const open = snap.bugs.filter((b) => b.status === "open");
  const bugs = !open.length
    ? "Sentinel has no open bugs on the ledger."
    : open.slice(0, 5).map((b) => `${b.error_code}: ${b.summary}`).join(" ");

  const today = open.filter((b) => isToday(b.last_seen_at) || isToday(b.first_seen_at));
  const brokeToday = !today.length
    ? "Sentinel did not record a new production break today."
    : today.map((b) => `${b.error_code} on ${featureLabel(b.feature)}.`).join(" ");

  const deploy = snap.lastDeploy;
  const lastDeploy = !deploy
    ? "Sentinel does not have a deployment comparison yet."
    : deploy.rollback_recommended
      ? `The latest production SHA is ${shortSha(deploy.new_sha)}. Sentinel recommends rollback to ${shortSha(deploy.known_good_sha) || "the last known-good checkpoint"}. ${deploy.rollback_reason} Dylan decides — Sentinel will not roll back by itself.`
      : `The latest production SHA is ${shortSha(deploy.new_sha)}. Previous was ${shortSha(deploy.previous_sha) || "unknown"}. Smoke: ${deploy.smoke_result || "not recorded"}.`;

  const worker = snap.subsystems.find((s) => s.feature === "worker");
  const workerAnswer = !worker
    ? "I don’t have a worker observation yet."
    : worker.light === "green"
      ? `Yes. ${worker.detail}`
      : worker.detail;

  const watching = snap.watching.length
    ? `Sentinel watches ${snap.watching.join(", ")}. It inspects, diagnoses, and records. It does not merge, deploy, or change Test Mode by itself.`
    : "Sentinel watches Gmail, Calendar, Google Places, the database, the outreach worker, booking, outreach safety, and Ara actions.";

  const spoken = pickTopic(topic, { healthy, bugs, brokeToday, lastDeploy, worker: workerAnswer, watching });
  return { healthy, bugs, brokeToday, lastDeploy, worker: workerAnswer, watching, spoken };
}

function pickTopic(
  topic: string | undefined,
  parts: Omit<SentinelSpeech, "spoken">,
): string {
  const t = (topic || "").toLowerCase();
  if (/watch/.test(t)) return parts.watching;
  if (/worker/.test(t)) return parts.worker;
  if (/deploy|sha|last (ship|release)/.test(t)) return parts.lastDeploy;
  if (/broke|today|what happened/.test(t)) return `${parts.brokeToday} ${parts.bugs}`.trim();
  if (/bug/.test(t)) return parts.bugs;
  return `${parts.healthy} ${parts.bugs}`.trim();
}

function shortSha(sha: string): string {
  return (sha || "").slice(0, 7);
}

function isToday(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export const SENTINEL_WATCHING = [
  "Gmail",
  "Calendar",
  "Google Places",
  "the database",
  "the outreach worker",
  "booking",
  "outreach safety",
  "Pipeline invariants",
  "Ara actions",
  "Test Mode",
];

export function parseSentinelAsk(text: string): { kind: "status" | "open" | "none"; topic?: string } {
  const t = (text || "").toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(open|show|go to)\b/.test(t) && /\b(system health|sentinel)\b/.test(t)) {
    return { kind: "open" };
  }
  if (
    /is lascengine healthy/.test(t)
    || /is (the )?(app|engine|production|lascengine) healthy/.test(t)
    || /are there any bugs/.test(t)
    || /what broke( today)?/.test(t)
    || /did the last (deploy|deployment) pass/.test(t)
    || /is the worker running/.test(t)
    || /what is sentinel watching/.test(t)
    || /any (production )?regressions/.test(t)
  ) {
    return { kind: "status", topic: t };
  }
  return { kind: "none" };
}
