import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { sentinelSpeech } from "./speech.ts";
import type { SentinelSnapshot } from "./types.ts";
import type { SentinelMode } from "./codes.ts";

const EMPTY: SentinelSnapshot = {
  overall: "unknown",
  overallLabel: "Sentinel has not observed production yet",
  lastRunAt: null,
  lastRunMode: "",
  productionSha: "",
  previousSha: "",
  openIssues: 0,
  criticalOpen: 0,
  highOpen: 0,
  subsystems: [],
  alerts: [],
  bugs: [],
  lastDeploy: null,
  rollback: null,
  watching: [],
  autoFix: false,
};

export const sentinelStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    try {
      const { loadSentinelSnapshot } = await import("./run.server");
      const snapshot = await loadSentinelSnapshot();
      return { ok: true as const, snapshot, speech: sentinelSpeech(snapshot) };
    } catch {
      return { ok: true as const, snapshot: EMPTY, speech: sentinelSpeech(EMPTY) };
    }
  });

export const sentinelRunFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { mode?: SentinelMode } | undefined) => data || {})
  .handler(async ({ data, context }) => {
    const mode = data.mode === "deep" ? "deep" : "owner";
    const { runSentinel } = await import("./run.server");
    const result = await runSentinel({ userId: context.userId, mode });
    return {
      ok: true as const,
      snapshot: result.snapshot,
      speech: sentinelSpeech(result.snapshot),
      autoFix: false as const,
      mutatedProduction: false as const,
    };
  });
