import { getSql, type Sql } from "@/lib/db";
import { env } from "@/lib/env.server";
import { TEST_UID_LIKE, TEST_WORKFLOW_UID } from "@/lib/mail/test-loop";
import { autopilotAuthorized, normalizeAutonomy } from "./settings.ts";
import { liveOutreachReadiness, type LiveReadinessInput, type ReadinessLight } from "./readiness.ts";

const REAL = `prospect_uid <> '${TEST_WORKFLOW_UID}' and prospect_uid not like '${TEST_UID_LIKE}' and prospect_uid not like 'test-%'`;

async function count(sql: Sql, text: string, params: unknown[] = []): Promise<number | null> {
  try {
    const rows = await sql.query<{ n: number }>(text, params);
    return Number(rows[0]?.n || 0);
  } catch {
    return null;
  }
}

function light(ok: boolean | null): ReadinessLight {
  if (ok === true) return "green";
  if (ok === false) return "red";
  return "unknown";
}

export async function collectLiveOutreachReadiness(userId: string) {
  const checkedAt = new Date().toISOString();
  const productionSha = (process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  const input: LiveReadinessInput = {
    testFlowPassed: 0,
    testFlowTotal: 8,
    gmail: "unknown",
    database: "unknown",
    worker: "unknown",
    outreach: "unknown",
    calendar: "unknown",
    booking: "unknown",
    places: "unknown",
    pipeline: "unknown",
    highCriticalOutreach: -1,
    unknownDelivery: -1,
    dncFutureSends: -1,
    repliedFutureSends: -1,
    unsubscribedFutureSends: -1,
    bouncedFutureSends: -1,
    bookedFutureSends: -1,
    wonLostFutureSends: -1,
    duplicateOutreach: -1,
    pendingRealFollowups: -1,
    activeRealSequences: -1,
    autopilotOn: true,
    liveCampaigns: -1,
    productionSha,
    smoke: "unknown",
    voiceLiveSend: "green",
  };
  try {
    const sql = await getSql();
    input.database = "green";
    const { loadIntegrationStatus } = await import("@/lib/mail/integration-status.server");
    const { scoreLiveChecks, secretPresent } = await import("@/lib/mail/test-mode");
    const { loadTestState, loadWorkerHeartbeat } = await import("@/lib/mail/sql.server");
    const { workerLight } = await import("@/lib/mail/heartbeat");
    const integration = await loadIntegrationStatus(userId);
    input.gmail = light(Boolean(integration.gmail_connected && integration.gmail_token_valid));
    input.calendar = light(Boolean(integration.calendar_connected && integration.calendar_token_valid));
    const beat = await loadWorkerHeartbeat();
    const worker = workerLight({
      secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
      lastCompletedAt: beat.lastCompletedAt,
      lastResult: beat.lastResult,
      now: Date.now(),
    });
    input.worker = worker.state === "running" ? "green" : "red";
    input.places = env("GOOGLE_PLACES_API_KEY") ? "green" : "red";
    const state = await loadTestState(userId);
    const flow = scoreLiveChecks({
      messageId: state.message_id,
      threadId: state.thread_id,
      replyCount: state.reply_count,
      followupsBeforeReply: state.followups_before,
      followupsAfterSync: state.followups_after,
      sequenceId: state.sequence_id,
      slotsOffered: state.slots_offered,
      eventId: state.event_id,
      pipelineStage: state.pipeline_stage,
      workerRunId: state.worker_run_id,
      workerSeenAt: state.worker_seen_at,
      secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    });
    input.testFlowPassed = flow.filter((check) => check.ok).length;
    const uid = [userId];
    input.pendingRealFollowups = await count(sql, `select count(*)::int as n from scheduled_followups where user_id = $1 and status in ('scheduled','sending') and ${REAL}`, uid) ?? -1;
    input.activeRealSequences = await count(sql, `select count(*)::int as n from outreach_sequences where user_id = $1 and status = 'active' and ${REAL}`, uid) ?? -1;
    input.unknownDelivery = await count(sql, `select count(*)::int as n from email_messages where user_id = $1 and status = 'UNKNOWN_DELIVERY'`, uid) ?? -1;
    input.dncFutureSends = await count(sql, `select count(*)::int as n from outreach_sequences s join prospects p on p.user_id = s.user_id and p.uid = s.prospect_uid where s.user_id = $1 and s.status = 'active' and (p.suppressed = true or p.stage ilike '%do not contact%')`, uid) ?? -1;
    input.repliedFutureSends = await count(sql, `select count(*)::int as n from scheduled_followups f where f.user_id = $1 and f.status = 'scheduled' and exists (select 1 from reply_events r where r.user_id = f.user_id and r.prospect_uid = f.prospect_uid)`, uid) ?? -1;
    input.unsubscribedFutureSends = await count(sql, `select count(*)::int as n from scheduled_followups f join prospects p on p.user_id = f.user_id and p.uid = f.prospect_uid where f.user_id = $1 and f.status = 'scheduled' and p.stage ilike '%unsub%'`, uid) ?? -1;
    input.bouncedFutureSends = await count(sql, `select count(*)::int as n from scheduled_followups f where f.user_id = $1 and f.status = 'scheduled' and exists (select 1 from email_messages m where m.user_id = f.user_id and m.prospect_uid = f.prospect_uid and m.status ilike '%bounce%')`, uid) ?? -1;
    input.bookedFutureSends = await count(sql, `select count(*)::int as n from scheduled_followups f join prospects p on p.user_id = f.user_id and p.uid = f.prospect_uid where f.user_id = $1 and f.status = 'scheduled' and p.stage = 'Call Booked'`, uid) ?? -1;
    input.wonLostFutureSends = await count(sql, `select count(*)::int as n from scheduled_followups f join prospects p on p.user_id = f.user_id and p.uid = f.prospect_uid where f.user_id = $1 and f.status = 'scheduled' and p.stage in ('Won','Lost')`, uid) ?? -1;
    input.duplicateOutreach = await count(sql, `select count(*)::int as n from (select prospect_uid from outreach_sequences where user_id = $1 and status = 'active' and ${REAL} group by prospect_uid having count(*) > 1) d`, uid) ?? -1;
    input.liveCampaigns = await count(sql, `select count(*)::int as n from email_campaigns where user_id = $1 and live_enabled = true`, uid) ?? -1;
    const bookingMiss = await count(sql, `select count(*)::int as n from calendar_events ce left join prospects p on p.user_id = ce.user_id and p.uid = ce.prospect_uid where ce.user_id = $1 and ce.status = 'booked' and coalesce(p.stage,'') not in ('Call Booked','Proposal Sent','Negotiation','Won','Lost','Do Not Contact')`, uid);
    input.booking = light(bookingMiss === 0);
    input.pipeline = input.booking;
    input.outreach = light(input.unknownDelivery === 0 && input.dncFutureSends === 0 && input.bouncedFutureSends === 0);
    const autonomyRows = await sql.query<{ autonomy: unknown }>(`select autonomy from outreach_settings where user_id = $1`, uid);
    input.autopilotOn = autopilotAuthorized(normalizeAutonomy(autonomyRows[0]?.autonomy || {}));
    const { latestDeployment } = await import("@/lib/sentinel/sql.server");
    const deploy = await latestDeployment();
    if (productionSha && deploy?.new_sha === productionSha && (deploy.smoke_result === "healthy" || deploy.smoke_result === "pass")) input.smoke = "pass";
    else if (deploy && (deploy.smoke_result === "critical" || deploy.smoke_result === "fail")) input.smoke = "fail";
    input.highCriticalOutreach = await count(sql, `select count(*)::int as n from sentinel_bugs where status = 'open' and severity in ('high','critical') and feature <> 'ara_voice'`) ?? -1;
  } catch {
    input.database = "red";
  }
  const result = liveOutreachReadiness(input);
  const checks = [
    ["Test Sales Flow", input.testFlowPassed === 8, `${input.testFlowPassed}/8`],
    ["Gmail", input.gmail === "green", input.gmail],
    ["Database", input.database === "green", input.database],
    ["Worker", input.worker === "green", input.worker],
    ["Outreach safety", input.outreach === "green", input.outreach],
    ["Calendar", input.calendar === "green", input.calendar],
    ["Booking", input.booking === "green", input.booking],
    ["Pipeline sync", input.pipeline === "green", input.pipeline],
    ["Google Places", input.places === "green", input.places],
    ["Unknown delivery", input.unknownDelivery === 0, String(input.unknownDelivery)],
    ["Pending real follow-ups", input.pendingRealFollowups === 0, String(input.pendingRealFollowups)],
    ["Active real sequences", input.activeRealSequences === 0, String(input.activeRealSequences)],
    ["Live campaigns", input.liveCampaigns === 0, String(input.liveCampaigns)],
    ["Acquisition Autopilot", input.autopilotOn === false, input.autopilotOn ? "ON" : "OFF"],
    ["Production smoke", input.smoke === "pass", input.smoke],
    ["Production SHA", Boolean(input.productionSha), input.productionSha || "missing"],
    ["Voice live-send", true, input.voiceLiveSend],
  ].map(([name, ok, detail]) => ({ name: String(name), ok: Boolean(ok), detail: String(detail) }));
  return { ...result, checks, productionSha, checkedAt, input };
}
