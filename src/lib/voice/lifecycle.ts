import { realtimeErrorText } from "./voice-failure.ts";

export type VoiceState =
  | "IDLE"
  | "LISTENING"
  | "USER_SPEAKING"
  | "FINALIZING_USER_TURN"
  | "THINKING"
  | "ARA_SPEAKING"
  | "INTERRUPTING"
  | "ERROR";

export type ThinkingReason =
  | "WAITING_FOR_RESPONSE_START"
  | "TOOL_IN_FLIGHT"
  | "WAITING_FOR_TOOL_FOLLOWUP"
  | null;

export type VoiceErrorClass = "benign" | "recoverable" | "fatal";

export type WatchdogKind = "start" | "kick" | "followup" | "tool" | "drain" | null;

export type WatchdogAction =
  | { type: "none" }
  | { type: "kick"; turnId: string }
  | { type: "stage2"; turnId: string }
  | { type: "drain"; turnId: string };

export type VoiceLog = { at: number; line: string };

export type VoiceSnapshot = {
  conversationSessionId: string;
  voiceState: VoiceState;
  activeUserTurnId: string | null;
  activeResponseId: string | null;
  lastCompletedTurnId: string | null;
  currentTtsId: string | null;
  mic: "stopped" | "starting" | "live" | "gated";
  vad: "idle" | "speech" | "echo_gate";
  queuedChunks: number;
  lastEvent: string;
  duplicatesDropped: number;
  staleDropped: number;
  bargeInEvents: number;
  logs: string[];
  sessionConfigAcknowledged: boolean;
  thinkingReason: ThinkingReason;
  thinkingSince: number | null;
  responseWatchdogTurnId: string | null;
  responseWatchdogElapsed: number;
  recoveryKickSent: boolean;
  lastProviderError: string | null;
  lastProviderEvent: string | null;
  stopIntentDetected: boolean;
  stopIntentSource: string;
  stopIntentConfidence: string;
  stopIntentPhrase: string;
  stopIntentTurnId: string | null;
  lastInterimTranscript: string | null;
  lastFinalTranscript: string | null;
  lastNormalizedTranscript: string | null;
  playbackGeneration: number;
  suppressModelSpeech: boolean;
};

const ALLOWED: Record<VoiceState, VoiceState[]> = {
  IDLE: ["LISTENING", "ERROR", "IDLE"],
  LISTENING: ["USER_SPEAKING", "FINALIZING_USER_TURN", "THINKING", "ARA_SPEAKING", "IDLE", "ERROR", "LISTENING"],
  USER_SPEAKING: ["FINALIZING_USER_TURN", "THINKING", "LISTENING", "IDLE", "ERROR", "USER_SPEAKING"],
  FINALIZING_USER_TURN: ["THINKING", "ARA_SPEAKING", "LISTENING", "IDLE", "ERROR", "FINALIZING_USER_TURN"],
  THINKING: ["ARA_SPEAKING", "LISTENING", "IDLE", "ERROR", "THINKING", "INTERRUPTING"],
  ARA_SPEAKING: ["LISTENING", "INTERRUPTING", "THINKING", "IDLE", "ERROR", "ARA_SPEAKING"],
  INTERRUPTING: ["FINALIZING_USER_TURN", "LISTENING", "THINKING", "IDLE", "ERROR", "USER_SPEAKING", "INTERRUPTING"],
  ERROR: ["IDLE", "LISTENING", "ERROR"],
};

export const BARGE_RMS_MIN = 0.08;
export const BARGE_FRAMES = 5;
export const FINAL_DEDUP_MS = 5000;
export const ECHO_SETTLE_MS = 350;
export const RESPONSE_START_TIMEOUT_MS = 8000;
export const RESPONSE_KICK_TIMEOUT_MS = 8000;
export const TOOL_FOLLOWUP_TIMEOUT_MS = 25000;
export const TOOL_IN_FLIGHT_TIMEOUT_MS = 90000;
export const SESSION_ACK_TIMEOUT_MS = 8000;
export const SPEAKING_DRAIN_TIMEOUT_MS = 4000;
export const SPEAKING_NO_AUDIO_TIMEOUT_MS = 8000;

let turnSeq = 0;
let responseSeq = 0;

export function nextTurnId(): string {
  turnSeq += 1;
  return `user_turn_${turnSeq}`;
}

export function nextResponseId(turnId: string | null): string {
  responseSeq += 1;
  return turnId ? `response_${turnSeq}_${responseSeq}` : `response_${responseSeq}`;
}

export function normalizeTranscript(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function frameRms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += Number(samples[i]) * Number(samples[i]);
  return Math.sqrt(s / samples.length);
}

export function bargeInTick(consecutive: number, rms: number): { consecutive: number; triggered: boolean } {
  const next = rms >= BARGE_RMS_MIN ? consecutive + 1 : 0;
  return { consecutive: next, triggered: next >= BARGE_FRAMES };
}

export function isBenignVoiceError(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("cancel") ||
    m.includes("already has an active response") ||
    m.includes("already has a response") ||
    m.includes("no active response") ||
    m.includes("response not found") ||
    m.includes("already in progress") ||
    m.includes("buffer too small") ||
    m.includes("input_audio_buffer") ||
    m.includes("conversation_already_has_active_response") ||
    m.includes("response_cancel_not_active")
  );
}

export function classifyVoiceError(message: string): VoiceErrorClass {
  if (isBenignVoiceError(message)) return "benign";
  const m = (message || "").toLowerCase();
  if (/auth|token|unauthor|forbidden|permission|invalid api key|not authenticated/.test(m)) return "fatal";
  if (/unsupported session|invalid session|unknown parameter|session update/.test(m) && /unsupported|invalid|unknown/.test(m)) {
    return "fatal";
  }
  return "recoverable";
}

/** Cancel / no-active-response errors must not take Conversation Mode down. */
export function shouldFailClosedOnRealtimeError(ev: Record<string, unknown>): boolean {
  return classifyVoiceError(realtimeErrorText(ev)) === "fatal";
}

export type ChunkGate = {
  activeResponseId: string | null;
  nextIndex: number;
  dropped: number;
};

export function beginChunkGate(responseId: string): ChunkGate {
  return { activeResponseId: responseId, nextIndex: 0, dropped: 0 };
}

export function acceptAudioChunk(
  gate: ChunkGate,
  responseId: string,
  chunkIndex?: number,
): { ok: boolean; reason?: "stale" | "dup" | "no_active"; index: number; gate: ChunkGate } {
  if (!gate.activeResponseId) {
    return { ok: false, reason: "no_active", index: -1, gate: { ...gate, dropped: gate.dropped + 1 } };
  }
  if (responseId !== gate.activeResponseId) {
    return { ok: false, reason: "stale", index: -1, gate: { ...gate, dropped: gate.dropped + 1 } };
  }
  const index = chunkIndex ?? gate.nextIndex;
  if (index < gate.nextIndex) {
    return { ok: false, reason: "dup", index, gate: { ...gate, dropped: gate.dropped + 1 } };
  }
  return { ok: true, index, gate: { ...gate, nextIndex: index + 1 } };
}

export function canTransition(from: VoiceState, to: VoiceState): boolean {
  return ALLOWED[from].includes(to);
}

export class VoiceMachine {
  state: VoiceState = "IDLE";
  conversationSessionId: string;
  activeUserTurnId: string | null = null;
  activeResponseId: string | null = null;
  lastCompletedTurnId: string | null = null;
  currentTtsId: string | null = null;
  mic: VoiceSnapshot["mic"] = "stopped";
  vad: VoiceSnapshot["vad"] = "idle";
  queuedChunks = 0;
  lastEvent = "init";
  duplicatesDropped = 0;
  staleDropped = 0;
  bargeInEvents = 0;
  logs: VoiceLog[] = [];
  bargeConsecutive = 0;
  sendingMic = false;
  followupSentFor = new Set<string>();
  handledCalls = new Set<string>();
  toolsInFlight = 0;
  awaitingFollowup = false;
  heardAudio = false;
  echoSettleUntil = 0;
  sessionConfigAcknowledged = false;
  thinkingReason: ThinkingReason = null;
  thinkingSince: number | null = null;
  watchdogTurnId: string | null = null;
  watchdogSessionId: string | null = null;
  watchdogKind: WatchdogKind = null;
  watchdogDeadline: number | null = null;
  recoveryKickSentForTurn = new Set<string>();
  lastProviderError: string | null = null;
  lastProviderEvent: string | null = null;
  cancelledResponseIds = new Set<string>();
  playbackGeneration = 0;
  stopIntentDetected = false;
  stopIntentSource = "none";
  stopIntentConfidence = "none";
  stopIntentPhrase = "";
  stopIntentTurnId: string | null = null;
  lastInterimTranscript: string | null = null;
  lastFinalTranscript: string | null = null;
  lastNormalizedTranscript: string | null = null;
  suppressModelSpeech = false;
  falseStopRetrySent = false;
  lastAudioAt = 0;
  speakingStartedAt = 0;
  private lastFinalNorm = "";
  private lastFinalAt = 0;

  constructor(sessionId?: string) {
    this.conversationSessionId = sessionId || `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  log(line: string) {
    this.logs = [...this.logs.slice(-39), { at: Date.now(), line }];
  }

  snapshot(now = Date.now()): VoiceSnapshot {
    const watchdogTurn = this.watchdogTurnId;
    const elapsed = this.thinkingSince ? Math.max(0, now - this.thinkingSince) : 0;
    return {
      conversationSessionId: this.conversationSessionId,
      voiceState: this.state,
      activeUserTurnId: this.activeUserTurnId,
      activeResponseId: this.activeResponseId,
      lastCompletedTurnId: this.lastCompletedTurnId,
      currentTtsId: this.currentTtsId,
      mic: this.mic,
      vad: this.vad,
      queuedChunks: this.queuedChunks,
      lastEvent: this.lastEvent,
      duplicatesDropped: this.duplicatesDropped,
      staleDropped: this.staleDropped,
      bargeInEvents: this.bargeInEvents,
      logs: this.logs.map((l) => l.line),
      sessionConfigAcknowledged: this.sessionConfigAcknowledged,
      thinkingReason: this.thinkingReason,
      thinkingSince: this.thinkingSince,
      responseWatchdogTurnId: watchdogTurn,
      responseWatchdogElapsed: elapsed,
      recoveryKickSent: this.activeUserTurnId ? this.recoveryKickSentForTurn.has(this.activeUserTurnId) : false,
      lastProviderError: this.lastProviderError,
      lastProviderEvent: this.lastProviderEvent,
      stopIntentDetected: this.stopIntentDetected,
      stopIntentSource: this.stopIntentSource,
      stopIntentConfidence: this.stopIntentConfidence,
      stopIntentPhrase: this.stopIntentPhrase,
      stopIntentTurnId: this.stopIntentTurnId,
      lastInterimTranscript: this.lastInterimTranscript,
      lastFinalTranscript: this.lastFinalTranscript,
      lastNormalizedTranscript: this.lastNormalizedTranscript,
      playbackGeneration: this.playbackGeneration,
      suppressModelSpeech: this.suppressModelSpeech,
    };
  }

  transition(to: VoiceState, event: string): boolean {
    if (!canTransition(this.state, to)) {
      this.log(`BLOCKED ${this.state} → ${to} (${event})`);
      return false;
    }
    if (this.state !== to) this.log(`${this.state} → ${to} (${event})`);
    this.state = to;
    this.lastEvent = event;
    if (to === "LISTENING" || to === "USER_SPEAKING" || to === "FINALIZING_USER_TURN") {
      this.sendingMic = true;
      this.mic = "live";
      if (to === "LISTENING") {
        this.vad = "idle";
        this.thinkingReason = null;
        this.thinkingSince = null;
      }
    }
    if (to === "THINKING" || to === "ARA_SPEAKING") {
      this.sendingMic = false;
      this.mic = "gated";
      this.vad = to === "ARA_SPEAKING" ? "echo_gate" : "idle";
      this.bargeConsecutive = 0;
    }
    if (to === "ARA_SPEAKING") {
      this.thinkingReason = null;
      this.speakingStartedAt = Date.now();
    }
    if (to === "IDLE" || to === "ERROR") {
      this.sendingMic = false;
      this.mic = "stopped";
      this.thinkingReason = null;
      this.thinkingSince = null;
      this.clearWatchdog();
    }
    return true;
  }

  noteEvent(name: string) {
    this.lastEvent = name;
    this.lastProviderEvent = name;
  }

  noteHeardAudio() {
    this.heardAudio = true;
    this.lastAudioAt = Date.now();
    if (this.watchdogKind === "start" || this.watchdogKind === "kick" || this.watchdogKind === "followup") {
      this.clearWatchdog();
    }
  }

  noteInterimTranscript(text: string) {
    this.lastInterimTranscript = (text || "").slice(0, 120);
  }

  noteFinalTranscript(text: string, normalized: string) {
    this.lastFinalTranscript = (text || "").slice(0, 120);
    this.lastNormalizedTranscript = (normalized || "").slice(0, 120);
  }

  noteStopIntent(hit: {
    detected: boolean;
    kind: string;
    source: string;
    confidence: string;
    phrase: string;
    turnId: string | null;
    reason: string;
  }) {
    this.stopIntentDetected = hit.detected;
    this.stopIntentSource = hit.source;
    this.stopIntentConfidence = hit.confidence;
    this.stopIntentPhrase = hit.phrase;
    this.stopIntentTurnId = hit.turnId;
    this.log(
      `STOP INTENT detected=${hit.detected} kind=${hit.kind} source=${hit.source} confidence=${hit.confidence} phrase=${JSON.stringify(hit.phrase)} reason=${hit.reason} turn=${hit.turnId || "none"}`,
    );
  }

  bumpPlaybackGeneration() {
    this.playbackGeneration += 1;
    return this.playbackGeneration;
  }

  markResponseCancelled(responseId: string | null) {
    if (responseId) this.cancelledResponseIds.add(responseId);
  }

  isCancelledResponse(responseId: string | null | undefined): boolean {
    if (!responseId) return false;
    return this.cancelledResponseIds.has(responseId);
  }

  recoverInvalidSpeaking(): boolean {
    if (this.state !== "ARA_SPEAKING") return false;
    if (this.suppressModelSpeech) {
      this.log("SUPPRESSED ARA_SPEAKING — recover LISTENING");
      this.failTurnAndListen("speech_suppressed");
      return true;
    }
    if (this.activeResponseId && this.currentTtsId) return false;
    this.log("INVALID ARA_SPEAKING without TTS owner — recover LISTENING");
    this.failTurnAndListen("speaking_without_owner");
    return true;
  }

  recoverStaleSpeaking(queuedChunks: number, now = Date.now()): boolean {
    if (this.state !== "ARA_SPEAKING") return false;
    if (this.suppressModelSpeech) {
      this.failTurnAndListen("speech_suppressed");
      return true;
    }
    if (!this.activeResponseId || !this.currentTtsId) {
      return this.recoverInvalidSpeaking();
    }
    if (!this.heardAudio) return false;
    if (queuedChunks > 0) return false;
    const last = this.lastAudioAt || this.speakingStartedAt;
    if (!last || now - last < 1500) return false;
    this.log("STALE ARA_SPEAKING — audio drained but state stuck; recover LISTENING");
    this.completeTurnAfterPlayback(true);
    return true;
  }

  cancelSpeechAndListen(reason = "stop_speech") {
    this.markResponseCancelled(this.activeResponseId);
    this.bumpPlaybackGeneration();
    this.activeResponseId = null;
    this.currentTtsId = null;
    this.queuedChunks = 0;
    this.heardAudio = false;
    this.awaitingFollowup = false;
    this.toolsInFlight = 0;
    this.pendingCallsSafeClear();
    this.clearWatchdog();
    this.thinkingReason = null;
    this.thinkingSince = null;
    this.sendingMic = true;
    this.mic = "live";
    this.vad = "idle";
    this.bargeConsecutive = 0;
    this.suppressModelSpeech = true;
    this.log(`SPEECH CANCELLED (${reason}) → LISTENING`);
    if (this.state === "IDLE" || this.state === "ERROR") return;
    if (this.state === "LISTENING") return;
    this.transition("LISTENING", reason);
  }

  private pendingCallsSafeClear() {
    this.handledCalls.clear();
  }

  acknowledgeSession() {
    this.sessionConfigAcknowledged = true;
    this.log("session.updated acknowledged");
  }

  noteProviderError(message: string) {
    this.lastProviderError = (message || "").slice(0, 240);
  }

  enterThinking(reason: Exclude<ThinkingReason, null>, now = Date.now()) {
    this.thinkingReason = reason;
    if (this.thinkingSince == null) this.thinkingSince = now;
    this.transition("THINKING", reason);
    this.gateMic();
  }

  armWatchdog(kind: Exclude<WatchdogKind, null>, turnId: string | null, timeoutMs: number, now = Date.now()) {
    const id = turnId || this.activeUserTurnId || this.conversationSessionId;
    if (!id) return;
    this.watchdogKind = kind;
    this.watchdogTurnId = id;
    this.watchdogSessionId = this.conversationSessionId;
    this.watchdogDeadline = now + timeoutMs;
    this.log(`WATCHDOG ${kind} ${id} ${timeoutMs}ms`);
  }

  clearWatchdog() {
    this.watchdogKind = null;
    this.watchdogTurnId = null;
    this.watchdogSessionId = null;
    this.watchdogDeadline = null;
  }

  gateMic() {
    this.sendingMic = false;
    this.mic = "gated";
    this.bargeConsecutive = 0;
  }

  finalizeUserTurn(transcript: string, now = Date.now()): { accepted: boolean; turnId: string | null; duplicate: boolean } {
    const norm = normalizeTranscript(transcript);
    if (!norm) return { accepted: false, turnId: null, duplicate: false };
    if (this.state === "THINKING" || this.state === "ARA_SPEAKING") {
      this.duplicatesDropped += 1;
      this.log(`TURN ignored in ${this.state} (echo/stale final)`);
      return { accepted: false, turnId: this.activeUserTurnId, duplicate: true };
    }
    if (norm === this.lastFinalNorm && now - this.lastFinalAt < FINAL_DEDUP_MS) {
      this.duplicatesDropped += 1;
      this.log(`TURN DUP dropped "${norm.slice(0, 48)}"`);
      return { accepted: false, turnId: this.activeUserTurnId, duplicate: true };
    }
    this.lastFinalNorm = norm;
    this.lastFinalAt = now;
    this.suppressModelSpeech = false;
    this.falseStopRetrySent = false;
    const turnId = nextTurnId();
    this.activeUserTurnId = turnId;
    this.followupSentFor.clear();
    this.awaitingFollowup = false;
    this.toolsInFlight = 0;
    this.heardAudio = false;
    this.transition("FINALIZING_USER_TURN", "user_final");
    this.log(`TURN ${turnId} CREATED`);
    this.log(`TURN ${turnId} FINALIZED`);
    this.enterThinking("WAITING_FOR_RESPONSE_START", now);
    this.armWatchdog("start", turnId, RESPONSE_START_TIMEOUT_MS, now);
    this.log("WAITING FOR response.created");
    return { accepted: true, turnId, duplicate: false };
  }

  startResponse(responseId: string): boolean {
    if (!responseId) return false;
    if (this.suppressModelSpeech) {
      this.staleDropped += 1;
      this.log(`RESPONSE ${responseId} REJECTED (speech suppressed until next owner turn)`);
      return false;
    }
    if (this.isCancelledResponse(responseId)) {
      this.staleDropped += 1;
      this.log(`RESPONSE ${responseId} REJECTED (cancelled)`);
      return false;
    }
    if (this.activeResponseId === responseId && (this.state === "ARA_SPEAKING" || this.state === "THINKING")) {
      this.duplicatesDropped += 1;
      this.log(`RESPONSE ${responseId} duplicate created ignored`);
      this.clearWatchdog();
      return true;
    }
    if (
      this.activeResponseId &&
      this.activeResponseId !== responseId &&
      (this.state === "ARA_SPEAKING" || this.heardAudio) &&
      !this.awaitingFollowup
    ) {
      this.staleDropped += 1;
      this.log(`RESPONSE ${responseId} REJECTED (already speaking ${this.activeResponseId})`);
      return false;
    }
    if (this.activeResponseId && this.activeResponseId !== responseId) {
      this.log(`RESPONSE ${this.activeResponseId} SUPERSEDED by ${responseId}`);
    }
    if (this.state === "LISTENING" || this.state === "USER_SPEAKING" || this.state === "FINALIZING_USER_TURN") {
      this.transition("THINKING", "response.created");
    }
    this.awaitingFollowup = false;
    this.heardAudio = false;
    this.activeResponseId = responseId;
    this.currentTtsId = responseId;
    this.echoSettleUntil = Date.now() + ECHO_SETTLE_MS;
    this.clearWatchdog();
    this.log(`RESPONSE ${responseId} STARTED`);
    this.transition("ARA_SPEAKING", "response.created");
    this.armWatchdog("drain", this.activeUserTurnId, SPEAKING_NO_AUDIO_TIMEOUT_MS);
    return true;
  }

  isActiveResponse(responseId: string | null | undefined): boolean {
    if (!responseId || !this.activeResponseId) return false;
    if (this.isCancelledResponse(responseId)) return false;
    return responseId === this.activeResponseId;
  }

  dropStale(kind: string) {
    this.staleDropped += 1;
    this.log(`STALE ${kind} dropped (active=${this.activeResponseId || "none"})`);
  }

  completeResponse(responseId: string) {
    if (!this.isActiveResponse(responseId)) {
      this.dropStale("response.done");
      return;
    }
    this.log(`TTS ${responseId} COMPLETED`);
    if (this.watchdogKind !== "drain") this.clearWatchdog();
  }

  completeTurnAfterPlayback(force = false) {
    if (!force && (this.toolsInFlight > 0 || this.awaitingFollowup)) {
      this.enterThinking(this.toolsInFlight > 0 ? "TOOL_IN_FLIGHT" : "WAITING_FOR_TOOL_FOLLOWUP");
      this.log("hold LISTENING — tool/follow-up still in flight");
      return;
    }
    if (this.activeUserTurnId) {
      this.lastCompletedTurnId = this.activeUserTurnId;
      this.log(`TURN ${this.activeUserTurnId} COMPLETE`);
    }
    this.activeResponseId = null;
    this.currentTtsId = null;
    this.queuedChunks = 0;
    this.heardAudio = false;
    this.clearWatchdog();
    this.transition("LISTENING", "playback_drained");
  }

  consumeWatchdog(now = Date.now()): WatchdogAction {
    if (!this.watchdogDeadline || !this.watchdogTurnId || !this.watchdogKind) return { type: "none" };
    if (this.watchdogSessionId && this.watchdogSessionId !== this.conversationSessionId) {
      this.log("WATCHDOG ignored — conversation session changed");
      this.clearWatchdog();
      return { type: "none" };
    }
    if (now < this.watchdogDeadline) return { type: "none" };
    const turnId = this.watchdogTurnId;
    if (this.watchdogKind !== "drain" && this.activeUserTurnId && this.activeUserTurnId !== turnId) {
      this.log(`WATCHDOG ignored — turn ${turnId} no longer active`);
      this.clearWatchdog();
      return { type: "none" };
    }
    if (this.watchdogKind !== "drain" && this.activeResponseId && (this.state === "ARA_SPEAKING" || this.heardAudio)) {
      this.clearWatchdog();
      return { type: "none" };
    }
    if (this.watchdogKind === "drain") {
      this.log(`WATCHDOG speaking drain ${turnId}`);
      return { type: "drain", turnId };
    }
    if (this.watchdogKind === "start" || this.watchdogKind === "followup") {
      if (this.recoveryKickSentForTurn.has(turnId)) {
        this.log(`WATCHDOG no response.created for ${turnId} after kick`);
        return { type: "stage2", turnId };
      }
      if (this.toolsInFlight > 0 && this.watchdogKind === "start") {
        this.armWatchdog("tool", turnId, TOOL_IN_FLIGHT_TIMEOUT_MS, now);
        return { type: "none" };
      }
      this.log(`WATCHDOG no response.created for ${turnId}`);
      return { type: "kick", turnId };
    }
    if (this.watchdogKind === "kick" || this.watchdogKind === "tool") {
      this.log(`WATCHDOG stage2 ${turnId}`);
      return { type: "stage2", turnId };
    }
    return { type: "none" };
  }

  markRecoveryKick(turnId: string, now = Date.now()): boolean {
    if (!turnId) return false;
    if (this.recoveryKickSentForTurn.has(turnId)) return false;
    if (this.activeResponseId) return false;
    if (this.activeUserTurnId && this.activeUserTurnId !== turnId) return false;
    this.recoveryKickSentForTurn.add(turnId);
    this.armWatchdog("kick", turnId, RESPONSE_KICK_TIMEOUT_MS, now);
    this.log(`WATCHDOG recovery kick sent for ${turnId}`);
    return true;
  }

  failTurnAndListen(reason: string) {
    this.log(`TURN ${this.activeUserTurnId || "none"} FAILED (${reason})`);
    this.activeResponseId = null;
    this.currentTtsId = null;
    this.queuedChunks = 0;
    this.heardAudio = false;
    this.awaitingFollowup = false;
    this.toolsInFlight = 0;
    this.handledCalls.clear();
    this.followupSentFor.clear();
    this.clearWatchdog();
    this.thinkingReason = null;
    this.thinkingSince = null;
    this.sendingMic = true;
    this.mic = "live";
    this.vad = "idle";
    this.bargeConsecutive = 0;
    this.transition("LISTENING", reason);
  }

  /** Opening greeting: one model response, no fake owner "Hello" transcript. */
  beginSessionGreeting(now = Date.now()): string {
    const turnId = nextTurnId();
    this.activeUserTurnId = turnId;
    this.suppressModelSpeech = false;
    this.falseStopRetrySent = false;
    this.heardAudio = false;
    this.followupSentFor.clear();
    this.awaitingFollowup = false;
    this.toolsInFlight = 0;
    this.log(`TURN ${turnId} GREETING`);
    this.enterThinking("WAITING_FOR_RESPONSE_START", now);
    this.armWatchdog("start", turnId, RESPONSE_START_TIMEOUT_MS, now);
    return turnId;
  }

  allowNextModelSpeech() {
    this.suppressModelSpeech = false;
  }

  bargeIn(): boolean {
    if (this.state !== "ARA_SPEAKING" && this.state !== "THINKING") return false;
    this.bargeInEvents += 1;
    const old = this.activeResponseId;
    this.log(`BARGE-IN cancel ${old || "none"}`);
    this.markResponseCancelled(old);
    this.bumpPlaybackGeneration();
    this.transition("INTERRUPTING", "barge_in");
    this.activeResponseId = null;
    this.currentTtsId = null;
    this.queuedChunks = 0;
    this.heardAudio = false;
    this.awaitingFollowup = false;
    this.toolsInFlight = 0;
    this.clearWatchdog();
    this.sendingMic = true;
    this.mic = "live";
    this.vad = "speech";
    this.suppressModelSpeech = false;
    this.transition("USER_SPEAKING", "barge_in");
    return true;
  }

  shouldSendMic(): boolean {
    return this.sendingMic && this.state !== "ERROR" && this.state !== "IDLE" && this.sessionConfigAcknowledged;
  }

  echoSettled(now = Date.now()): boolean {
    return now >= this.echoSettleUntil;
  }

  expectFollowup(parentId: string, now = Date.now()): boolean {
    if (this.followupSentFor.has(parentId)) return false;
    this.followupSentFor.add(parentId);
    this.awaitingFollowup = true;
    this.gateMic();
    this.enterThinking("WAITING_FOR_TOOL_FOLLOWUP", now);
    this.armWatchdog("followup", this.activeUserTurnId, TOOL_FOLLOWUP_TIMEOUT_MS, now);
    this.log(`EXPECT follow-up for ${parentId}`);
    return true;
  }

  markFollowupSent(parentId: string, now = Date.now()): boolean {
    return this.expectFollowup(parentId, now);
  }

  beginTool(now = Date.now()) {
    this.toolsInFlight += 1;
    this.enterThinking("TOOL_IN_FLIGHT", now);
    this.armWatchdog("tool", this.activeUserTurnId, TOOL_IN_FLIGHT_TIMEOUT_MS, now);
  }

  endTool() {
    this.toolsInFlight = Math.max(0, this.toolsInFlight - 1);
  }

  rememberCall(callId: string): boolean {
    const id = (callId || "").trim();
    if (!id) return true;
    if (this.handledCalls.has(id)) return false;
    this.handledCalls.add(id);
    return true;
  }

  resetForReconnectKeepTurns() {
    this.activeResponseId = null;
    this.currentTtsId = null;
    this.queuedChunks = 0;
    this.sendingMic = false;
    this.mic = "stopped";
    this.bargeConsecutive = 0;
    this.heardAudio = false;
    this.awaitingFollowup = false;
    this.toolsInFlight = 0;
    this.sessionConfigAcknowledged = false;
    this.handledCalls.clear();
    this.followupSentFor.clear();
    this.recoveryKickSentForTurn.clear();
    this.clearWatchdog();
    this.thinkingReason = null;
    this.thinkingSince = null;
    this.transition("IDLE", "reconnect");
    this.log("RECONNECT without replay");
  }
}

export function uiStatus(state: VoiceState): "ready" | "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "unavailable" {
  if (state === "ERROR") return "unavailable";
  if (state === "IDLE") return "ready";
  if (state === "ARA_SPEAKING") return "speaking";
  if (state === "THINKING" || state === "INTERRUPTING") return "thinking";
  if (state === "USER_SPEAKING") return "hearing";
  return "listening";
}

export function sessionLooksConfigured(session: Record<string, unknown> | undefined | null): boolean {
  if (!session || typeof session !== "object") return false;
  const td = session.turn_detection;
  if (!td || typeof td !== "object") return false;
  return (td as { type?: unknown }).type === "server_vad";
}
