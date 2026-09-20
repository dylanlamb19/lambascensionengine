"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import type { VoiceMode } from "@/lib/voice/types";
import type { AraStatus } from "@/lib/voice/ara-client";
import type { MicPermission } from "@/lib/voice/mic";
import { createRecognizer, permissionDeniedPlain, speechSupported } from "@/lib/voice/speech";
import { teardownAraOutput, unlockAraOutput } from "@/lib/voice/audio-out";
import { araSpeech } from "@/lib/voice/speech-controller";
import { micStatusLabel } from "@/lib/voice/mic";

const MIN_REAL_CONFIDENCE = 0.4;

export function VoiceBar({
  mode,
  onMode,
  listening,
  you,
  reply,
  muted,
  onMuted,
  onTranscript,
  onListening,
  onStop,
  araStatus = "ready",
  araError = "",
  micPermission = "UNKNOWN",
  micStreamActive = false,
  voiceSessionReady = false,
  voiceUnavailable = false,
  outputSpeaking = false,
  onEnableMic,
  onReconnectVoice,
  onReadPage,
}: {
  mode: VoiceMode;
  onMode: (m: VoiceMode) => void;
  listening: boolean;
  you: string;
  reply: string;
  muted: boolean;
  onMuted: (v: boolean) => void;
  onTranscript: (text: string, isFinal: boolean, confidence: number | undefined) => void;
  onListening?: (active: boolean) => void;
  onStop: () => void;
  araStatus?: AraStatus;
  araError?: string;
  micPermission?: MicPermission;
  micStreamActive?: boolean;
  voiceSessionReady?: boolean;
  voiceUnavailable?: boolean;
  outputSpeaking?: boolean;
  onEnableMic?: () => void;
  onReconnectVoice?: () => void;
  onReadPage?: () => void;
}) {
  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const [avail, setAvail] = useState(true);
  const [err, setErr] = useState("");
  const activeRef = useRef(false);
  const active = mode === "conversation";
  const trulyListening =
    active
    && araStatus === "listening"
    && micPermission !== "DENIED"
    && micPermission !== "BLOCKED"
    && micPermission !== "UNAVAILABLE"
    && micStreamActive
    && voiceSessionReady;
  const live = trulyListening || araStatus === "speaking" || outputSpeaking || araStatus === "connecting";

  useEffect(() => {
    setAvail(speechSupported());
    teardownAraOutput();
  }, []);

  useEffect(() => {
    if (mode !== "ptt") {
      activeRef.current = false;
      recRef.current?.abort();
      if (mode === "off") {
        araSpeech().stop();
        onListening?.(false);
      }
      return;
    }
    if (!speechSupported()) {
      setErr("Voice isn’t available in this browser. Use the buttons — everything still works.");
    }
  }, [mode]);

  function pttDown() {
    setErr("");
    unlockAraOutput();
    if (!speechSupported()) {
      setErr("Voice isn’t available in this browser. Use the buttons.");
      return;
    }
    if (!active) onMode("ptt");
    activeRef.current = false;
    const rec = recRef.current || createRecognizer();
    if (!rec) return;
    recRef.current = rec;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let finalText = "";
      let finalConfidence: number | undefined;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          finalText += ev.results[i][0].transcript;
          finalConfidence = ev.results[i][0].confidence;
        }
      }
      if (finalText.trim()) {
        const low = typeof finalConfidence === "number" && finalConfidence > 0 && finalConfidence < MIN_REAL_CONFIDENCE;
        onTranscript(finalText.trim(), true, low ? finalConfidence : finalConfidence);
      }
    };
    rec.onerror = (ev) => { setErr(permissionDeniedPlain(ev.error)); onListening?.(false); };
    rec.onstart = () => onListening?.(true);
    rec.onend = () => onListening?.(false);
    try { rec.start(); } catch { setErr(permissionDeniedPlain("not-allowed")); }
  }

  function pttUp() {
    recRef.current?.stop();
  }

  const micBlocked = micPermission === "DENIED" || micPermission === "BLOCKED" || araStatus === "mic_needed";
  const statusLabel =
    voiceUnavailable
      ? "Voice unavailable"
      : mode === "conversation" && araStatus === "connecting"
        ? "Connecting…"
        : mode === "conversation" && (araStatus === "speaking" || outputSpeaking)
          ? "Speaking…"
          : trulyListening
            ? "Listening…"
            : mode === "conversation" && micBlocked
              ? micStatusLabel(micPermission === "UNKNOWN" ? "DENIED" : micPermission)
              : mode === "ptt" && listening
                ? "Listening…"
                : araError && !/microphone/i.test(araError)
                  ? "Hold to speak"
                  : "Ready";

  const tag =
    trulyListening
      ? "Listening with you"
      : mode === "conversation" && micBlocked
        ? "Voice input unavailable"
        : "Your AI operator";

  const micMessage = mode === "conversation" && micBlocked
    ? (micPermission === "BLOCKED"
      ? "Microphone access is blocked. Enable it in your browser permissions to talk to Ara."
      : "Microphone permission is needed to talk to Ara. You can still hear Ara read the screen.")
    : "";

  return (
    <div
      className="la-ara min-w-0"
      data-ara-bar="1"
      data-ara-active={active ? "1" : "0"}
      data-ara-compact="1"
      data-ara-listening={trulyListening ? "1" : "0"}
      data-mic-permission={micPermission}
      data-voice-provider="xAI"
      data-voice-name="Ara"
      data-voice-session-ready={voiceSessionReady ? "1" : "0"}
      data-mic-stream-active={micStreamActive ? "1" : "0"}
      data-output-audio={outputSpeaking ? "1" : "0"}
      data-browser-tts="0"
      data-browser-tts-active="0"
    >
      <div className="la-ara-row">
        <button type="button" className="la-ara-id" aria-label="Ara">
          <span className={`la-ara-orb ${live ? "is-live" : "is-ready"}`} aria-hidden />
          <div>
            <p className="la-ara-name">Ara</p>
            <p className="la-ara-status">{statusLabel}</p>
          </div>
        </button>
        <p className="la-ara-tag">{tag}</p>
        <div className="la-ara-actions">
          {active ? (
            <>
              <button className="la-btn la-btn-ghost" onClick={() => { onMuted(!muted); if (!muted) araSpeech().stop({ keepConversation: true }); }}>
                {muted ? "Unmute" : "Mute"}
              </button>
              <button className="la-btn la-btn-ghost" onClick={onStop}>Stop</button>
            </>
          ) : (
            <button className="la-btn la-btn-primary" onClick={() => { unlockAraOutput(); araSpeech().unlock(); onMode("conversation"); }}>
              {muted ? <MicOff size={16} strokeWidth={2} /> : <Mic size={16} strokeWidth={2} />}
              Conversation
            </button>
          )}
          {onReadPage ? (
            <button className="la-btn la-btn-ghost" onClick={() => { unlockAraOutput(); araSpeech().unlock(); onReadPage(); }}>
              Read page
            </button>
          ) : null}
          <button
            className="la-btn la-btn-ghost touch-none"
            style={{ touchAction: "none" }}
            onPointerDown={pttDown}
            onPointerUp={pttUp}
            onPointerCancel={pttUp}
            onPointerLeave={(e) => { if (e.buttons === 0) pttUp(); }}
          >
            Hold to speak
          </button>
        </div>
      </div>
      {you || reply ? (
        <div className="la-ara-caption" data-ara-caption="1">
          {you ? <p className="la-ara-you"><span className="la-ara-you-label">You · </span>{you}</p> : null}
          {reply ? <p className="la-ara-reply"><span className="la-ara-reply-label">Ara · </span>{reply}</p> : null}
        </div>
      ) : null}
      {err ? <p className="mt-2 text-sm text-bad">{err}</p> : null}
      {micMessage ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">{micMessage}</p>
          {onEnableMic && micPermission !== "BLOCKED" ? (
            <button type="button" className="la-btn la-btn-primary" onClick={() => { unlockAraOutput(); onEnableMic(); }}>
              Enable Microphone
            </button>
          ) : null}
        </div>
      ) : null}
      {voiceUnavailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">{araError || "Ara's voice isn't available right now."}</p>
          {onReconnectVoice ? (
            <button type="button" className="la-btn la-btn-primary" onClick={() => { unlockAraOutput(); araSpeech().unlock(); onReconnectVoice(); }}>
              Reconnect Ara Voice
            </button>
          ) : null}
        </div>
      ) : null}
      {araError && !/microphone/i.test(araError) && !voiceUnavailable ? <p className="mt-2 text-sm text-muted">{araError}</p> : null}
      {!avail && mode === "ptt" ? <p className="mt-2 text-sm">Voice isn’t available here. Buttons still work.</p> : null}
    </div>
  );
}
