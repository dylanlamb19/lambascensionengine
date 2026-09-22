import type { SentinelCode, SentinelFeature, SentinelMode, SentinelSeverity } from "./codes.ts";

export type HealthLight = "green" | "yellow" | "red" | "unknown";

export type SentinelEvidence = Record<string, string | number | boolean | null>;

export type SentinelFinding = {
  code: SentinelCode;
  severity: SentinelSeverity;
  feature: SentinelFeature;
  summary: string;
  evidence: SentinelEvidence;
  reproduction?: string;
  affected?: Array<Record<string, string>>;
  signature: string;
};

export type SentinelCheckResult = {
  id: string;
  feature: SentinelFeature;
  ok: boolean;
  observed: boolean;
  code: SentinelCode | "SENTINEL_OK";
  detail: string;
  findings: SentinelFinding[];
  cost: "none" | "cheap" | "provider_read";
};

export type SubsystemHealth = {
  feature: SentinelFeature;
  light: HealthLight;
  label: string;
  detail: string;
  observedAt: string | null;
};

export type SentinelBug = {
  bug_id: string;
  signature: string;
  first_seen_at: string;
  last_seen_at: string;
  status: "open" | "acknowledged" | "resolved" | "muted";
  severity: SentinelSeverity;
  feature: SentinelFeature;
  environment: string;
  production_sha: string;
  error_code: SentinelCode;
  summary: string;
  evidence: SentinelEvidence;
  reproduction_steps: string;
  affected_records: Array<Record<string, string>>;
  suspected_commit: string;
  regression_test: string;
  fix_branch: string;
  fix_commit: string;
  verification_status: string;
  occurrence_count: number;
  resolved_at: string | null;
};

export type SentinelRunRecord = {
  id: string;
  user_id: string;
  mode: SentinelMode;
  environment: string;
  production_sha: string;
  previous_sha: string;
  started_at: string;
  finished_at: string | null;
  overall: "healthy" | "degraded" | "critical" | "unknown";
  summary: string;
  check_count: number;
  finding_count: number;
};

export type SentinelDeployment = {
  id: string;
  previous_sha: string;
  new_sha: string;
  recorded_at: string;
  test_result: string;
  smoke_result: string;
  new_errors: string[];
  resolved_errors: string[];
  rollback_recommended: boolean;
  rollback_reason: string;
  known_good_sha: string;
};

export type SentinelSnapshot = {
  overall: HealthLight;
  overallLabel: string;
  lastRunAt: string | null;
  lastRunMode: string;
  productionSha: string;
  previousSha: string;
  openIssues: number;
  criticalOpen: number;
  highOpen: number;
  subsystems: SubsystemHealth[];
  alerts: SentinelBug[];
  bugs: SentinelBug[];
  lastDeploy: SentinelDeployment | null;
  rollback: { recommended: boolean; reason: string; knownGoodSha: string } | null;
  watching: string[];
  autoFix: false;
};

export type InvariantSnapshot = {
  duplicatePlaceIds: { placeId: string; uids: string[] }[];
  bookedMissingEventId: { id: string; prospectUid: string }[];
  bookedMissingPipeline: { googleEventId: string; prospectUid: string }[];
  replyButFollowupScheduled: { prospectUid: string; followupId: string }[];
  dncActiveSequence: { prospectUid: string; sequenceId: string }[];
  bounceFutureSends: { prospectUid: string; followupId: string }[];
  testInRevenue: { uid: string }[];
  testModeLeak: { messageId: string; recipient: string }[];
  duplicateActivity: { action: string; detail: string; count: number }[];
};

export type LiveProbeInput = {
  now: number;
  mode: SentinelMode;
  environment: string;
  productionSha: string;
  previousSha: string;
  db: { ok: boolean; source: "neon" | "pglite" | "none"; error?: string };
  http: { ok: boolean; status?: number };
  worker: {
    lastCompletedAt: number | null;
    lastResult: string;
    secretPresent: boolean;
  };
  gmail: { connected: boolean; tokenValid: boolean; identity: string; probed: boolean };
  calendar: {
    connected: boolean;
    tokenValid: boolean;
    listOk: boolean;
    listCode?: string;
    freeBusyOk: boolean;
    parsedEvents: number;
    skipped: number;
    probed: boolean;
  };
  places: { keyConfigured: boolean };
  testMode: boolean;
  parser: { kept: number; skipped: number; threw: boolean };
  invariants: InvariantSnapshot;
  voice?: { observed: boolean; ok: boolean; code?: string; detail?: string };
};
