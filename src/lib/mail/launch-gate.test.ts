import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { liveOutreachReadiness } from "../autonomy/readiness.ts";
import { CONTROLLED_LIVE_CAPS, TEST_CAPS, effectiveCaps, gateTestModeDisable } from "./test-mode.ts";
import { confirmSendPhraseOk, hasTerminalCancellationClause, voiceMayMutate } from "../voice/intents.ts";

function ready() {
  return {
    testFlowPassed: 8, testFlowTotal: 8,
    gmail: "green" as const, database: "green" as const, worker: "green" as const, outreach: "green" as const,
    calendar: "green" as const, booking: "green" as const, places: "green" as const, pipeline: "green" as const,
    highCriticalOutreach: 0, unknownDelivery: 0, dncFutureSends: 0, repliedFutureSends: 0,
    unsubscribedFutureSends: 0, bouncedFutureSends: 0, bookedFutureSends: 0, wonLostFutureSends: 0,
    duplicateOutreach: 0, pendingRealFollowups: 0, activeRealSequences: 0,
    autopilotOn: false, liveCampaigns: 0, productionSha: "abc123", smoke: "pass" as const,
    voiceLiveSend: "disabled" as const,
  };
}

test("DISABLE is refused unless server readiness is clean", () => {
  const blocked = liveOutreachReadiness({ ...ready(), testFlowPassed: 7 });
  assert.equal(blocked.ready, false);
  assert.equal(gateTestModeDisable({ confirm: "DISABLE", testMode: true, readiness: blocked }).ok, false);
  assert.equal(gateTestModeDisable({ confirm: "disable", testMode: true, readiness: liveOutreachReadiness(ready()) }).ok, false);
  const open = gateTestModeDisable({ confirm: "DISABLE", testMode: true, readiness: liveOutreachReadiness(ready()) });
  assert.equal(open.ok, true);
});

test("launch blockers cover follow-ups, suppression, smoke, and campaigns", () => {
  assert.equal(liveOutreachReadiness({ ...ready(), pendingRealFollowups: 3 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), activeRealSequences: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), unknownDelivery: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), dncFutureSends: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), repliedFutureSends: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), bookedFutureSends: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), liveCampaigns: 1 }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), productionSha: "" }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), smoke: "unknown" }).ready, false);
  assert.equal(liveOutreachReadiness({ ...ready(), smoke: "fail" }).ready, false);
  assert.equal(liveOutreachReadiness(ready()).ready, true);
});

test("controlled live caps stay at 5 and 10", () => {
  assert.deepEqual(effectiveCaps({ testMode: true, maxFirst: 15, maxFollowups: 30 }), TEST_CAPS);
  assert.deepEqual(effectiveCaps({ testMode: false, maxFirst: 15, maxFollowups: 30 }), CONTROLLED_LIVE_CAPS);
  const src = readFileSync(new URL("./sql.server.ts", import.meta.url), "utf8");
  assert.match(src, /CONTROLLED_LIVE_CAPS/);
  assert.doesNotMatch(src, /testMode \? 2 : 15/);
});

test("the disable path asks the server before it saves and does not send", () => {
  const src = readFileSync(new URL("./test-flow.server.ts", import.meta.url), "utf8");
  const disable = src.slice(src.indexOf("if (wantsDisableTestMode"), src.indexOf("export async function resetTestFlow"));
  assert.match(disable, /collectLiveOutreachReadiness/);
  const gateAt = disable.indexOf("gateTestModeDisable");
  const saveAt = disable.indexOf("saveTestSettings");
  assert.ok(gateAt >= 0 && saveAt > gateAt);
  assert.doesNotMatch(disable, /sendLive|runAutonomyPass|reachOutToAll/);
});

test("reach-out-all and live campaigns stay explicit", () => {
  const reach = readFileSync(new URL("../campaigns/reach-out-all.ts", import.meta.url), "utf8");
  assert.match(reach, /liveEnabled: false/);
  const service = readFileSync(new URL("../campaigns/service.server.ts", import.meta.url), "utf8");
  assert.match(service, /ENABLE LIVE/);
});

test("a full turn ending in never mind cannot send, and interim speech cannot either", () => {
  assert.equal(hasTerminalCancellationClause("Send the email to Acme, never mind"), true);
  assert.equal(hasTerminalCancellationClause("never mind"), true);
  assert.equal(voiceMayMutate("Confirm send", false), false);
  assert.equal(voiceMayMutate("Send the email, never mind.", true), false);
  assert.equal(confirmSendPhraseOk("Confirm send, never mind"), false);
  assert.equal(confirmSendPhraseOk("Confirm send"), true);
});
