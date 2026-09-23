/**
 * Sentinel run orchestrator. Inspect / diagnose / record only.
 * Never sends mail, never creates or deletes Calendar events, never
 * writes OAuth, never disables Test Mode, never merges or deploys.
 */
import { env } from "@/lib/env.server";
import { evaluateChecks, checkVoice } from "./checks.ts";
import { launchLight, overallGrade, overallLabel, rollupSubsystems, recentlyObserved, voiceObservation } from "./health.ts";
import { runCalendarParserFixture } from "./parser.ts";
import { SENTINEL_WATCHING } from "./speech.ts";
import { SENTINEL_AUTO_FIX } from "./fix-prep.ts";
import { EMPTY_INVARIANTS } from "./invariants.ts";
import { placesKeyConfigured } from "@/lib/discovery/status";
import { secretPresent } from "@/lib/mail/test-mode";
import type { LiveProbeInput, SentinelFinding, SentinelSnapshot } from "./types.ts";
import type { SentinelMode } from "./codes.ts";

function productionSha(): string {
  return (env("VERCEL_GIT_COMMIT_SHA") || env("GITHUB_SHA") || "").trim();
}

function wantsProviderRead(mode: SentinelMode): boolean {
  return mode === "deep" || mode === "post_deploy";
}

export async function runSentinel(opts: {
  userId: string;
  mode: SentinelMode;
  environment?: string;
}): Promise<{ snapshot: SentinelSnapshot; findings: SentinelFinding[] }> {
  const {
    pingDatabase,
    loadInvariantSnapshot,
    insertRun,
    upsertFindings,
    resolveMissing,
    listOpenBugs,
    touchHeartbeat,
    loadHeartbeats,
    latestDeployment,
    recordDeployment,
    lastKnownGoodSha,
    latestRun,
  } = await import("./sql.server");
  const { loadIntegrationStatus } = await import("@/lib/mail/integration-status.server");
  const { loadWorkerHeartbeat } = await import("@/lib/mail/sql.server");

  const mode = opts.mode;
  const environment = opts.environment || (env("VERCEL_ENV") || "production");
  const sha = productionSha();
  const prev = (await latestRun())?.production_sha || "";
  const now = Date.now();

  const db = await pingDatabase();
  await touchHeartbeat("db", db.ok, db.ok ? "SENTINEL_OK" : "DATABASE_UNAVAILABLE", db.ok ? db.source : db.error || "db");

  const parser = runCalendarParserFixture();
  let invariants = EMPTY_INVARIANTS;
  if (db.ok) {
    try {
      invariants = await loadInvariantSnapshot(opts.userId);
    } catch {
      invariants = EMPTY_INVARIANTS;
    }
  }

  const beat = db.ok ? await loadWorkerHeartbeat().catch(() => ({ lastCompletedAt: null, lastResult: "", lastStartedAt: null, runId: null, source: "" })) : { lastCompletedAt: null, lastResult: "", lastStartedAt: null, runId: null, source: "" };
  const workerSecret = secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET"));

  let gmail = { connected: false, tokenValid: false, identity: "", probed: false };
  let calendar = {
    connected: false,
    tokenValid: false,
    listOk: false,
    listCode: "",
    freeBusyOk: false,
    parsedEvents: 0,
    skipped: 0,
    probed: false,
  };
  let testMode = true;

  if (db.ok) {
    try {
      const integration = await loadIntegrationStatus(opts.userId, { probeLive: wantsProviderRead(mode) });
      testMode = integration.test_mode;
      gmail = {
        connected: integration.gmail_connected,
        tokenValid: integration.gmail_token_valid,
        identity: integration.gmail_identity,
        probed: wantsProviderRead(mode),
      };
      calendar = {
        connected: integration.calendar_connected,
        tokenValid: integration.calendar_token_valid,
        listOk: false,
        listCode: integration.calendar_freebusy_code || "",
        freeBusyOk: integration.calendar_freebusy_valid,
        parsedEvents: 0,
        skipped: 0,
        probed: wantsProviderRead(mode),
      };
      if (wantsProviderRead(mode) && integration.calendar_connected) {
        const listed = await probeCalendarList(opts.userId);
        calendar.listOk = listed.ok;
        calendar.listCode = listed.code;
        calendar.parsedEvents = listed.count;
        calendar.skipped = listed.skipped;
        calendar.probed = true;
        if (!listed.ok && listed.code === "CALENDAR_TOKEN_REFRESH_FAILED") calendar.tokenValid = false;
      }
    } catch {
      /* fail closed into evaluateChecks */
    }
  }

  const priorBeats = db.ok ? await loadHeartbeats().catch(() => ({} as Awaited<ReturnType<typeof loadHeartbeats>>)) : {};
  const voiceBeat = priorBeats.ara_voice;
  const voiceObserved = Boolean(voiceBeat && recentlyObserved(voiceBeat.lastCheckAt || voiceBeat.lastOkAt || null, now));

  const input: LiveProbeInput = {
    now,
    mode,
    environment,
    productionSha: sha,
    previousSha: prev,
    db,
    http: { ok: true, status: 200 },
    worker: {
      lastCompletedAt: beat.lastCompletedAt,
      lastResult: beat.lastResult,
      secretPresent: workerSecret,
    },
    gmail,
    calendar,
    places: { keyConfigured: placesKeyConfigured() },
    testMode,
    parser,
    invariants,
    voice: {
      observed: voiceObserved,
      ok: Boolean(voiceBeat?.observedOk),
      code: voiceBeat?.lastCode || "",
      detail: voiceBeat?.observedOk ? "mint ok" : (voiceBeat?.lastCode || ""),
    },
  };

  const checks = evaluateChecks(input);
  const findings = checks.flatMap((c) => c.findings);

  await touchHeartbeat("gmail", gmail.connected && gmail.tokenValid, gmail.tokenValid ? "SENTINEL_OK" : "GMAIL_TOKEN_INVALID", gmail.identity || "");
  await touchHeartbeat("calendar", calendar.connected && calendar.tokenValid && (calendar.probed ? calendar.listOk : true) && !parser.threw, parser.threw ? "CALENDAR_LIST_PARSE_FAILED" : calendar.listOk || !calendar.probed ? "SENTINEL_OK" : (calendar.listCode || "CALENDAR_LIST_AUTH_FAILED"), calendar.listOk ? `${calendar.parsedEvents} events` : calendar.listCode);
  await touchHeartbeat("places", placesKeyConfigured() && !findings.some((f) => f.code === "PROSPECT_DUPLICATE_IDENTITY"), placesKeyConfigured() ? (findings.some((f) => f.code === "PROSPECT_DUPLICATE_IDENTITY") ? "PROSPECT_DUPLICATE_IDENTITY" : "SENTINEL_OK") : "PLACES_KEY_MISSING", placesKeyConfigured() ? "configured" : "missing");
  await touchHeartbeat("worker", !checks.find((c) => c.id === "worker")?.findings.length, checks.find((c) => c.id === "worker")?.code || "SENTINEL_OK", checks.find((c) => c.id === "worker")?.detail || "");
  const bookingOk = !findings.some((f) => f.feature === "booking" || f.code === "PIPELINE_STATE_MISMATCH" || f.code === "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE");
  const outreachOk = !findings.some((f) => f.feature === "outreach" || f.feature === "test_mode" || f.code === "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY" || f.code === "DNC_SEQUENCE_ACTIVE" || f.code === "BOUNCE_FUTURE_SEND_SCHEDULED" || f.code === "TEST_MODE_INVARIANT_FAILED");
  const araOk = !findings.some((f) => f.feature === "ara");
  await touchHeartbeat("booking", bookingOk && db.ok, bookingOk ? "SENTINEL_OK" : (findings.find((f) => f.feature === "booking" || f.code === "PIPELINE_STATE_MISMATCH")?.code || "PIPELINE_STATE_MISMATCH"), bookingOk ? "invariants hold" : "invariant failed");
  await touchHeartbeat("outreach", outreachOk && db.ok, outreachOk ? "SENTINEL_OK" : (findings.find((f) => f.feature === "outreach" || f.feature === "test_mode")?.code || "PIPELINE_STATE_MISMATCH"), outreachOk ? "invariants hold" : "invariant failed");
  await touchHeartbeat("ara", araOk && db.ok, araOk ? "SENTINEL_OK" : "ARA_ACTION_DUPLICATE", araOk ? "no duplicate actions" : "duplicate action");
  await touchHeartbeat("sentinel", true, "SENTINEL_OK", mode);

  if (findings.length) await upsertFindings(findings, { environment, productionSha: sha });
  const resolvedCodes = await resolveMissing(findings.map((f) => f.signature), sha);
  const openBugs = await listOpenBugs();
  const beats = await loadHeartbeats();
  const observedAt: Record<string, string | null> = {
    gmail: beats.gmail?.lastOkAt || null,
    calendar: beats.calendar?.lastOkAt || null,
    places: beats.places?.lastOkAt || null,
    database: beats.db?.lastOkAt || null,
    worker: beats.worker?.lastOkAt || null,
    booking: beats.booking?.lastOkAt || beats.db?.lastOkAt || null,
    outreach: beats.outreach?.lastOkAt || beats.worker?.lastOkAt || null,
    ara: beats.ara?.lastOkAt || beats.sentinel?.lastOkAt || null,
    ara_voice: beats.ara_voice?.lastOkAt || beats.ara_voice?.lastCheckAt || null,
  };
  const subsystems = rollupSubsystems(checks, openBugs, observedAt);
  const overall = launchLight(subsystems);
  const voice = voiceObservation(subsystems);
  const grade = overallGrade(overall);
  const summary = overall === "green" && voice === "stale"
    ? "Outreach systems are healthy. Ara voice observation is stale."
    : overallLabel(overall, openBugs.length);

  await insertRun({
    userId: opts.userId,
    mode,
    environment,
    productionSha: sha,
    previousSha: prev,
    overall: grade,
    summary,
    checkCount: checks.length,
    findingCount: findings.length,
    payload: {
      checks: checks.map((c) => ({ id: c.id, ok: c.ok, code: c.code, cost: c.cost })),
      autoFix: SENTINEL_AUTO_FIX,
    },
  });

  if (mode === "post_deploy" && sha) {
    const knownGood = grade === "healthy" ? sha : await lastKnownGoodSha();
    const rollback = grade === "critical" && Boolean(knownGood) && knownGood !== sha;
    await recordDeployment({
      previousSha: prev,
      newSha: sha,
      testResult: "not_run_in_process",
      smokeResult: grade === "healthy" && voice === "stale" ? "healthy" : grade,
      newErrors: findings.map((f) => f.code),
      resolvedErrors: resolvedCodes,
      rollbackRecommended: rollback,
      rollbackReason: rollback
        ? `Critical regression began at SHA ${sha.slice(0, 7)}. Previous verified checkpoint ${knownGood.slice(0, 7)} was healthy. Rollback is available. Dylan decides.`
        : "",
      knownGoodSha: knownGood,
    });
  }

  const lastDeploy = await latestDeployment();
  const snapshot: SentinelSnapshot = {
    overall,
    overallLabel: summary,
    lastRunAt: new Date(now).toISOString(),
    lastRunMode: mode,
    productionSha: sha,
    previousSha: prev,
    openIssues: openBugs.length,
    criticalOpen: openBugs.filter((b) => b.severity === "critical").length,
    highOpen: openBugs.filter((b) => b.severity === "high").length,
    subsystems,
    alerts: openBugs.filter((b) => b.severity === "critical" || b.severity === "high"),
    bugs: openBugs,
    lastDeploy,
    rollback: lastDeploy?.rollback_recommended
      ? { recommended: true, reason: lastDeploy.rollback_reason, knownGoodSha: lastDeploy.known_good_sha }
      : null,
    watching: SENTINEL_WATCHING,
    autoFix: false,
  };
  return { snapshot, findings };
}

async function probeCalendarList(userId: string): Promise<{ ok: boolean; code: string; count: number; skipped: number }> {
  try {
    const { accessFor } = await import("@/lib/mail/live.server");
    const { listEvents } = await import("@/lib/google/calendar");
    const tokens = await accessFor(userId, "calendar");
    if (!tokens) return { ok: false, code: "CALENDAR_NOT_AUTHORIZED", count: 0, skipped: 0 };
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const listed = await listEvents(tokens.access_token, from, to, fetch, tokens.email);
    if (!listed.ok) return { ok: false, code: listed.code, count: 0, skipped: 0 };
    return { ok: true, code: "SENTINEL_OK", count: listed.events.length, skipped: 0 };
  } catch {
    return { ok: false, code: "CALENDAR_LIST_UPSTREAM_5XX", count: 0, skipped: 0 };
  }
}

export async function loadSentinelSnapshot(): Promise<SentinelSnapshot> {
  const { listOpenBugs, latestRun, loadHeartbeats, latestDeployment } = await import("./sql.server");
  let openBugs: Awaited<ReturnType<typeof listOpenBugs>> = [];
  let run: Awaited<ReturnType<typeof latestRun>> = null;
  let beats: Awaited<ReturnType<typeof loadHeartbeats>> = {};
  let lastDeploy: Awaited<ReturnType<typeof latestDeployment>> = null;
  try {
    [openBugs, run, beats, lastDeploy] = await Promise.all([
      listOpenBugs(),
      latestRun(),
      loadHeartbeats(),
      latestDeployment(),
    ]);
  } catch {
    openBugs = [];
  }
  const observedAt: Record<string, string | null> = {
    gmail: beats.gmail?.lastOkAt || null,
    calendar: beats.calendar?.lastOkAt || null,
    places: beats.places?.lastOkAt || null,
    database: beats.db?.lastOkAt || null,
    worker: beats.worker?.lastOkAt || null,
    booking: beats.booking?.lastOkAt || beats.db?.lastOkAt || null,
    outreach: beats.outreach?.lastOkAt || beats.worker?.lastOkAt || null,
    ara: beats.ara?.lastOkAt || beats.sentinel?.lastOkAt || null,
    ara_voice: beats.ara_voice?.lastOkAt || beats.ara_voice?.lastCheckAt || null,
  };
  const voiceObserved = Boolean(beats.ara_voice && recentlyObserved(beats.ara_voice.lastCheckAt || beats.ara_voice.lastOkAt || null));
  const voiceCheck = checkVoice({
    voice: {
      observed: voiceObserved,
      ok: Boolean(beats.ara_voice?.observedOk),
      code: beats.ara_voice?.lastCode || "",
      detail: beats.ara_voice?.observedOk ? "mint ok" : (beats.ara_voice?.lastCode || ""),
    },
  });
  const subsystems = rollupSubsystems([voiceCheck], openBugs, observedAt);
  const overall = run
    ? (run.overall === "healthy" ? "green" : run.overall === "critical" ? "red" : run.overall === "degraded" ? "yellow" : "unknown")
    : launchLight(subsystems);
  return {
    overall,
    overallLabel: overallLabel(overall, openBugs.length),
    lastRunAt: run?.finished_at || run?.started_at || null,
    lastRunMode: run?.mode || "",
    productionSha: run?.production_sha || productionSha(),
    previousSha: run?.previous_sha || "",
    openIssues: openBugs.length,
    criticalOpen: openBugs.filter((b) => b.severity === "critical").length,
    highOpen: openBugs.filter((b) => b.severity === "high").length,
    subsystems,
    alerts: openBugs.filter((b) => b.severity === "critical" || b.severity === "high"),
    bugs: openBugs,
    lastDeploy,
    rollback: lastDeploy?.rollback_recommended
      ? { recommended: true, reason: lastDeploy.rollback_reason, knownGoodSha: lastDeploy.known_good_sha }
      : null,
    watching: SENTINEL_WATCHING,
    autoFix: false,
  };
}
