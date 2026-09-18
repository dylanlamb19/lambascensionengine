"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import type { VoiceMode } from "@/lib/voice/types";
import type { AraStatus } from "@/lib/voice/ara-client";
import { createRecognizer, permissionDeniedPlain, stopSpeaking, speechSupported, ttsSupported } from "@/lib/voice/speech";

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
}) {
  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const [avail, setAvail] = useState(true);
  const [err, setErr] = useState("");
  const activeRef = useRef(false);
  const active = mode === "conversation";
  const live = listening || araStatus === "listening" || araStatus === "speaking" || araStatus === "connecting";

  useEffect(() => {
    setAvail(speechSupported());
  }, []);

  useEffect(() => {
    if (mode !== "ptt") {
      activeRef.current = false;
      recRef.current?.abort();
      if (mode === "off") {
        stopSpeaking();
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

  const statusLabel =
    mode === "conversation" && araStatus === "connecting"
      ? "Connecting…"
      : mode === "conversation" && araStatus === "speaking"
        ? "Speaking…"
        : mode === "conversation" && (listening || araStatus === "listening")
          ? "Listening…"
          : mode === "ptt" && listening
            ? "Listening…"
            : araError
              ? "Hold to speak"
              : "Ready";

  return (
    <div className="la-ara min-w-0" data-ara-bar="1" data-ara-active={active ? "1" : "0"} data-ara-compact="1">
      <div className="la-ara-row">
        <button type="button" className="la-ara-id" aria-label="Ara">
          <span className={`la-ara-orb ${live ? "is-live" : "is-ready"}`} aria-hidden />
          <div>
            <p className="la-ara-name">Ara</p>
            <p className="la-ara-status">{statusLabel}</p>
          </div>
        </button>
        <p className="la-ara-tag">{active ? "Listening with you" : "Your AI operator"}</p>
        <div className="la-ara-actions">
          {active ? (
            <>
              <button className="la-btn la-btn-ghost" onClick={() => { onMuted(!muted); if (!muted) stopSpeaking(); }}>
                {muted ? "Unmute" : "Mute"}
              </button>
              <button className="la-btn la-btn-ghost" onClick={onStop}>Stop</button>
            </>
          ) : (
            <button className="la-btn la-btn-primary" onClick={() => onMode("conversation")}>
              {muted ? <MicOff size={16} strokeWidth={2} /> : <Mic size={16} strokeWidth={2} />}
              Conversation
            </button>
          )}
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
      {araError ? <p className="mt-2 text-sm text-muted">{araError}</p> : null}
      {!avail && mode === "ptt" ? <p className="mt-2 text-sm">Voice isn’t available here. Buttons still work.</p> : null}
      {mode === "ptt" && !ttsSupported() ? <p className="mt-1 text-xs text-muted">This browser won’t speak replies aloud. You can still read them.</p> : null}
    </div>
  );
}
