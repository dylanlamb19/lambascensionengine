import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptAudioChunk,
  bargeInTick,
  BARGE_FRAMES,
  beginChunkGate,
  canTransition,
  classifyVoiceError,
  frameRms,
  isBenignVoiceError,
  normalizeTranscript,
  RESPONSE_KICK_TIMEOUT_MS,
  RESPONSE_START_TIMEOUT_MS,
  sessionLooksConfigured,
  shouldFailClosedOnRealtimeError,
  uiStatus,
  VoiceMachine,
} from "./lifecycle.ts";

describe("Ara voice lifecycle", () => {
  it("TEST 1 normal: one turn produces one response and returns to listening", () => {
    assert.equal(canTransition("LISTENING", "USER_SPEAKING"), true);
    assert.equal(canTransition("USER_SPEAKING", "FINALIZING_USER_TURN"), true);
    assert.equal(canTransition("FINALIZING_USER_TURN", "THINKING"), true);
    assert.equal(canTransition("THINKING", "ARA_SPEAKING"), true);
    assert.equal(canTransition("ARA_SPEAKING", "LISTENING"), true);
    assert.equal(canTransition("IDLE", "ARA_SPEAKING"), false);
    assert.equal(canTransition("ARA_SPEAKING", "USER_SPEAKING"), false);
    const m = new VoiceMachine("conv_test");
    assert.equal(m.transition("LISTENING", "open"), true);
    assert.equal(m.transition("USER_SPEAKING", "speech_started"), true);
    const fin = m.finalizeUserTurn("What should I work on?");
    assert.equal(fin.accepted, true);
    assert.match(fin.turnId || "", /^user_turn_/);
    assert.equal(m.state, "THINKING");
    assert.equal(m.startResponse("response_1"), true);
    assert.equal(m.state, "ARA_SPEAKING");
    assert.equal(m.isActiveResponse("response_1"), true);
    assert.equal(m.isActiveResponse("response_old"), false);
    m.completeResponse("response_1");
    m.completeTurnAfterPlayback();
    assert.equal(m.state, "LISTENING");
    assert.equal(m.lastCompletedTurnId, fin.turnId);
    assert.equal(uiStatus("ARA_SPEAKING"), "speaking");
    assert.ok(m.logs.some((l) => l.line.includes("TURN") && l.line.includes("CREATED")));
    assert.ok(m.logs.some((l) => l.line.includes("RESPONSE response_1 STARTED")));
    assert.ok(m.logs.some((l) => l.line.includes("TURN") && l.line.includes("COMPLETE")));
  });

  it("deduplicates the same finalized transcript instead of opening a second turn", () => {
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    m.transition("USER_SPEAKING", "speech");
    const a = m.finalizeUserTurn("What should I work on?");
    const b = m.finalizeUserTurn("What should I work on?");
    assert.equal(a.accepted, true);
    assert.equal(b.accepted, false);
    assert.equal(b.duplicate, true);
    assert.equal(m.duplicatesDropped, 1);
    assert.equal(m.activeUserTurnId, a.turnId);
  });

  it("TEST 2 long response: drops stale and duplicate audio chunks so playback never restarts from 1", () => {
    let gate = beginChunkGate("response_1042");
    const c1 = acceptAudioChunk(gate, "response_1042", 0);
    assert.equal(c1.ok, true);
    gate = c1.gate;
    const c2 = acceptAudioChunk(gate, "response_1042", 1);
    assert.equal(c2.ok, true);
    gate = c2.gate;
    const dup = acceptAudioChunk(gate, "response_1042", 1);
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "dup");
    gate = dup.gate;
    const stale = acceptAudioChunk(gate, "response_99", 2);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale");
    gate = stale.gate;
    let next = gate;
    for (let i = 2; i < 40; i++) {
      const hit = acceptAudioChunk(next, "response_1042", i);
      assert.equal(hit.ok, true, `chunk ${i}`);
      next = hit.gate;
    }
    assert.equal(next.nextIndex, 40);
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Tell me a long briefing.");
    assert.equal(m.startResponse("response_1042"), true);
    assert.equal(m.startResponse("response_1042"), true);
    assert.equal(m.activeResponseId, "response_1042");
    assert.equal(m.state, "ARA_SPEAKING");
  });

  it("TEST 3 tool call: follow-up stays on the same user turn and does not listen mid-tool", () => {
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    m.transition("USER_SPEAKING", "speech");
    const turn = m.finalizeUserTurn("Change my Home background.");
    m.startResponse("response_a");
    assert.equal(m.rememberCall("call_1"), true);
    assert.equal(m.rememberCall("call_1"), false);
    m.beginTool();
    m.completeTurnAfterPlayback();
    assert.equal(m.state, "THINKING");
    assert.equal(m.mic, "gated");
    m.endTool();
    assert.equal(m.markFollowupSent("response_a"), true);
    assert.equal(m.markFollowupSent("response_a"), false);
    m.startResponse("response_b");
    assert.equal(m.activeUserTurnId, turn.turnId);
    assert.equal(m.activeResponseId, "response_b");
    m.completeTurnAfterPlayback();
    assert.equal(m.state, "LISTENING");
    assert.equal(m.lastCompletedTurnId, turn.turnId);
  });

  it("rejects a second overlapping response unless it is the tool follow-up", () => {
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("What should I work on?");
    m.startResponse("response_a");
    m.noteHeardAudio();
    assert.equal(m.startResponse("response_b"), false);
    assert.equal(m.activeResponseId, "response_a");
    m.markFollowupSent("response_a");
    assert.equal(m.startResponse("response_c"), true);
    assert.equal(m.activeResponseId, "response_c");
  });

  it("TEST 4 / 8 / 9: screen-context updates keep the same session and do not create a turn", () => {
    const m = new VoiceMachine("conv_nav");
    m.transition("LISTENING", "open");
    const before = m.activeUserTurnId;
    m.noteEvent("session.update");
    assert.equal(m.state, "LISTENING");
    assert.equal(m.activeUserTurnId, before);
    assert.equal(m.conversationSessionId, "conv_nav");
    m.noteEvent("ui.collapse_transcript");
    assert.equal(m.conversationSessionId, "conv_nav");
    assert.equal(m.state, "LISTENING");
  });

  it("TEST 5 barge-in cancels the active response; TEST 6 echo-level RMS does not", () => {
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    m.transition("USER_SPEAKING", "s");
    m.finalizeUserTurn("Tell me about the pipeline.");
    m.startResponse("response_long");
    const echo = bargeInTick(0, 0.01);
    assert.equal(echo.triggered, false);
    let consec = 0;
    let fired = false;
    for (let i = 0; i < BARGE_FRAMES; i++) {
      const t = bargeInTick(consec, 0.09);
      consec = t.consecutive;
      fired = t.triggered;
    }
    assert.equal(fired, true);
    assert.equal(m.bargeIn(), true);
    assert.equal(m.state, "USER_SPEAKING");
    assert.equal(m.activeResponseId, null);
    assert.equal(m.bargeInEvents, 1);
    const quiet = new Float32Array(32);
    assert.ok(frameRms(quiet) < 0.01);
    m.startResponse("response_echo");
    const ignored = m.finalizeUserTurn("Firefighter Roofing looks interesting because");
    assert.equal(ignored.accepted, false);
    assert.equal(m.activeResponseId, "response_echo");
  });

  it("TEST 7 rapid turns each get exactly one response", () => {
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    const t1 = m.finalizeUserTurn("What should I work on?");
    m.startResponse("r1");
    m.completeTurnAfterPlayback();
    const t2 = m.finalizeUserTurn("Open Pipeline.");
    m.startResponse("r2");
    m.completeTurnAfterPlayback();
    const t3 = m.finalizeUserTurn("What’s next?");
    m.startResponse("r3");
    m.completeTurnAfterPlayback();
    assert.notEqual(t1.turnId, t2.turnId);
    assert.notEqual(t2.turnId, t3.turnId);
    assert.equal(m.lastCompletedTurnId, t3.turnId);
    assert.equal(m.state, "LISTENING");
  });

  it("TEST 10 reconnect keeps last completed turn and does not replay", () => {
    const m = new VoiceMachine("conv_keep");
    m.transition("LISTENING", "open");
    m.transition("USER_SPEAKING", "s");
    const turn = m.finalizeUserTurn("Open Pipeline.");
    m.startResponse("response_nav");
    m.completeTurnAfterPlayback();
    m.resetForReconnectKeepTurns();
    assert.equal(m.lastCompletedTurnId, turn.turnId);
    assert.equal(m.activeResponseId, null);
    assert.equal(m.conversationSessionId, "conv_keep");
    assert.ok(m.logs.some((l) => /RECONNECT without replay/.test(l.line)));
  });

  it("response.created can arrive while still finalizing the user turn", () => {
    const m = new VoiceMachine();
    m.transition("LISTENING", "open");
    m.transition("USER_SPEAKING", "speech");
    m.transition("FINALIZING_USER_TURN", "speech_stopped");
    assert.equal(m.startResponse("response_fast"), true);
    assert.equal(m.state, "ARA_SPEAKING");
    assert.equal(m.mic, "gated");
  });

  it("normalizes transcripts so punctuation does not bypass dedupe", () => {
    assert.equal(normalizeTranscript("Open Pipeline!"), normalizeTranscript("open pipeline"));
  });

  it("ignores benign realtime errors instead of tearing down the session", () => {
    assert.equal(isBenignVoiceError("Cancellation failed: no active response"), true);
    assert.equal(isBenignVoiceError("conversation_already_has_active_response"), true);
    assert.equal(isBenignVoiceError("invalid auth token"), false);
    assert.equal(classifyVoiceError("Cancellation failed: no active response"), "benign");
    assert.equal(classifyVoiceError("invalid auth token"), "fatal");
    assert.equal(classifyVoiceError("Unknown parameter: turn_detection.foo"), "fatal");
    assert.equal(classifyVoiceError("invalid session configuration"), "fatal");
    assert.equal(classifyVoiceError("response generation failed"), "recoverable");
    const cancel = {
      type: "error",
      error: { code: "response_cancel_not_active", message: "Cancellation failed: no active response" },
    };
    assert.equal(shouldFailClosedOnRealtimeError(cancel), false);
    assert.equal(shouldFailClosedOnRealtimeError({ type: "error", error: { message: "invalid auth token" } }), true);
  });
});

describe("Ara thinking watchdog / session ack", () => {
  it("TEST 2 — no response.created kicks once then recovers to listening", () => {
    const m = new VoiceMachine("conv_hello");
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    const t0 = 1_000_000;
    const fin = m.finalizeUserTurn("Hello.", t0);
    assert.equal(fin.accepted, true);
    assert.equal(m.state, "THINKING");
    assert.equal(m.thinkingReason, "WAITING_FOR_RESPONSE_START");
    assert.equal(m.consumeWatchdog(t0 + 100).type, "none");
    const kick = m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 1);
    assert.equal(kick.type, "kick");
    if (kick.type !== "kick") return;
    assert.equal(kick.turnId, fin.turnId);
    assert.equal(m.markRecoveryKick(kick.turnId, t0 + RESPONSE_START_TIMEOUT_MS + 1), true);
    assert.equal(m.markRecoveryKick(kick.turnId, t0 + RESPONSE_START_TIMEOUT_MS + 2), false);
    const snap = m.snapshot(t0 + RESPONSE_START_TIMEOUT_MS + 2);
    assert.equal(snap.recoveryKickSent, true);
    const stage2 = m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + RESPONSE_KICK_TIMEOUT_MS + 5);
    assert.equal(stage2.type, "stage2");
    m.failTurnAndListen("watchdog_stage2");
    assert.equal(m.state, "LISTENING");
    assert.equal(m.thinkingReason, null);
    assert.equal(m.activeResponseId, null);
    assert.equal(m.sendingMic, true);
    assert.equal(m.mic, "live");
    assert.equal(m.awaitingFollowup, false);
    assert.equal(m.toolsInFlight, 0);
  });

  it("TEST 3 — delayed response.created cancels the watchdog with no extra kick", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    const t0 = 2_000_000;
    const fin = m.finalizeUserTurn("Hello.", t0);
    assert.equal(m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS - 10).type, "none");
    assert.equal(m.startResponse("response_late"), true);
    assert.equal(m.state, "ARA_SPEAKING");
    assert.equal(m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 50).type, "none");
    assert.equal(m.recoveryKickSentForTurn.has(fin.turnId || ""), false);
    assert.equal(m.activeResponseId, "response_late");
  });

  it("TEST 4 — recovery kick then delayed normal response keeps one pipeline", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    const t0 = 3_000_000;
    const fin = m.finalizeUserTurn("Hello.", t0);
    const kick = m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 1);
    assert.equal(kick.type, "kick");
    assert.equal(m.markRecoveryKick(fin.turnId || "", t0 + RESPONSE_START_TIMEOUT_MS + 1), true);
    assert.equal(m.startResponse("response_auto"), true);
    assert.equal(m.startResponse("response_kick"), false);
    assert.equal(m.activeResponseId, "response_auto");
    assert.equal(m.consumeWatchdog(t0 + 30_000).type, "none");
    m.noteHeardAudio();
    m.completeTurnAfterPlayback();
    assert.equal(m.state, "LISTENING");
  });

  it("TEST 5 — recoverable provider error cannot stay in THINKING", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Hello.");
    assert.equal(m.state, "THINKING");
    m.noteProviderError("response generation failed");
    m.failTurnAndListen("recoverable_error");
    assert.equal(m.state, "LISTENING");
    assert.equal(m.thinkingReason, null);
    assert.equal(uiStatus(m.state), "listening");
  });

  it("TEST 6 — session.update is not ready until server_vad is acknowledged", () => {
    assert.equal(sessionLooksConfigured({ turn_detection: { type: null } }), false);
    assert.equal(sessionLooksConfigured({}), false);
    assert.equal(sessionLooksConfigured({ turn_detection: { type: "server_vad", create_response: true } }), true);
    const m = new VoiceMachine();
    m.transition("LISTENING", "premature");
    assert.equal(m.shouldSendMic(), false);
    m.acknowledgeSession();
    assert.equal(m.shouldSendMic(), true);
    assert.equal(m.sessionConfigAcknowledged, true);
  });

  it("TEST 8 — long-running tool uses tool watchdog not the short response watchdog", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    const t0 = 4_000_000;
    m.finalizeUserTurn("Generate a new background.", t0);
    m.startResponse("response_tool");
    m.beginTool(t0 + 10);
    assert.equal(m.thinkingReason, "TOOL_IN_FLIGHT");
    assert.equal(m.watchdogKind, "tool");
    assert.equal(m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 20).type, "none");
    m.endTool();
    assert.equal(m.markFollowupSent("response_tool", t0 + 50), true);
    assert.equal(m.thinkingReason, "WAITING_FOR_TOOL_FOLLOWUP");
    assert.equal(m.watchdogKind, "followup");
  });

  it("old watchdog cannot fire against a newer user turn or conversation session", () => {
    const m = new VoiceMachine("conv_a");
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    const t0 = 5_000_000;
    const first = m.finalizeUserTurn("Hello.", t0);
    m.startResponse("r1");
    m.completeTurnAfterPlayback();
    const second = m.finalizeUserTurn("How are you?", t0 + 100);
    assert.equal(m.activeUserTurnId, second.turnId);
    assert.notEqual(first.turnId, second.turnId);
    assert.equal(m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 1).type, "none");
    m.watchdogSessionId = "conv_stale";
    assert.equal(m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 200).type, "none");
    assert.equal(m.state, "THINKING");
    assert.equal(m.activeUserTurnId, second.turnId);
  });

  it("TEST 2/6 — cancelling speech returns to LISTENING and drops stale audio", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Tell me a story.");
    assert.equal(m.startResponse("response_long"), true);
    assert.equal(m.state, "ARA_SPEAKING");
    const gen = m.playbackGeneration;
    m.cancelSpeechAndListen("stop_speech");
    assert.equal(m.state, "LISTENING");
    assert.equal(m.activeResponseId, null);
    assert.equal(m.currentTtsId, null);
    assert.equal(m.thinkingReason, null);
    assert.equal(uiStatus(m.state), "listening");
    assert.ok(m.playbackGeneration > gen);
    assert.equal(m.isCancelledResponse("response_long"), true);
    assert.equal(m.startResponse("response_long"), false);
    assert.equal(m.state, "LISTENING");
    assert.equal(m.startResponse("response_after_cancel"), false, "suppressed until next owner turn");
  });

  it("TEST 7 — after cancellation the next turn is a new listening turn", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Hello.");
    m.startResponse("r1");
    m.cancelSpeechAndListen("stop_speech");
    const next = m.finalizeUserTurn("What should I work on?");
    assert.equal(next.accepted, true);
    assert.equal(m.startResponse("r2"), true);
    assert.equal(m.activeResponseId, "r2");
    m.completeTurnAfterPlayback();
    assert.equal(m.state, "LISTENING");
  });

  it("ARA_SPEAKING without a TTS owner recovers to LISTENING", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Hello.");
    m.startResponse("r1");
    m.activeResponseId = null;
    m.currentTtsId = null;
    assert.equal(m.recoverInvalidSpeaking(), true);
    assert.equal(m.state, "LISTENING");
    assert.equal(uiStatus("USER_SPEAKING"), "hearing");
  });

  it("stuck Speaking with no queued audio recovers to LISTENING", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Ara, can you hear me?");
    m.startResponse("r_stop");
    m.noteHeardAudio();
    m.lastAudioAt = Date.now() - 2000;
    assert.equal(m.recoverStaleSpeaking(0), true);
    assert.equal(m.state, "LISTENING");
    assert.equal(m.activeResponseId, null);
    assert.equal(uiStatus(m.state), "listening");
  });

  it("false-stop suppression lifts on the next owner turn", () => {
    const m = new VoiceMachine();
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.finalizeUserTurn("Ara, can you hear me?");
    m.startResponse("r1");
    m.cancelSpeechAndListen("hallucinated_stop_ack");
    assert.equal(m.suppressModelSpeech, true);
    assert.equal(m.startResponse("r2"), false);
    const next = m.finalizeUserTurn("What should I work on?");
    assert.equal(next.accepted, true);
    assert.equal(m.suppressModelSpeech, false);
    assert.equal(m.startResponse("r3"), true);
    m.completeTurnAfterPlayback(true);
    assert.equal(m.state, "LISTENING");
  });

  it("opening greeting arms the start watchdog without a fake Hello transcript", () => {
    const m = new VoiceMachine("conv_greet");
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    const t0 = 9_000_000;
    const turnId = m.beginSessionGreeting(t0);
    assert.match(turnId, /^user_turn_/);
    assert.equal(m.state, "THINKING");
    assert.equal(m.thinkingReason, "WAITING_FOR_RESPONSE_START");
    assert.equal(m.activeUserTurnId, turnId);
    assert.equal(m.lastFinalTranscript, null);
    assert.equal(m.consumeWatchdog(t0 + 100).type, "none");
    const kick = m.consumeWatchdog(t0 + RESPONSE_START_TIMEOUT_MS + 1);
    assert.equal(kick.type, "kick");
    if (kick.type !== "kick") return;
    assert.equal(kick.turnId, turnId);
    assert.equal(m.markRecoveryKick(turnId, t0 + RESPONSE_START_TIMEOUT_MS + 1), true);
    m.failTurnAndListen("watchdog_stage2");
    assert.equal(m.state, "LISTENING");
    assert.equal(m.sendingMic, true);
  });

  it("typed owner text can interrupt an opening greeting", () => {
    const m = new VoiceMachine("conv_type");
    m.acknowledgeSession();
    m.transition("LISTENING", "open");
    m.beginSessionGreeting(1_000);
    assert.equal(m.state, "THINKING");
    m.cancelSpeechAndListen("owner_typed");
    assert.equal(m.state, "LISTENING");
    m.allowNextModelSpeech();
    const fin = m.finalizeUserTurn("What should I work on?", 2_000);
    assert.equal(fin.accepted, true);
    assert.equal(m.state, "THINKING");
    assert.equal(m.suppressModelSpeech, false);
  });
});
