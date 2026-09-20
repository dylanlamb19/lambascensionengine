import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildScreenContext } from "../voice/screen-context.ts";
import { emptyDesk, type DeskWorld } from "../voice/desk-actions.ts";
import { autoAnnounceFromScreen, settingsBlockerSpeech } from "../voice/read-screen.ts";
import { buildAraInstructions } from "../voice/ara-context.ts";
import { type AraDeskContext } from "../voice/tools.ts";
import {
  calendarHealth,
  gmailHealth,
  INTEGRATIONS_LOADING_INSTRUCTION,
  integrationInstructionBlock,
  integrationSpeech,
  oauthCredentialGaps,
  oauthOnlyGaps,
  resolvedCalendarHealth,
  resolvedGmailHealth,
  type IntegrationStatus,
} from "./integration-status.ts";

const currentProduction: IntegrationStatus = {
  google_oauth_configured: true,
  gmail_connected: true,
  gmail_identity: "lambascension99@gmail.com",
  gmail_token_valid: true,
  calendar_connected: false,
  calendar_identity: "",
  calendar_token_valid: false,
  calendar_freebusy_valid: false,
  worker_configured: true,
  worker_last_success: null,
  worker_state: "configured",
  worker_detail: "🟡 Worker configured but no run observed yet",
  test_mode: true,
};

function worldFrom(status: IntegrationStatus): DeskWorld {
  return {
    prospects: [],
    tasks: [],
    gmail: gmailHealth(status),
    calendarStatus: calendarHealth(status),
    testMode: status.test_mode,
    integration: status,
    missingIntegrations: [],
  };
}

function deskFrom(status: IntegrationStatus): AraDeskContext {
  const ctx = buildScreenContext(emptyDesk({ view: "settings" }), worldFrom(status));
  return {
    view: "settings",
    openUid: null,
    companyName: null,
    taskTitle: null,
    tasks: [],
    prospects: [],
    gmail: gmailHealth(status),
    calendar: calendarHealth(status),
    testMode: status.test_mode,
    allowlist: [],
    availableActions: [],
    confirmationOpen: false,
    evidenceOpen: false,
    pipelineStage: null,
    screen: ctx.screen,
    lookingAt: ctx.lookingAt,
    important: ctx.important,
    nextFocus: ctx.next,
    screenFacts: ctx.facts,
    integration: status,
  };
}

test("TEST 1 — Gmail connected, Calendar disconnected: Ara does not say Gmail is missing", () => {
  const speech = integrationSpeech(currentProduction);
  assert.equal(speech.gmailAnswer, "Yes. Gmail is connected and the token is valid.");
  assert.doesNotMatch(speech.setupRemaining, /Gmail still needs to be connected|Gmail isn’t connected/);
  assert.match(speech.setupRemaining, /Google Calendar still needs to be connected/);
  assert.match(speech.setupRemaining, /outreach worker hasn’t completed an observed run yet/);
  assert.doesNotMatch(speech.settingsImportant, /Google isn’t configured yet/);
  assert.doesNotMatch(speech.settingsImportant, /Gmail isn’t connected/);
  assert.match(speech.settingsImportant, /Gmail is connected and the token is valid/);
  assert.match(speech.settingsImportant, /Google Calendar still needs/);

  const ctx = buildScreenContext(emptyDesk({ view: "settings" }), worldFrom(currentProduction));
  assert.match(ctx.important, /Gmail is connected and the token is valid/);
  assert.doesNotMatch(ctx.important, /Google isn’t configured yet/);
  assert.doesNotMatch(ctx.important, /Gmail and Calendar can’t connect yet/);
  const auto = autoAnnounceFromScreen(ctx);
  assert.equal(auto, null);

  const instructions = buildAraInstructions(deskFrom(currentProduction));
  assert.match(instructions, /gmail_connected: true/);
  assert.match(instructions, /Yes\. Gmail is connected and the token is valid/);
  assert.doesNotMatch(instructions, /Google isn’t configured yet/);
});

test("TEST 2 — reload Settings keeps Gmail green / connected in the same model", () => {
  const first = integrationSpeech(currentProduction);
  const second = integrationSpeech({ ...currentProduction });
  assert.equal(first.settingsImportant, second.settingsImportant);
  assert.equal(gmailHealth(currentProduction), "connected");
  assert.equal(calendarHealth(currentProduction), "missing");
});

test("TEST 3 — new Ara session after reload still answers Yes for Gmail", () => {
  const instructions = buildAraInstructions(deskFrom(currentProduction));
  assert.match(instructions, /If Dylan asks whether Gmail is connected, answer: Yes\. Gmail is connected and the token is valid/);
  assert.match(instructions, /Never say Gmail is missing when gmail_connected is true/);
});

test("TEST 4 — OAuth callback refresh speech flips disconnected → connected", () => {
  const before: IntegrationStatus = { ...currentProduction, gmail_connected: false, gmail_token_valid: false, gmail_identity: "" };
  const after = currentProduction;
  const beforeCtx = buildScreenContext(emptyDesk({ view: "settings" }), worldFrom(before));
  const afterCtx = buildScreenContext(emptyDesk({ view: "settings" }), worldFrom(after));
  assert.match(beforeCtx.important, /Gmail isn’t connected/);
  assert.match(afterCtx.important, /Gmail is connected and the token is valid/);
  assert.notEqual(beforeCtx.important, afterCtx.important);
});

test("TEST 5 — Calendar remains disconnected; only Calendar is not connected", () => {
  const speech = integrationSpeech(currentProduction);
  assert.match(speech.settingsImportant, /Google Calendar still needs to be connected/);
  assert.doesNotMatch(speech.settingsImportant, /Gmail isn’t connected/);
  const ctx = buildScreenContext(emptyDesk({ view: "settings" }), worldFrom(currentProduction));
  const calendarFact = ctx.facts.find((f) => /Calendar/i.test(f.text));
  assert.ok(calendarFact);
  assert.notEqual(calendarFact?.kind, "ERROR");
  const gmailFact = ctx.facts.find((f) => /Gmail is connected/i.test(f.text));
  assert.equal(gmailFact?.kind, "VERIFIED");
});

test("TEST 6 — worker has no observed run: yellow, Gmail stays green", () => {
  const speech = integrationSpeech(currentProduction);
  assert.match(speech.setupRemaining, /outreach worker hasn’t completed an observed run yet/);
  assert.doesNotMatch(speech.setupRemaining, /Gmail isn’t connected/);
  assert.equal(gmailHealth(currentProduction), "connected");
  assert.equal(currentProduction.worker_state, "configured");
  assert.equal(currentProduction.worker_last_success, null);
  const ctx = buildScreenContext(emptyDesk({ view: "settings" }), worldFrom(currentProduction));
  assert.match(ctx.important, /Gmail is connected/);
  assert.doesNotMatch(ctx.important, /Worker not configured/);
});

test("oauth credential gaps are the only Google-isn’t-configured case", () => {
  const gaps = oauthCredentialGaps([
    { name: "Google OAuth Client ID", ready: false },
    { name: "Google OAuth Client Secret", ready: true },
    { name: "APP_SECRET", ready: true },
  ]);
  assert.deepEqual(gaps, ["Google OAuth Client ID"]);
  const empty = { ...currentProduction, google_oauth_configured: false, gmail_connected: false, gmail_token_valid: false };
  const speech = integrationSpeech(empty, gaps);
  assert.match(speech.settingsImportant, /Google isn’t configured yet/);
  assert.match(speech.gmailAnswer, /Google isn’t configured yet/);
  assert.equal(settingsBlockerSpeech(gaps).includes("Google isn’t configured yet"), true);
});

test("instruction block never tells Ara Gmail is missing when connected", () => {
  const block = integrationInstructionBlock(currentProduction);
  assert.match(block, /gmail_connected: true/);
  assert.doesNotMatch(block, /gmail_connected: false/);
  assert.match(block, /Calendar is separate from Gmail|Gmail and Calendar are separate/);
});

test("stale Gmail/Calendar connection rows cannot produce Google-isn’t-configured speech", () => {
  const stale = [
    { name: "Gmail connection", ready: false },
    { name: "Calendar connection", ready: false },
  ];
  assert.deepEqual(oauthOnlyGaps(stale.map((m) => m.name)), []);
  const world: DeskWorld = {
    ...worldFrom(currentProduction),
    missingIntegrations: stale,
  };
  const ctx = buildScreenContext(emptyDesk({ view: "settings" }), world);
  assert.match(ctx.important, /Gmail is connected and the token is valid/);
  assert.doesNotMatch(ctx.important, /Google isn’t configured yet/);
  assert.doesNotMatch(ctx.important, /Gmail connection/);
  assert.doesNotMatch(ctx.important, /Gmail and Calendar can’t connect yet/);
  const withoutModel = buildScreenContext(emptyDesk({ view: "settings" }), {
    prospects: [],
    tasks: [],
    gmail: "connected",
    calendarStatus: "missing",
    testMode: true,
    missingIntegrations: stale,
  });
  assert.match(withoutModel.important, /Gmail is connected/);
  assert.doesNotMatch(withoutModel.important, /Google isn’t configured yet/);
});

test("OAuth callback still persists tokens and owner desk refetches readiness", () => {
  const callback = readFileSync(new URL("../../routes/api/google/callback.ts", import.meta.url), "utf8");
  assert.match(callback, /saveGoogleAccount/);
  assert.doesNotMatch(callback, /disconnectGoogle/);
  assert.doesNotMatch(callback, /delete from google_accounts/i);
  const desk = readFileSync(new URL("../../components/owner-desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /refreshIntegration/);
  assert.match(desk, /applyIntegration/);
  assert.doesNotMatch(desk, /gmailConnection:\s*"Gmail connection"/);
  assert.match(desk, /onIntegration=\{applyIntegration\}/);
});

test("not-loaded-yet is UNKNOWN, never disconnected", () => {
  assert.equal(resolvedGmailHealth(null), "unknown");
  assert.equal(resolvedGmailHealth(undefined), "unknown");
  assert.equal(resolvedGmailHealth(currentProduction), "connected");
  assert.equal(resolvedCalendarHealth(null), "unknown");
  assert.equal(resolvedCalendarHealth(currentProduction), "missing");
});

test("Home loading state must not auto-announce Gmail isn’t connected", () => {
  const loading: DeskWorld = {
    prospects: [],
    tasks: [],
    gmail: "unknown",
    calendarStatus: "unknown",
    testMode: true,
  };
  const ctx = buildScreenContext(emptyDesk({ view: "home" }), loading);
  assert.doesNotMatch(ctx.facts.map((f) => f.text).join(" | "), /Gmail isn’t connected/);
  assert.equal(autoAnnounceFromScreen(ctx), null);
  const settingsLoading = buildScreenContext(emptyDesk({ view: "settings" }), loading);
  assert.match(settingsLoading.important, /checking your integrations/i);
  assert.doesNotMatch(settingsLoading.important, /Gmail isn’t connected/);
  assert.equal(autoAnnounceFromScreen(settingsLoading), null);
});

test("legacy default gmail=missing without integration is the stale-Home race; unknown is the fix", () => {
  const staleDefault: DeskWorld = {
    prospects: [],
    tasks: [],
    gmail: "missing",
    calendarStatus: "missing",
    testMode: true,
  };
  const staleHome = buildScreenContext(emptyDesk({ view: "home" }), staleDefault);
  assert.match(staleHome.facts.map((f) => f.text).join(" | "), /Gmail isn’t connected/);
  const auto = autoAnnounceFromScreen(staleHome);
  assert.ok(auto);
  assert.match(auto?.text || "", /Gmail isn’t connected/);

  const unknownHome = buildScreenContext(emptyDesk({ view: "home" }), {
    ...staleDefault,
    gmail: "unknown",
    calendarStatus: "unknown",
  });
  assert.doesNotMatch(unknownHome.facts.map((f) => f.text).join(" | "), /Gmail isn’t connected/);
  assert.equal(autoAnnounceFromScreen(unknownHome), null);
});

test("after IntegrationStatus resolves connected, Home still does not say Gmail isn’t connected", () => {
  const ctx = buildScreenContext(emptyDesk({ view: "home" }), worldFrom(currentProduction));
  assert.doesNotMatch(ctx.facts.map((f) => f.text).join(" | "), /Gmail isn’t connected/);
  assert.equal(autoAnnounceFromScreen(ctx), null);
  assert.equal(speechSetup(), "Google Calendar still needs to be connected, and the outreach worker hasn’t completed an observed run yet.");
});

function speechSetup(): string {
  return integrationSpeech(currentProduction).setupRemaining;
}

test("Ara session without IntegrationStatus is told UNKNOWN, not gmail_connected false", () => {
  const ctx = buildScreenContext(emptyDesk({ view: "home" }), {
    prospects: [],
    tasks: [],
    gmail: "unknown",
    calendarStatus: "unknown",
    testMode: true,
  });
  const desk: AraDeskContext = {
    view: "home",
    openUid: null,
    companyName: null,
    taskTitle: null,
    tasks: [],
    prospects: [],
    gmail: "unknown",
    calendar: "unknown",
    testMode: true,
    allowlist: [],
    availableActions: [],
    confirmationOpen: false,
    evidenceOpen: false,
    pipelineStage: null,
    screen: ctx.screen,
    lookingAt: ctx.lookingAt,
    important: ctx.important,
    nextFocus: ctx.next,
    screenFacts: ctx.facts,
  };
  const instructions = buildAraInstructions(desk);
  assert.match(instructions, /gmail_connected: unknown/);
  assert.match(instructions, /UNKNOWN/);
  assert.match(instructions, /Do not say Gmail isn’t connected/);
  assert.doesNotMatch(instructions, /gmail_connected: false/);
  assert.ok(INTEGRATIONS_LOADING_INSTRUCTION.length > 20);
});

test("owner desk defaults Gmail to unknown and waits for IntegrationStatus before auto-announce", () => {
  const desk = readFileSync(new URL("../../components/owner-desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /gmail: "unknown" as ConnectionHealth/);
  assert.match(desk, /if \(!integration\) return;/);
  assert.match(desk, /INTEGRATION_STATE_MISMATCH/);
  assert.match(desk, /if \(!liveRef\.current\.integration\)/);
});

test("Ara Calendar answers before and after connection", () => {
  const before = integrationSpeech(currentProduction);
  assert.equal(before.calendarAnswer, "No. Gmail is connected, but Google Calendar still needs to be connected.");
  const afterStatus: IntegrationStatus = {
    ...currentProduction,
    calendar_connected: true,
    calendar_token_valid: true,
    calendar_identity: "lambascension99@gmail.com",
    calendar_freebusy_valid: true,
  };
  const after = integrationSpeech(afterStatus);
  assert.equal(after.calendarAnswer, "Yes. Google Calendar is connected.");
  assert.equal(
    after.setupRemaining,
    "Gmail and Google Calendar are connected. The outreach worker still needs a successful observed run.",
  );
  assert.equal(calendarHealth(afterStatus), "connected");
});

test("Calendar page does not treat unknown as disconnected", () => {
  const ctx = buildScreenContext(emptyDesk({ view: "calendar" }), {
    prospects: [],
    tasks: [],
    gmail: "connected",
    calendarStatus: "unknown",
    testMode: true,
  });
  assert.match(ctx.important, /checking Calendar/i);
  assert.doesNotMatch(ctx.important, /isn’t connected yet/);
  assert.equal(autoAnnounceFromScreen(ctx), null);
});

test("callback still uses /api/google/callback and never deletes Gmail rows", () => {
  const callback = readFileSync(new URL("../../routes/api/google/callback.ts", import.meta.url), "utf8");
  assert.match(callback, /createFileRoute\("\/api\/google\/callback"\)/);
  assert.match(callback, /saveGoogleAccount\(rec\.userId, rec\.kind/);
  assert.doesNotMatch(callback, /disconnectGoogle/);
  const oauth = readFileSync(new URL("../google/oauth.ts", import.meta.url), "utf8");
  assert.match(oauth, /include_granted_scopes/);
  assert.match(oauth, /login_hint/);
  assert.match(oauth, /calendar\.events/);
  assert.match(oauth, /calendar\.freebusy/);
  assert.doesNotMatch(oauth, /auth\/calendar"/);
});

