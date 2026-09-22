import { unlockAraOutput } from "./audio-out.ts";
import { voiceFailureReason } from "./voice-failure.ts";

export type SpeechSource =
  | "CONVERSATION"
  | "SCREEN_READER"
  | "WARNING"
  | "ERROR"
  | "BLOCKER"
  | "TASK"
  | "NAVIGATION"
  | "TOOL_RESULT"
  | "STOP"
  | "CONFIRM"
  | "LINKEDIN_ORDER";

export type SpeechPriority = 1 | 2 | 3 | 4 | 5;

export const SOURCE_PRIORITY: Record<SpeechSource, SpeechPriority> = {
  CONVERSATION: 1,
  STOP: 2,
  BLOCKER: 2,
  SCREEN_READER: 3,
  ERROR: 3,
  WARNING: 4,
  TASK: 4,
  TOOL_RESULT: 4,
  NAVIGATION: 5,
  CONFIRM: 2,
  LINKEDIN_ORDER: 4,
};

export type SpeakOpts = {
  source: SpeechSource;
  priority?: SpeechPriority;
  exact?: boolean;
  dedupeKey?: string;
};

export type SpeechDiagnostics = {
  mic_permission: string;
  mic_stream_active: boolean;
  voice_session_ready: boolean;
  voice_provider: string;
  voice_name: string;
  speech_queue_length: number;
  speech_current_source: string | null;
  speech_current_id: string | null;
  audio_context_state: string | null;
  browser_tts_active: boolean;
  fallback_tts_active: boolean;
  speech_source: string | null;
  voice_session_id: string | null;
};

export type SpeechJob = {
  id: string;
  text: string;
  source: SpeechSource;
  priority: SpeechPriority;
  dedupeKey?: string;
};

export type TtsResult =
  | { ok: true; pcm: string; rate: number; voice: string; provider: string; speech_source?: string }
  | { ok: false; reason: string };

export type TtsClient = (text: string, source: string) => Promise<TtsResult>;

const defaultTts: TtsClient = async (text, source) => {
  const { speakAraFn } = await import("./tts.ts");
  const r = await speakAraFn({ data: { text, source } });
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    pcm: r.pcm,
    rate: r.rate,
    voice: r.voice,
    provider: r.provider,
    speech_source: r.speech_source,
  };
};


let injectedTts: TtsClient | null = null;

export function setTtsClientForTests(client: TtsClient | null): void {
  injectedTts = client;
}

function ttsClient(): TtsClient {
  return injectedTts || defaultTts;
}

export function decodeTtsAudio(b64: string, fallbackRate = 24000): { pcm: Int16Array; rate: number } {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return decodeWav(bytes, fallbackRate);
  }
  const even = bytes.byteLength - (bytes.byteLength % 2);
  const copy = new Uint8Array(even);
  copy.set(bytes.subarray(0, even));
  return { pcm: new Int16Array(copy.buffer), rate: fallbackRate };
}

function decodeWav(bytes: Uint8Array, fallbackRate: number): { pcm: Int16Array; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = fallbackRate;
  let dataOffset = -1;
  let dataLen = 0;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const size = view.getUint32(o + 4, true);
    if (id === "fmt " && size >= 16) {
      rate = view.getUint32(o + 12, true) || fallbackRate;
    } else if (id === "data") {
      dataOffset = o + 8;
      dataLen = size;
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (dataOffset < 0) {
    const even = bytes.byteLength - (bytes.byteLength % 2);
    const copy = new Uint8Array(even);
    copy.set(bytes.subarray(0, even));
    return { pcm: new Int16Array(copy.buffer), rate: fallbackRate };
  }
  const slice = bytes.subarray(dataOffset, Math.min(bytes.length, dataOffset + dataLen));
  const even = slice.byteLength - (slice.byteLength % 2);
  const copy = new Uint8Array(even);
  copy.set(slice.subarray(0, even));
  return { pcm: new Int16Array(copy.buffer), rate };
}

function logDev(payload: Record<string, unknown>) {
  if (typeof console === "undefined") return;
  try {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") return;
  } catch {
    /* ignore */
  }
  console.info("[ara-speech]", payload);
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `ara_speech_${seq}`;
}

export class AraSpeechController {
  private playCtx: AudioContext | null = null;
  private playTime = 0;
  private queue: SpeechJob[] = [];
  private current: SpeechJob | null = null;
  private conversationActive = false;
  private muted = false;
  private voiceUnavailable = false;
  private gen = 0;
  private playing = false;
  private lastDedupe = new Map<string, number>();
  micPermission = "UNKNOWN";
  micStreamActive = false;
  voiceSessionReady = false;
  voiceSessionId: string | null = null;
  onCaption: ((text: string) => void) | null = null;
  onUnavailable: ((unavailable: boolean, reason: string) => void) | null = null;
  onSpeaking: ((speaking: boolean, source: SpeechSource | null) => void) | null = null;
  onMicGate: ((gated: boolean) => void) | null = null;
  onChange: (() => void) | null = null;

  get unavailable(): boolean {
    return this.voiceUnavailable;
  }

  get speaking(): boolean {
    return this.playing || this.conversationActive;
  }

  get currentSource(): SpeechSource | null {
    return this.current?.source || (this.conversationActive ? "CONVERSATION" : null);
  }

  unlock(): boolean {
    unlockAraOutput();
    return this.ensureCtx();
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (v) this.stop({ keepConversation: true });
    if (this.playCtx) {
      if (v) void this.playCtx.suspend();
      else void this.playCtx.resume();
    }
  }

  setSession(ready: boolean, sessionId?: string | null) {
    this.voiceSessionReady = ready;
    if (sessionId !== undefined) this.voiceSessionId = sessionId;
    this.emit();
  }

  setMic(permission: string, streamActive: boolean) {
    this.micPermission = permission;
    this.micStreamActive = streamActive;
    this.emit();
  }

  diagnostics(): SpeechDiagnostics {
    return {
      mic_permission: this.micPermission,
      mic_stream_active: this.micStreamActive,
      voice_session_ready: this.voiceSessionReady,
      voice_provider: "xAI",
      voice_name: "Ara",
      speech_queue_length: this.queue.length + (this.current && this.current.source !== "CONVERSATION" ? 1 : 0),
      speech_current_source: this.currentSource,
      speech_current_id: this.current?.id || null,
      audio_context_state: this.playCtx?.state || null,
      browser_tts_active: false,
      fallback_tts_active: false,
      speech_source: this.currentSource,
      voice_session_id: this.voiceSessionId,
    };
  }

  playConversationPcm(pcm: Int16Array) {
    if (this.muted || !pcm.length) return;
    if (this.current && this.current.source !== "CONVERSATION") {
      this.interruptCurrent();
    }
    this.conversationActive = true;
    this.current = { id: "conversation", text: "", source: "CONVERSATION", priority: 1 };
    this.playing = true;
    this.onSpeaking?.(true, "CONVERSATION");
    this.playPcm(pcm);
    this.emit();
  }

  conversationEnded() {
    this.conversationActive = false;
    if (this.current?.source === "CONVERSATION") {
      this.current = null;
      this.playing = false;
      this.onSpeaking?.(false, null);
    }
    this.drain();
    this.emit();
  }

  async speakAsAra(text: string, opts: SpeakOpts): Promise<boolean> {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) return false;
    const source = opts.source;
    const priority = opts.priority || SOURCE_PRIORITY[source];
    const job: SpeechJob = { id: nextId(), text: clean, source, priority, dedupeKey: opts.dedupeKey };
    this.onCaption?.(clean);
    if (opts.dedupeKey) {
      const last = this.lastDedupe.get(opts.dedupeKey) || 0;
      if (Date.now() - last < 30_000) return false;
      this.lastDedupe.set(opts.dedupeKey, Date.now());
    }
    if (this.current && this.current.text === clean) return false;
    if (this.queue.some((j) => j.text === clean)) return false;
    logDev({
      voice_provider: "xAI",
      voice_name: "Ara",
      voice_session_id: this.voiceSessionId,
      speech_source: source,
    });
    if (this.muted) return true;
    if (this.conversationActive || (this.current && this.current.priority <= priority && this.playing)) {
      this.enqueue(job);
      this.emit();
      return true;
    }
    await this.playJob(job);
    return true;
  }

  stop(opts?: { keepConversation?: boolean }) {
    this.gen += 1;
    this.queue = [];
    if (!opts?.keepConversation || this.current?.source !== "CONVERSATION") {
      this.current = opts?.keepConversation && this.conversationActive
        ? { id: "conversation", text: "", source: "CONVERSATION", priority: 1 }
        : null;
      if (!opts?.keepConversation) {
        this.conversationActive = false;
        this.playing = false;
        this.playTime = 0;
        this.onSpeaking?.(false, null);
        this.onMicGate?.(false);
      }
    }
    this.emit();
  }

  private enqueue(job: SpeechJob) {
    this.queue = this.queue.filter((j) => j.text !== job.text);
    this.queue.push(job);
    this.queue.sort((a, b) => a.priority - b.priority);
    if (this.queue.length > 8) this.queue = this.queue.slice(0, 8);
  }

  private interruptCurrent() {
    this.gen += 1;
    this.current = null;
    this.playing = this.conversationActive;
    this.onMicGate?.(false);
  }

  private drain() {
    if (this.conversationActive || this.playing) return;
    const next = this.queue.shift();
    if (!next) {
      this.onMicGate?.(false);
      this.onSpeaking?.(false, null);
      this.emit();
      return;
    }
    void this.playJob(next);
  }

  private async playJob(job: SpeechJob) {
    if (this.muted) return;
    const gen = this.gen;
    this.current = job;
    this.playing = true;
    this.onCaption?.(job.text);
    this.onSpeaking?.(true, job.source);
    this.onMicGate?.(true);
    this.emit();
    try {
      const result = await ttsClient()(job.text, job.source);
      if (gen !== this.gen) return;
      if (!result.ok) {
        this.failPlayback(result.reason, gen);
        return;
      }
      this.voiceUnavailable = false;
      this.onUnavailable?.(false, "");
      let pcm: Int16Array;
      let rate: number;
      try {
        const decoded = decodeTtsAudio(result.pcm, result.rate || 24000);
        pcm = decoded.pcm;
        rate = decoded.rate;
      } catch {
        this.failPlayback(voiceFailureReason("VOICE_AUDIO_DECODE_FAILED"), gen);
        return;
      }
      if (!pcm.length) {
        this.failPlayback(voiceFailureReason("VOICE_BAD_RESPONSE"), gen);
        return;
      }
      if (gen !== this.gen) return;
      try {
        this.playPcm(pcm, rate);
      } catch {
        this.failPlayback(voiceFailureReason("VOICE_PLAYBACK_FAILED"), gen);
        return;
      }
      const ms = Math.max(80, (pcm.length / (rate || 24000)) * 1000 + 40);
      await wait(ms);
      if (gen !== this.gen) return;
      this.playing = false;
      this.current = null;
      this.onMicGate?.(false);
      this.onSpeaking?.(false, null);
      this.drain();
    } catch {
      if (gen !== this.gen) return;
      this.failPlayback(voiceFailureReason("VOICE_PLAYBACK_FAILED"), gen);
    }
  }

  private failPlayback(reason: string, gen: number) {
    if (gen !== this.gen) return;
    this.voiceUnavailable = true;
    this.playing = false;
    this.current = null;
    this.queue = [];
    this.onUnavailable?.(true, reason);
    this.onMicGate?.(false);
    this.onSpeaking?.(false, null);
    this.emit();
  }

  private ensureCtx(): boolean {
    if (typeof AudioContext === "undefined") return false;
    try {
      if (!this.playCtx) this.playCtx = new AudioContext({ sampleRate: 24000 });
      if (this.playCtx.state === "suspended") void this.playCtx.resume();
      return true;
    } catch {
      return false;
    }
  }

  private playPcm(pcm: Int16Array, rate = 24000) {
    if (this.muted || !pcm.length) return;
    if (!this.ensureCtx() || !this.playCtx) return;
    const ctx = this.playCtx;
    const buf = ctx.createBuffer(1, pcm.length, rate);
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

  private emit() {
    this.onChange?.();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let singleton: AraSpeechController | null = null;

export function araSpeech(): AraSpeechController {
  if (!singleton) singleton = new AraSpeechController();
  return singleton;
}

export function resetAraSpeechForTests(): void {
  singleton?.stop();
  singleton = new AraSpeechController();
  injectedTts = null;
}
