/** Locked production bugs that must keep a regression test forever. */

export const LOCKED_REGRESSIONS = [
  { id: "gmail-live-state-race", test: "src/lib/mail/integration-status.test.ts", summary: "Gmail live-state race must not report disconnected while connected." },
  { id: "calendar-freebusy-primary", test: "src/lib/google/calendar-errors.test.ts", summary: "Calendar free/busy primary-ID mismatch." },
  { id: "worker-get-post-scheduler", test: "src/lib/mail/reliability.test.ts", summary: "Worker GET/POST scheduler mismatch." },
  { id: "calendar-personal-event-refusal", test: "src/lib/calendar/owner-event.test.ts", summary: "Calendar personal-event refusal." },
  { id: "duplicate-first-send-key", test: "src/lib/mail/reliability.test.ts", summary: "Duplicate first-send idempotency key." },
  { id: "test-booking-persistence", test: "src/lib/mail/booking-evidence.test.ts", summary: "TEST booking persistence after Calendar create." },
  { id: "places-missing-key-fail-closed", test: "src/lib/discovery/status.test.ts", summary: "Places missing-key fail closed." },
  { id: "pipeline-stale-filter", test: "src/lib/prospects/view-filter.test.ts", summary: "Pipeline stale filter composition." },
  { id: "calendar-list-parser", test: "src/lib/google/calendar-errors.test.ts", summary: "Calendar list parser failures and Postgres Date sort." },
  { id: "calendar-bulk-delete-loop", test: "src/lib/calendar/owner-event.test.ts", summary: "Repeated destructive Calendar actions." },
  { id: "sentinel-parser-fixture", test: "src/lib/sentinel/checks.test.ts", summary: "Sentinel Calendar parser fixture." },
  { id: "sentinel-worker-stale", test: "src/lib/sentinel/checks.test.ts", summary: "Sentinel WORKER_STALE." },
  { id: "sentinel-followup-after-reply", test: "src/lib/sentinel/invariants.test.ts", summary: "Follow-up still scheduled after reply." },
  { id: "sentinel-duplicate-place", test: "src/lib/sentinel/invariants.test.ts", summary: "Duplicate Google Place ID." },
] as const;
