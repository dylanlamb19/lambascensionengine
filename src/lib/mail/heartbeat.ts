export const WORKER_STALE_MS = 15 * 60 * 1000;

export type WorkerLightState = "running" | "configured" | "missing";

export function minutesAgo(from: number, now: number): number {
  return Math.max(0, Math.floor((now - from) / 60000));
}

export function workerLight(opts: {
  secretPresent: boolean;
  lastCompletedAt: number | null;
  now: number;
  staleMs?: number;
  lastResult?: string;
}): { state: WorkerLightState; detail: string } {
  if (!opts.secretPresent && opts.lastCompletedAt == null) {
    return { state: "missing", detail: "🔴 Worker not configured" };
  }
  if ((opts.lastResult || "").startsWith("error")) {
    return { state: "configured", detail: "🔴 Worker last run failed" };
  }
  if (opts.lastCompletedAt == null) {
    return { state: "configured", detail: "🟡 Worker configured but no run observed yet" };
  }
  const staleMs = opts.staleMs ?? WORKER_STALE_MS;
  const mins = minutesAgo(opts.lastCompletedAt, opts.now);
  if (opts.now - opts.lastCompletedAt > staleMs) {
    return {
      state: "configured",
      detail: `🟡 Worker configured but last run was ${mins} minute${mins === 1 ? "" : "s"} ago`,
    };
  }
  return {
    state: "running",
    detail: `🟢 Worker running — last successful run ${mins} minute${mins === 1 ? "" : "s"} ago`,
  };
}

/** Scheduler ✅ needs a real tick that saw the test workflow. A secret or a sequence is not enough. */
export function schedulerEvidenceOk(opts: {
  secretPresent?: boolean;
  sequenceId?: string | null;
  followupsScheduled?: number;
  workerRunId?: string | null;
  workerSeenAt?: string | number | null;
}): boolean {
  void opts.secretPresent;
  void opts.sequenceId;
  void opts.followupsScheduled;
  return Boolean(opts.workerRunId) && Boolean(opts.workerSeenAt);
}