import { isAllowedTool, type AraDeskContext } from "./tools.ts";
import { sessionUpdatePayload } from "./ara-context.ts";
import { realtimeErrorText, voiceFailureReason } from "./voice-failure.ts";
import { shouldFailClosedOnRealtimeError } from "./lifecycle.ts";
import { araSpeech } from "./speech-controller.ts";
import { micStreamLive, stopMicStream } from "./mic.ts";

export type AraStatus = "ready" | "connecting" | "listening" | "speaking" | "unavailable" | "mic_needed";

export type AraHandlers = {
  onStatus: (s: AraStatus) => void;
  onUserTranscript: (text: string, isFinal: boolean, itemId?: string) => void;
  onAraTranscript: (text: string, isFinal?: boolean) => void;
  onToolCall: (name: string, args: Record<string, unknown>, callId: string) => Promise<Record<string, unknown>>;
  onError: (plain: string) => void;
  onMic?: (live: boolean, reason?: string) => void;
};

function floatTo16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, chunk + i));
  }
  return btoa(s);
}

function base64ToPcm(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export class AraRealtime {
  private ws: WebSocket | null = null;
  private recCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private muted = false;
  private pendingCalls = 0;
  private closed = false;
  private handledCalls = new Set<string>();
  private micGated = false;
  private micLive = false;
  private sessionReady = false;
  private givenStream = false;

  constructor(
    private readonly token: string,
    private readonly wsUrl: string,
    private readonly handlers: AraHandlers,
  ) {}

  get microphoneLive(): boolean {
    return this.micLive && micStreamLive(this.stream);
  }

  get sessionIsReady(): boolean {
    return this.sessionReady && this.ws?.readyState === WebSocket.OPEN;
  }

  setMuted(v: boolean) {
    this.muted = v;
    araSpeech().setMuted(v);
  }

  setMicGated(v: boolean) {
    this.micGated = v;
  }

  cancelResponse() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: "response.cancel" })); } catch { /* ignore */ }
    }
    araSpeech().conversationEnded();
  }

  async start(ctx: AraDeskContext, opts?: { stream?: MediaStream | null; withMic?: boolean }): Promise<void> {
    this.handlers.onStatus("connecting");
    araSpeech().unlock();
    const withMic = opts?.withMic !== false;
    if (withMic) {
      const ok = await this.startMic(opts?.stream || null);
      if (!ok) {
        this.handlers.onStatus("mic_needed");
        return;
      }
    }
    const url = this.wsUrl;
    const proto = `xai-client-secret.${this.token}`;
    const ws = new WebSocket(url, [proto]);
    this.ws = ws;
    ws.onopen = () => {
      if (this.closed) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify(sessionUpdatePayload(ctx)));
      this.sessionReady = true;
      araSpeech().setSession(true);
      if (this.microphoneLive) this.handlers.onStatus("listening");
      else this.handlers.onStatus("ready");
    };
    ws.onerror = () => {
      if (!this.closed) this.handlers.onError(voiceFailureReason("WEBSOCKET_FAILED"));
      this.handlers.onStatus("unavailable");
      araSpeech().setSession(false);
    };
    ws.onclose = () => {
      this.sessionReady = false;
      araSpeech().setSession(false);
      if (!this.closed) {
        this.handlers.onStatus("unavailable");
        this.handlers.onError(voiceFailureReason("WEBSOCKET_FAILED"));
      }
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        void this.onEvent(JSON.parse(ev.data) as Record<string, unknown>);
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  updateContext(ctx: AraDeskContext) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(sessionUpdatePayload(ctx)));
    }
  }

  stop() {
    this.closed = true;
    this.sessionReady = false;
    this.micLive = false;
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    if (!this.givenStream) stopMicStream(this.stream);
    this.stream = null;
    void this.recCtx?.close();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    araSpeech().setSession(false);
    araSpeech().conversationEnded();
    this.handlers.onStatus("ready");
  }

  private async startMic(existing: MediaStream | null): Promise<boolean> {
    try {
      if (existing && micStreamLive(existing)) {
        this.stream = existing;
        this.givenStream = true;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        this.givenStream = false;
      }
      if (!micStreamLive(this.stream)) {
        this.handlers.onMic?.(false, "Microphone permission is needed to talk to Ara.");
        this.handlers.onError(voiceFailureReason("MIC_BLOCKED"));
        return false;
      }
      this.recCtx = new AudioContext();
      if (this.recCtx.state === "suspended") await this.recCtx.resume();
      const src = this.recCtx.createMediaStreamSource(this.stream);
      const proc = this.recCtx.createScriptProcessor(4096, 1, 1);
      this.processor = proc;
      proc.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.closed || this.micGated) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const ds = downsample(f32, this.recCtx?.sampleRate || 48000, 24000);
        const pcm = floatTo16(ds);
        this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmToBase64(pcm) }));
      };
      const mute = this.recCtx.createGain();
      mute.gain.value = 0;
      src.connect(proc);
      proc.connect(mute);
      mute.connect(this.recCtx.destination);
      this.micLive = true;
      this.handlers.onMic?.(true);
      araSpeech().onMicGate = (gated) => this.setMicGated(gated);
      return true;
    } catch {
      this.micLive = false;
      this.handlers.onMic?.(false, "Microphone permission is needed to talk to Ara.");
      this.handlers.onError("Microphone permission is needed to talk to Ara. Buttons still work.");
      return false;
    }
  }

  /** Kept for tests and conversation PCM → the one Ara speech controller. */
  playPcm(pcm: Int16Array) {
    if (this.muted || this.closed) return;
    araSpeech().playConversationPcm(pcm);
  }

  private async runTool(name: string, args: Record<string, unknown>, callId: string) {
    if (callId && this.handledCalls.has(callId)) return;
    if (callId) this.handledCalls.add(callId);
    this.pendingCalls += 1;
    let output: Record<string, unknown>;
    if (!isAllowedTool(name)) {
      output = { ok: false, reason: "That tool is not on the allowlist." };
    } else {
      try {
        output = await this.handlers.onToolCall(name, args, callId);
      } catch {
        output = { ok: false, reason: "That action did not finish." };
      }
    }
    this.pendingCalls -= 1;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      }));
      if (this.pendingCalls <= 0 && !output.already_spoken) {
        this.ws.send(JSON.stringify({ type: "response.create" }));
      }
    }
  }

  private async onEvent(ev: Record<string, unknown>) {
    const type = String(ev.type || "");
    if (type === "error") {
      if (!shouldFailClosedOnRealtimeError(ev)) {
        if (this.microphoneLive) this.handlers.onStatus("listening");
        else if (this.sessionReady) this.handlers.onStatus("ready");
        return;
      }
      const detail = realtimeErrorText(ev).toLowerCase();
      const code = /auth|token|unauthor|forbidden|invalid api key|not authenticated/.test(detail)
        ? "VOICE_AUTH_FAILED"
        : "PROVIDER_ERROR";
      this.handlers.onError(voiceFailureReason(code));
      this.handlers.onStatus("unavailable");
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      if (this.microphoneLive) this.handlers.onStatus("listening");
    }
    if (type === "response.output_audio.delta" && typeof ev.delta === "string") {
      this.handlers.onStatus("speaking");
      this.playPcm(base64ToPcm(ev.delta));
    }
    if (type === "response.output_audio_transcript.delta" && typeof ev.delta === "string") {
      this.handlers.onAraTranscript(ev.delta, false);
    }
    if (type === "response.output_audio_transcript.done" && typeof ev.transcript === "string") {
      this.handlers.onAraTranscript(ev.transcript, true);
    }
    if (type === "conversation.item.input_audio_transcription.updated" && typeof ev.transcript === "string") {
      this.handlers.onUserTranscript(ev.transcript, false, String(ev.item_id || ""));
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = String(ev.transcript || ev.text || "");
      if (text) this.handlers.onUserTranscript(text, true, String(ev.item_id || ""));
    }
    if (type === "response.function_call_arguments.done") {
      const name = String(ev.name || "");
      const callId = String(ev.call_id || ev.callId || "");
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(String(ev.arguments || "{}")) as Record<string, unknown>; } catch { args = {}; }
      await this.runTool(name, args, callId);
    }
    if (type === "response.output_item.done") {
      const item = ev.item as { type?: string; name?: string; call_id?: string; arguments?: string } | undefined;
      if (item?.type === "function_call" && item.name && item.call_id) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(item.arguments || "{}")) as Record<string, unknown>; } catch { args = {}; }
        await this.runTool(item.name, args, item.call_id);
      }
    }
    if (type === "response.done") {
      araSpeech().conversationEnded();
      if (this.microphoneLive) this.handlers.onStatus("listening");
      else this.handlers.onStatus(this.sessionReady ? "ready" : "unavailable");
    }
  }
}
