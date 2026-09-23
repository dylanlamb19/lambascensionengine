import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAutopilotCommand,
  autonomyExecutionOff,
  autonomyTickEffects,
  autopilotAuthorized,
  legacyAutopilotUnauthorized,
  normalizeAutonomy,
  testModeDoesNotTouchAutopilot,
  ENABLE_AUTOPILOT_PHRASE,
} from "./settings.ts";
import { liveOutreachReadiness } from "./readiness.ts";
import { launchLight, voiceObservation } from "../sentinel/health.ts";

const legacyOn = {
  autonomous: true,
  prospecting: true,
  autoSend: true,
  autoFollowup: true,
  autoReply: true,
};

test("autopilot fails closed without an explicit owner marker", () => {
  assert.equal(autopilotAuthorized(normalizeAutonomy(undefined)), false);
  assert.equal(autopilotAuthorized(normalizeAutonomy({})), false);
  assert.equal(normalizeAutonomy({}).autonomous, false);
  assert.equal(normalizeAutonomy({}).autoReply, false);
  const legacy = normalizeAutonomy(legacyOn);
  assert.equal(legacy.autonomous, true);
  assert.equal(legacy.ownerEnabled, false);
  assert.equal(autopilotAuthorized(legacy), false);
  assert.equal(legacyAutopilotUnauthorized(legacyOn), true);
  const repaired = autonomyExecutionOff(legacyOn);
  assert.equal(autopilotAuthorized(repaired), false);
  assert.equal(repaired.autoReply, false);
  const enabled = applyAutopilotCommand(repaired, ENABLE_AUTOPILOT_PHRASE, "2026-09-23T22:00:00.000Z");
  assert.equal(enabled.ok, true);
  if (enabled.ok) {
    assert.equal(enabled.audit, "AUTOPILOT_ENABLED");
    assert.equal(autopilotAuthorized(enabled.settings), true);
    const off = applyAutopilotCommand(enabled.settings, "DISABLE AUTOPILOT", "2026-09-23T23:00:00.000Z");
    assert.equal(off.ok, true);
    if (off.ok) assert.equal(autonomyTickEffects(off.settings, false).firstContact, false);
  }
});

test("turning Test Mode off does not enable Autopilot or send", () => {
  const before = normalizeAutonomy(legacyOn);
  const flipped = testModeDoesNotTouchAutopilot(before, false);
  assert.equal(flipped.testMode, false);
  assert.equal(autopilotAuthorized(flipped.settings), false);
  const effects = autonomyTickEffects(flipped.settings, flipped.testMode);
  assert.equal(effects.discover, false);
  assert.equal(effects.firstContact, false);
  assert.equal(effects.autoReply, false);
  const authorized = applyAutopilotCommand(normalizeAutonomy({}), ENABLE_AUTOPILOT_PHRASE, "2026-09-23T22:00:00.000Z");
  assert.equal(authorized.ok, true);
  if (authorized.ok) {
    assert.equal(autonomyTickEffects(authorized.settings, true).firstContact, false);
    assert.equal(autonomyTickEffects(authorized.settings, false).firstContact, true);
  }
});

test("stale Ara voice does not fail production smoke or block a clean launch by itself", () => {
  const rows = [
    { feature: "gmail" as const, light: "green" as const, label: "Gmail", detail: "", observedAt: null },
    { feature: "ara_voice" as const, light: "yellow" as const, label: "Ara voice", detail: "Not recently observed.", observedAt: null },
  ];
  assert.equal(launchLight(rows), "green");
  assert.equal(voiceObservation(rows), "stale");
  assert.equal(launchLight([{ feature: "outreach", light: "red", label: "Outreach", detail: "bounce", observedAt: null }]), "red");
  const clean = liveOutreachReadiness({
    testFlowPassed: 8, testFlowTotal: 8,
    gmail: "green", database: "green", worker: "green", outreach: "green",
    calendar: "green", booking: "green", places: "green",
    highCriticalOutreach: 0, unknownDelivery: 0, dncFutureSends: 0, repliedFutureSends: 0, duplicateOutreach: 0,
    autopilotOn: false, liveCampaigns: 0, productionSha: "abc123", smoke: "pass",
  });
  assert.equal(clean.ready, true);
  assert.equal(liveOutreachReadiness({ ...cleanInput(), unknownDelivery: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...cleanInput(), autopilotOn: true }).ready, false);
  assert.equal(liveOutreachReadiness({ ...cleanInput(), liveCampaigns: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...cleanInput(), highCriticalOutreach: 1 }).ready, false);
});

function cleanInput() {
  return {
    testFlowPassed: 8, testFlowTotal: 8,
    gmail: "green" as const, database: "green" as const, worker: "green" as const, outreach: "green" as const,
    calendar: "green" as const, booking: "green" as const, places: "green" as const,
    highCriticalOutreach: 0, unknownDelivery: 0, dncFutureSends: 0, repliedFutureSends: 0, duplicateOutreach: 0,
    autopilotOn: false, liveCampaigns: 0, productionSha: "abc123", smoke: "pass" as const,
  };
}
