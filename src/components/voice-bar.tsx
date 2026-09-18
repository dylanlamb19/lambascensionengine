"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import type { VoiceMode } from "@/lib/voice/types";
import type { AraStatus } from "@/lib/voice/ara-client";
import { createRecognizer, permissionDeniedPlain, stopSpeaking, speechSupported, ttsSupported } from "@/lib/voice/speech";
import { replayAraOutput, unlockAraOutput } from "@/lib/voice/audio-out";
import { isHallucinatedStopAck } from "@/lib/voice/intents";
import type { VoiceSnapshot } from "@/lib/voice/lifecycle";
import type { AraSource } from "@/lib/voice/web-research/types";

const MIN_REAL_CONFIDENCE = 0.4;

type Turn = { you: string; reply: string };

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
  onAskAra,
  araStatus = "ready",
  araError = "",
  sources = [],
  debug = null,
  realtime = true,
  onAsk,
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
  onAskAra?: () => void;
  araStatus?: AraStatus;
  araError?: string;
  sources?: AraSource[];
  debug?: VoiceSnapshot | null;
  realtime?: boolean;
  onAsk?: (text: string) => void;
}) {
  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const [avail, setAvail] = useState(true);
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [heldReply, setHeldReply] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const askRef = useRef<HTMLInputElement>(null);
  const committed = useRef("");
  const activeRef = useRef(false);
  const active = mode === "conversation";
  const realtimeDown = Boolean(araError) || araStatus === "unavailable" || (active && !realtime);
  const live = listening || araStatus === "listening" || araStatus === "hearing" || araStatus === "speaking" || araStatus === "connecting" || araStatus === "thinking";
  const captionYou = you.trim();
  const rawReply = (reply.trim() || heldReply).trim();
  const captionReply = active && isHallucinatedStopAck(rawReply) ? "" : rawReply;
  const showCaption = Boolean(captionYou || captionReply);

  useEffect(() => {
    setAvail(speechSupported());
  }, []);

  useEffect(() => {
    if (reply.trim()) {
      if (active && isHallucinatedStopAck(reply)) {
        setHeldReply("");
        return;
      }
      setHeldReply(reply.trim());
      return;
    }
    if (araStatus === "listening" || araStatus === "hearing") setHeldReply((prev) => (isHallucinatedStopAck(prev) ? "" : prev));
  }, [reply, araStatus, active]);

  useEffect(() => {
    if (araStatus === "speaking" || araStatus === "thinking" || araStatus === "connecting") return;
    const y = you.trim();
    const r = reply.trim() || heldReply;
    if (!y && !r) return;
    const key = `${y}||${r}`;
    if (key === committed.current) return;
    committed.current = key;
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.you === y && last.reply === r) return prev;
      return [...prev, { you: y, reply: r }].slice(-24);
    });
  }, [you, reply, heldReply, araStatus]);

  useEffect(() => {
    if (mode !== "ptt") {
      activeRef.current = false;
      recRef.current?.abort();
      if (mode === "off") {
        stopSpeaking();
        onListening?.(false);
        setHistoryOpen(false);
      }
      return;
    }
    if (!speechSupported()) {
      setErr("Voice isn't available in this browser. Use the buttons — everything still works.");
    }
  }, [mode]);

  useEffect(() => {
    if (active) setComposerOpen(true);
  }, [active]);

  useEffect(() => {
    if (realtimeDown) setComposerOpen(true);
  }, [realtimeDown]);

  useEffect(() => {
    if (composerOpen) askRef.current?.focus();
  }, [composerOpen]);

  function openHistory() {
    setHistoryOpen(true);
    onAskAra?.();
  }

  function openAsk() {
    unlockAraOutput({ cue: false });
    setComposerOpen((v) => !v);
    setHistoryOpen(false);
  }

  function submitAsk() {
    const t = askText.trim();
    if (t.length < 2) return;
    unlockAraOutput({ cue: false });
    setAskText("");
    if (onAsk) onAsk(t);
    else onTranscript(t, true, 1);
  }

  function pttDown() {
    setErr("");
    unlockAraOutput({ cue: true });
    if (!speechSupported()) {
      setErr("Voice isn’t available in this browser. Type to Ara instead.");
      setComposerOpen(true);
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
    mode === "conversation" && araStatus === "connecting" && !realtimeDown
      ? "Connecting…"
      : mode === "conversation" && araStatus === "thinking"
        ? "Thinking…"
        : mode === "conversation" && araStatus === "speaking"
          ? "Speaking…"
          : mode === "conversation" && araStatus === "hearing" && !realtimeDown
            ? "Hearing you…"
            : mode === "conversation" && (listening || araStatus === "listening") && !realtimeDown
              ? "Listening…"
              : mode === "ptt" && listening
                ? "Listening…"
                : realtimeDown && (active || composerOpen)
                  ? "Type or hold"
                  : "Ready";

  const past = history.filter((t) => !(t.you === captionYou && t.reply === captionReply));

  return (
    <div
      className="la-ara min-w-0"
      data-ara-bar="1"
      data-ara-active={active ? "1" : "0"}
      data-ara-compact={historyOpen ? "0" : "1"}
      data-ara-transcript-open={historyOpen ? "1" : "0"}
      data-ara-voice-debug={debug ? "1" : "0"}
      data-voice-state={debug?.voiceState || ""}
    >
      <div className="la-ara-row">
        <button type="button" className="la-ara-id" onClick={openHistory} aria-label="Ara">
          <span className={`la-ara-orb ${live ? "is-live" : "is-ready"}`} aria-hidden />
          <div>
            <p className="la-ara-name">Ara</p>
            <p className="la-ara-status">{statusLabel}</p>
          </div>
        </button>
        <p className="la-ara-tag">{active ? "Running the desk with you" : "Your AI operator"}</p>
        <div className="la-ara-actions">
          <button className="la-btn la-btn-ghost" onClick={openAsk} data-ara-ask-btn="1">
            {composerOpen ? "Hide" : "Ask Ara"}
          </button>
          {active ? (
            <>
              {realtime && !realtimeDown ? (
                <>
                  <button
                    className="la-btn la-btn-primary"
                    data-ara-hear="1"
                    onClick={() => {
                      replayAraOutput();
                    }}
                  >
                    Hear Ara
                  </button>
                  <button className="la-btn la-btn-ghost" onClick={() => {
                    if (muted) {
                      unlockAraOutput();
                      replayAraOutput();
                    }
                    onMuted(!muted);
                    if (!muted) stopSpeaking();
                  }}>
                    {muted ? "Unmute" : "Mute"}
                  </button>
                </>
              ) : null}
              <button className="la-btn la-btn-ghost" onClick={onStop}>Stop</button>
            </>
          ) : (
            <button
              className="la-btn la-btn-primary"
              data-ara-conversation="1"
              onClick={() => {
                unlockAraOutput({ cue: true });
                onMode("conversation");
              }}
            >
              {muted ? <MicOff size={16} strokeWidth={2} /> : <Mic size={16} strokeWidth={2} />}
              Conversation
            </button>
          )}
        </div>
      </div>
      {composerOpen ? (
        <form
          className="la-ara-ask"
          data-ara-ask="1"
          onSubmit={(e) => {
            e.preventDefault();
            submitAsk();
          }}
        >
          <input
            ref={askRef}
            className="la-field"
            value={askText}
            placeholder={active && !realtimeDown ? "Talk or type to Ara…" : "Ask Ara…"}
            onChange={(e) => setAskText(e.target.value)}
            aria-label="Ask Ara"
            autoComplete="off"
          />
          <button className="la-btn la-btn-primary" type="submit" disabled={askText.trim().length < 2}>
            Send
          </button>
          <button
            type="button"
            className="la-btn la-btn-ghost touch-none"
            style={{ touchAction: "none" }}
            aria-label="Hold to speak"
            onPointerDown={pttDown}
            onPointerUp={pttUp}
            onPointerCancel={pttUp}
            onPointerLeave={(e) => { if (e.buttons === 0) pttUp(); }}
          >
            Hold to speak
          </button>
        </form>
      ) : null}
      {showCaption ? (
        <div className="la-ara-caption" data-ara-caption="1">
          {captionYou ? (
            <p className="la-ara-you"><span className="la-ara-you-label">You · </span>{captionYou}</p>
          ) : null}
          {captionReply ? (
            <p className="la-ara-reply"><span className="la-ara-reply-label">Ara · </span>{captionReply}</p>
          ) : null}
        </div>
      ) : null}
      {historyOpen && past.length ? (
        <div className="la-ara-history" data-ara-transcript="1">
          {past.map((t, i) => (
            <div key={`${t.you}-${i}`} className="la-ara-turn">
              {t.you ? <p className="la-ara-you"><span className="la-ara-you-label">You · </span>{t.you}</p> : null}
              {t.reply ? <p className="la-ara-history-reply"><span className="la-ara-reply-label">Ara · </span>{t.reply}</p> : null}
            </div>
          ))}
        </div>
      ) : historyOpen ? (
        <div className="la-ara-history" data-ara-transcript="1" />
      ) : null}
      {historyOpen && sources.length ? (
        <div className="mt-2" data-ara-sources="1">
          <button className="la-btn la-btn-quiet" onClick={() => setShowSources((v) => !v)}>
            {showSources ? "Hide sources" : `Sources (${sources.length})`}
          </button>
          {showSources ? (
            <ul className="mt-1 space-y-1 text-xs text-muted">
              {sources.map((s) => (
                <li key={s.url}>
                  <a className="text-gold underline" href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.domain}
                  </a>
                  <span> · {s.publisher || s.domain}{s.published ? ` · ${s.published}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {debug ? (
        <div className="la-voice-debug" data-ara-voice-debug-panel="1">
          <p className="la-voice-debug-title">Voice debug</p>
          <dl>
            <div><dt>session</dt><dd>{debug.conversationSessionId}</dd></div>
            <div><dt>state</dt><dd>{debug.voiceState}</dd></div>
            <div><dt>user_turn</dt><dd>{debug.activeUserTurnId || "—"}</dd></div>
            <div><dt>response</dt><dd>{debug.activeResponseId || "—"}</dd></div>
            <div><dt>tts</dt><dd>{debug.currentTtsId || "—"}</dd></div>
            <div><dt>mic</dt><dd>{debug.mic}</dd></div>
            <div><dt>vad</dt><dd>{debug.vad}</dd></div>
            <div><dt>queued</dt><dd>{debug.queuedChunks}</dd></div>
            <div><dt>last</dt><dd>{debug.lastEvent}</dd></div>
            <div><dt>dup dropped</dt><dd>{debug.duplicatesDropped}</dd></div>
            <div><dt>stale dropped</dt><dd>{debug.staleDropped}</dd></div>
            <div><dt>barge-in</dt><dd>{debug.bargeInEvents}</dd></div>
            <div><dt>session_config_acknowledged</dt><dd>{debug.sessionConfigAcknowledged ? "yes" : "no"}</dd></div>
            <div><dt>thinking_reason</dt><dd>{debug.thinkingReason || "—"}</dd></div>
            <div><dt>thinking_since</dt><dd>{debug.thinkingSince || "—"}</dd></div>
            <div><dt>response_watchdog_turn_id</dt><dd>{debug.responseWatchdogTurnId || "—"}</dd></div>
            <div><dt>response_watchdog_elapsed</dt><dd>{debug.responseWatchdogElapsed}</dd></div>
            <div><dt>recovery_kick_sent</dt><dd>{debug.recoveryKickSent ? "yes" : "no"}</dd></div>
            <div><dt>last_provider_error</dt><dd>{debug.lastProviderError || "—"}</dd></div>
            <div><dt>last_provider_event</dt><dd>{debug.lastProviderEvent || "—"}</dd></div>
            <div><dt>stop_intent_detected</dt><dd>{debug.stopIntentDetected ? "yes" : "no"}</dd></div>
            <div><dt>stop_intent_source</dt><dd>{debug.stopIntentSource || "—"}</dd></div>
            <div><dt>stop_intent_confidence</dt><dd>{debug.stopIntentConfidence || "—"}</dd></div>
            <div><dt>stop_intent_phrase</dt><dd>{debug.stopIntentPhrase || "—"}</dd></div>
            <div><dt>stop_intent_turn_id</dt><dd>{debug.stopIntentTurnId || "—"}</dd></div>
            <div><dt>last_interim</dt><dd>{debug.lastInterimTranscript || "—"}</dd></div>
            <div><dt>last_final</dt><dd>{debug.lastFinalTranscript || "—"}</dd></div>
            <div><dt>last_normalized</dt><dd>{debug.lastNormalizedTranscript || "—"}</dd></div>
            <div><dt>playback_generation</dt><dd>{debug.playbackGeneration}</dd></div>
            <div><dt>suppress_model_speech</dt><dd>{debug.suppressModelSpeech ? "yes" : "no"}</dd></div>
          </dl>
          {debug.logs.length ? (
            <ol>
              {debug.logs.slice(-12).map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      {showCaption || history.length ? (
        <button
          className="la-btn la-btn-quiet mt-1"
          onClick={() => {
            if (historyOpen) {
              setHistoryOpen(false);
              setMore(false);
              setShowSources(false);
            } else {
              openHistory();
            }
          }}
        >
          {historyOpen ? "Hide conversation" : "View conversation"}
        </button>
      ) : null}
      {historyOpen ? (
        <button
          className="la-btn la-btn-quiet mt-1"
          onClick={() => setMore((v) => !v)}
        >
          {more ? "Hide voice options" : "More voice options"}
        </button>
      ) : null}
      {more ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!composerOpen ? (
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
          ) : null}
          {!active ? (
            <button className="la-btn la-btn-ghost" onClick={onStop}>Voice off</button>
          ) : null}
        </div>
      ) : null}
      {err ? <p className="mt-2 text-sm text-bad">{err}</p> : null}
      {realtimeDown && (composerOpen || active) ? (
        <p className="la-ara-fallback" data-ara-fallback="1">
          {araError && !/temporarily unavailable/i.test(araError)
            ? araError
            : "Voice isn’t on this device. Type or hold — Ara still runs the desk."}
        </p>
      ) : null}
      {!avail && mode === "ptt" ? <p className="mt-2 text-sm">Voice isn’t available here. Type to Ara instead.</p> : null}
      {mode === "ptt" && !ttsSupported() ? <p className="mt-1 text-xs text-muted">This browser won’t speak replies aloud. You can still read them.</p> : null}
    </div>
  );
}
