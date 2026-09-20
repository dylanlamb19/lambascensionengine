import { env } from "@/lib/env.server";
import { googleOAuthConfigured } from "@/lib/google/oauth";
import { gmailProfile } from "@/lib/google/gmail";
import { probeFreeBusy } from "@/lib/google/calendar";
import { accessFor } from "./live.server";
import { googleStatus, loadSettings, loadWorkerHeartbeat } from "./sql.server";
import { secretPresent } from "./test-mode";
import { workerLight } from "./heartbeat";
import type { IntegrationStatus } from "./integration-status";

export async function loadIntegrationStatus(
  userId: string,
  opts?: { probeLive?: boolean },
): Promise<IntegrationStatus> {
  const settings = await loadSettings(userId);
  const accounts = await googleStatus(userId);
  const beat = await loadWorkerHeartbeat();
  const worker = workerLight({
    secretPresent: secretPresent(env("OUTREACH_JOB_SECRET") || env("CRON_SECRET")),
    lastCompletedAt: beat.lastCompletedAt,
    now: Date.now(),
  });

  let gmail_token_valid = false;
  let gmail_identity = accounts.gmailEmail || "";
  if (accounts.gmail === "connected") {
    const tokens = await accessFor(userId, "gmail");
    gmail_token_valid = Boolean(tokens);
    if (tokens?.email) gmail_identity = tokens.email;
    if (opts?.probeLive && tokens) {
      const prof = await gmailProfile(tokens.access_token);
      if (prof.ok) gmail_identity = prof.email;
      else gmail_token_valid = false;
    }
  }

  let calendar_freebusy_valid = false;
  let calendar_token_valid = false;
  let calendar_identity = accounts.calendarEmail || "";
  if (accounts.calendar === "connected" || accounts.calendar === "attention") {
    const tokens = await accessFor(userId, "calendar");
    calendar_token_valid = Boolean(tokens);
    if (tokens?.email) calendar_identity = tokens.email;
    if (tokens && opts?.probeLive) {
      const probe = await probeFreeBusy(tokens.access_token);
      calendar_freebusy_valid = probe.ok;
      if (!probe.ok) calendar_token_valid = probe.code !== "TOKEN_INVALID";
    }
  }

  return {
    google_oauth_configured: googleOAuthConfigured(),
    gmail_connected: accounts.gmail === "connected" || accounts.gmail === "attention",
    gmail_identity,
    gmail_token_valid,
    calendar_connected: accounts.calendar === "connected" || accounts.calendar === "attention",
    calendar_identity,
    calendar_token_valid,
    calendar_freebusy_valid,
    worker_configured: worker.state !== "missing",
    worker_last_success: beat.lastCompletedAt ? new Date(beat.lastCompletedAt).toISOString() : null,
    worker_state: worker.state,
    worker_detail: worker.detail,
    test_mode: settings.testMode,
  };
}
