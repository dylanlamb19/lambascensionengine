import { isAllowedTool, type AraDeskContext } from "./tools.ts";
import { ARA_UNAVAILABLE, sessionUpdatePayload } from "./ara-context.ts";

export type AraStatus = "ready" | "connecting" | "listening" | "speaking" | "unavailable";

export type AraHandlers = {
  onStatus: (s: AraStatus) => void;
  onUserTranscript: (text: string, isFinal: boolean) => void;
  onAraTranscript: (text: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>, callId: string) => Promise<Record<string, unknown>>;
  onError: (plain: string) => void;
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
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
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
  private playCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private playTime = 0;
  private muted = false;
  private pendingCalls = 0;
  private closed = false;
  private handledCalls = new Set<string>();

  constructor(
    private readonly token: string,
    private readonly wsUrl: string,
    private readonly handlers: AraHandlers,
  ) {}

  setMuted(v: boolean) {
    this.muted = v;
    if (v) {
      void this.playCtx?.suspend();
    } else {
      void this.playCtx?.resume();
    }
  }

  async start(ctx: AraDeskContext): Promise<void> {
    this.handlers.onStatus("connecting");
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
      this.handlers.onStatus("listening");
      void this.startMic();
    };
    ws.onerror = () => {
      if (!this.closed) this.handlers.onError(ARA_UNAVAILABLE);
      this.handlers.onStatus("unavailable");
    };
    ws.onclose = () => {
      if (!this.closed) {
        this.handlers.onStatus("unavailable");
        this.handlers.onError(ARA_UNAVAILABLE);
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
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.recCtx?.close();
    void this.playCtx?.close();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.handlers.onStatus("ready");
  }

  private async startMic() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.recCtx = new AudioContext();
      if (this.recCtx.state === "suspended") await this.recCtx.resume();
      const src = this.recCtx.createMediaStreamSource(this.stream);
      const proc = this.recCtx.createScriptProcessor(4096, 1, 1);
      this.processor = proc;
      proc.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.closed) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const ds = downsample(f32, this.recCtx?.sampleRate || 48000, 24000);
        const pcm = floatTo16(ds);
        this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmToBase64(pcm) }));
      };
      // ScriptProcessor must be connected to output to run, but mic must stay silent.
      const mute = this.recCtx.createGain();
      mute.gain.value = 0;
      src.connect(proc);
      proc.connect(mute);
      mute.connect(this.recCtx.destination);
    } catch {
      this.handlers.onError("Microphone permission is needed to talk to Ara. Buttons still work.");
    }
  }

  private playPcm(pcm: Int16Array) {
    if (this.muted || this.closed) return;
    if (!this.playCtx) this.playCtx = new AudioContext({ sampleRate: 24000 });
    const ctx = this.playCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (this.playTime < now) this.playTime = now;
    src.start(this.playTime);
    this.playTime += buf.duration;
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
      if (this.pendingCalls <= 0) {
        this.ws.send(JSON.stringify({ type: "response.create" }));
      }
    }
  }

  private async onEvent(ev: Record<string, unknown>) {
    const type = String(ev.type || "");
    if (type === "error") {
      this.handlers.onError(ARA_UNAVAILABLE);
      this.handlers.onStatus("unavailable");
      return;
    }
    if (type === "input_audio_buffer.speech_started") this.handlers.onStatus("listening");
    if (type === "response.output_audio.delta" && typeof ev.delta === "string") {
      this.handlers.onStatus("speaking");
      this.playPcm(base64ToPcm(ev.delta));
    }
    if (type === "response.output_audio_transcript.delta" && typeof ev.delta === "string") {
      this.handlers.onAraTranscript(ev.delta);
    }
    if (type === "response.output_audio_transcript.done" && typeof ev.transcript === "string") {
      this.handlers.onAraTranscript(ev.transcript);
    }
    if (type === "conversation.item.input_audio_transcription.updated" && typeof ev.transcript === "string") {
      this.handlers.onUserTranscript(ev.transcript, false);
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = String(ev.transcript || ev.text || "");
      if (text) this.handlers.onUserTranscript(text, true);
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
    if (type === "response.done") this.handlers.onStatus("listening");
  }
}
