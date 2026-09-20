import { acceptAudioChunk, beginChunkGate, type ChunkGate } from "./lifecycle.ts";

/** xAI realtime PCM is 24 kHz mono s16. Phone Bluetooth media wants 44.1 kHz WAV. */
export const ARA_PCM_RATE = 24000;
export const ARA_WAV_RATE = 44100;
const MIN_PACKET_SAMPLES = Math.floor(ARA_PCM_RATE * 0.12);

export function resamplePcm(pcm: Int16Array, fromRate: number, toRate: number): Float32Array {
  const len = pcm.length;
  if (fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    const out = new Float32Array(Math.max(1, len));
    for (let i = 0; i < len; i++) out[i] = pcm[i] / 32768;
    return out;
  }
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.round(len / ratio));
  const out = new Float32Array(n);
  const last = Math.max(0, len - 1);
  for (let i = 0; i < n; i++) {
    const src = i * ratio;
    const i0 = Math.min(last, Math.floor(src));
    const i1 = Math.min(last, i0 + 1);
    const f = src - i0;
    const s0 = pcm[i0] / 32768;
    const s1 = pcm[i1] / 32768;
    out[i] = s0 + (s1 - s0) * f;
  }
  return out;
}

export function pcm16Resample(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return pcm;
  const f32 = resamplePcm(pcm, fromRate, toRate);
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Blob {
  const samples = pcm.length;
  const dataBytes = samples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < samples; i++, o += 2) view.setInt16(o, pcm[i], true);
  return new Blob([buf], { type: "audio/wav" });
}

function toPhoneWav(pcm24: Int16Array): Blob {
  return pcm16ToWav(pcm16Resample(pcm24, ARA_PCM_RATE, ARA_WAV_RATE), ARA_WAV_RATE);
}

function cuePcm24(): Int16Array {
  const n = Math.floor(ARA_PCM_RATE * 0.22);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(i / 400, 1) * Math.min((n - i) / 700, 1);
    const a = Math.sin((2 * Math.PI * 880 * i) / ARA_PCM_RATE);
    const b = Math.sin((2 * Math.PI * 1320 * i) / ARA_PCM_RATE);
    pcm[i] = Math.round((a * 0.62 + b * 0.28) * env * 0.55 * 32767);
  }
  return pcm;
}

function holdPcm24(): Int16Array {
  const n = Math.floor(ARA_PCM_RATE * 0.22);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = (i & 1) === 0 ? 12 : -12;
  return pcm;
}

const BT_MIC = /bluetooth|headset|headphone|earbud|airpod|\bbuds\b|hands[- ]?free|\bsco\b|\bhfp\b|communications/i;

export function isBluetoothAudioLabel(label: string): boolean {
  return BT_MIC.test(label || "");
}

export async function phoneMicConstraints(): Promise<MediaTrackConstraints> {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
  };
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return base;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
    const phone = mics.find((d) => d.label && !BT_MIC.test(d.label) && !/^default/i.test(d.label))
      || mics.find((d) => d.label && !BT_MIC.test(d.label));
    if (phone?.deviceId) return { ...base, deviceId: { ideal: phone.deviceId } };
  } catch {
    /* labels often empty until permission */
  }
  return base;
}

function primeAudioSession() {
  try {
    const ios = typeof navigator !== "undefined" && /iPad|iPhone|iPod/i.test(navigator.userAgent);
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = ios ? "play-and-record" : "playback";
  } catch {
    /* ignore */
  }
}

function attachHost(el: HTMLAudioElement) {
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.setAttribute("data-ara-voice-out", "1");
  el.preload = "auto";
  el.muted = false;
  el.defaultMuted = false;
  el.volume = 1;
  el.autoplay = true;
  (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  el.controls = false;
  el.removeAttribute("controls");
  el.className = "";
  el.style.cssText = "display:none;width:0;height:0;position:absolute;pointer-events:none;";
}

function makePlayer(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const el = new Audio();
  attachHost(el);
  return el;
}

let hostEl: HTMLAudioElement | null = null;
let hostUrl: string | null = null;
let cued = false;
let holdOpen = false;
let hostMode: "idle" | "cue" | "hold" | "speech" = "idle";
let replayHandler: (() => boolean) | null = null;
let endedHandler: (() => void) | null = null;
let holdBlob: Blob | null = null;

function ensureHost(): HTMLAudioElement | null {
  if (hostEl) {
    attachHost(hostEl);
    return hostEl;
  }
  if (typeof document !== "undefined") {
    const leftover = document.getElementById("la-ara-voice-out");
    if (leftover) leftover.remove();
  }
  const el = makePlayer();
  if (el) el.id = "la-ara-voice-out";
  hostEl = el;
  return el;
}

function revokeHostUrl() {
  if (hostUrl) {
    URL.revokeObjectURL(hostUrl);
    hostUrl = null;
  }
}

function isAbort(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError");
}

function bindEnded(el: HTMLAudioElement) {
  el.onended = () => {
    el.setAttribute("data-ara-playing", "0");
    endedHandler?.();
  };
}

function playBlob(el: HTMLAudioElement, blob: Blob, mode: typeof hostMode): Promise<void> {
  revokeHostUrl();
  const url = URL.createObjectURL(blob);
  hostUrl = url;
  try { el.srcObject = null; } catch { /* ignore */ }
  el.autoplay = true;
  el.muted = false;
  el.defaultMuted = false;
  el.volume = 1;
  el.src = url;
  hostMode = mode;
  el.controls = false;
  el.removeAttribute("controls");
  el.setAttribute("data-ara-src", mode);
  bindEnded(el);
  return el.play().then(() => {
    el.setAttribute("data-ara-playing", "1");
    el.removeAttribute("data-ara-err");
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.name : "play";
    if (!isAbort(err)) el.setAttribute("data-ara-err", msg);
    throw err;
  });
}

function quietHold(): Blob {
  if (!holdBlob) holdBlob = toPhoneWav(holdPcm24());
  return holdBlob;
}

function startHold(el: HTMLAudioElement) {
  if (!holdOpen) return;
  void playBlob(el, quietHold(), "hold").catch((err) => {
    if (isAbort(err)) return;
    holdOpen = false;
  });
}

/**
 * Must run inside a tap. Unlocks Web Audio so Ara can speak after Conversation starts.
 * Does not mount an HTML audio player — recovered Ara uses AudioContext, not a visible <audio>.
 */
export function unlockAraOutput(_opts?: { cue?: boolean }): boolean {
  primeAudioSession();
  if (typeof AudioContext === "undefined" && typeof window === "undefined") return false;
  try {
    const w = typeof window !== "undefined" ? window : null;
    const Ctx = w && ((w as unknown as { AudioContext?: typeof AudioContext }).AudioContext
      || (w as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return true;
    if (!unlockCtx) unlockCtx = new Ctx();
    if (unlockCtx.state === "suspended") void unlockCtx.resume();
    return true;
  } catch {
    return false;
  }
}

let unlockCtx: AudioContext | null = null;

/** Pause, revoke blobs, and remove any leftover Ara <audio> from the document. */
export function teardownAraOutput(): void {
  holdOpen = false;
  cued = false;
  hostMode = "idle";
  revokeHostUrl();
  const fromDoc = typeof document !== "undefined"
    ? document.getElementById("la-ara-voice-out") as HTMLAudioElement | null
    : null;
  const el = hostEl || fromDoc;
  if (el) {
    try { el.pause(); } catch { /* ignore */ }
    el.onended = null;
    el.controls = false;
    el.removeAttribute("controls");
    try { el.removeAttribute("src"); el.src = ""; el.load(); } catch { /* ignore */ }
    try { el.remove(); } catch { /* ignore */ }
  }
  hostEl = null;
}

export function replayAraOutput(): boolean {
  if (replayHandler) return replayHandler();
  return false;
}

export function araOutputContext(): AudioContext | null {
  return null;
}

export function isSharedAraContext(_ctx: AudioContext | null | undefined): boolean {
  return false;
}

export class AraAudioPipeline {
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private queue: Int16Array[] = [];
  private utterance: Int16Array[] = [];
  private lastClip: Int16Array | null = null;
  private playingSpeech = false;
  private gate: ChunkGate = beginChunkGate("");
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private drainNotified = false;
  playbackGeneration = 0;
  onDrained: (() => void) | null = null;
  onPlayFailed: (() => void) | null = null;
  muted = false;
  dropped = 0;
  playFailed = false;

  constructor() {
    replayHandler = () => this.replay();
    endedHandler = () => this.onHostEnded();
  }

  get queued(): number {
    const n = this.queue.length + (this.playingSpeech ? 1 : 0) + (this.pendingSamples ? 1 : 0);
    if (n > 0) return n;
    if (this.gate.activeResponseId && !this.drainNotified) return 1;
    return 0;
  }

  get activeResponseId(): string | null {
    return this.gate.activeResponseId || null;
  }

  unlock(opts?: { cue?: boolean }) {
    unlockAraOutput(opts);
  }

  begin(responseId: string) {
    replayHandler = () => this.replay();
    endedHandler = () => this.onHostEnded();
    this.playbackGeneration += 1;
    this.clearDrainTimer();
    this.drainNotified = false;
    this.playingSpeech = false;
    this.queue = [];
    this.utterance = [];
    this.gate = beginChunkGate(responseId);
    this.pending = [];
    this.pendingSamples = 0;
    this.playFailed = false;
    holdOpen = true;
  }

  enqueue(responseId: string, pcm: Int16Array, chunkIndex?: number): "ok" | "stale" | "dup" | "no_active" {
    const hit = acceptAudioChunk(this.gate, responseId, chunkIndex);
    this.gate = hit.gate;
    if (!hit.ok) {
      this.dropped += 1;
      return hit.reason || "stale";
    }
    if (this.muted) return "ok";
    this.buffer(pcm);
    return "ok";
  }

  stop() {
    this.playbackGeneration += 1;
    this.clearDrainTimer();
    this.drainNotified = true;
    this.playingSpeech = false;
    if (this.utterance.length) this.lastClip = concatPcm(this.utterance);
    this.queue = [];
    this.utterance = [];
    this.gate = beginChunkGate("");
    this.pending = [];
    this.pendingSamples = 0;
    holdOpen = false;
    teardownAraOutput();
  }

  flush() {
    this.flushPending(true);
    this.kick();
  }

  replay(): boolean {
    const pcm = this.utterance.length
      ? concatPcm(this.utterance)
      : this.lastClip;
    if (!pcm?.length) {
      unlockAraOutput({ cue: true });
      return true;
    }
    holdOpen = true;
    this.playFailed = false;
    return this.playSpeech(pcm, true);
  }

  private buffer(pcm: Int16Array) {
    if (!pcm.length) return;
    this.utterance.push(pcm);
    this.pending.push(pcm);
    this.pendingSamples += pcm.length;
    hostEl?.setAttribute("data-ara-u", String(this.utterance.length));
    if (this.pendingSamples >= MIN_PACKET_SAMPLES) this.flushPending(false);
  }

  private flushPending(force: boolean) {
    if (!this.pendingSamples) return;
    if (!force && this.pendingSamples < MIN_PACKET_SAMPLES) return;
    this.queue.push(concatPcm(this.takePending()));
    if (this.utterance.length) this.lastClip = concatPcm(this.utterance);
    this.armDrain(this.playbackGeneration);
    this.kick();
  }

  private takePending(): Int16Array[] {
    const parts = this.pending;
    this.pending = [];
    this.pendingSamples = 0;
    return parts;
  }

  private kick() {
    if (this.muted || this.playingSpeech) return;
    if (!this.queue.length) {
      if (!this.pendingSamples && hostMode === "speech") this.notifyDrained();
      return;
    }
    if (typeof Audio === "undefined") return;
    const host = ensureHost();
    if (!host) {
      this.playFailed = true;
      this.onPlayFailed?.();
      return;
    }
    if (!host.paused && hostMode === "hold") {
      const pcm = this.queue.shift();
      if (!pcm) return;
      this.playSpeech(pcm, false);
      return;
    }
    if (!host.paused && hostMode !== "idle") return;
    const pcm = this.queue.shift();
    if (!pcm) return;
    this.playSpeech(pcm, false);
  }

  private playSpeech(pcm: Int16Array, fromReplay: boolean): boolean {
    const host = ensureHost();
    if (!host || !pcm.length) return false;
    const gen = this.playbackGeneration;
    this.playingSpeech = true;
    this.drainNotified = false;
    void playBlob(host, toPhoneWav(pcm), "speech").then(() => {
      if (gen !== this.playbackGeneration) return;
      this.playFailed = false;
    }).catch((err: unknown) => {
      if (gen !== this.playbackGeneration) return;
      this.playFailed = true;
      this.playingSpeech = false;
      if (!fromReplay && !isAbort(err)) this.queue.unshift(pcm);
      if (!isAbort(err)) this.onPlayFailed?.();
      const el = ensureHost();
      if (el && holdOpen && hostMode !== "speech") startHold(el);
    });
    this.armDrain(gen);
    return true;
  }

  private onHostEnded() {
    const host = ensureHost();
    this.playingSpeech = false;
    if (this.muted) return;
    if (this.queue.length || this.pendingSamples >= MIN_PACKET_SAMPLES) {
      this.flushPending(false);
      this.kick();
      return;
    }
    if (this.pendingSamples) {
      this.flushPending(true);
      this.kick();
      return;
    }
    if (hostMode === "speech") {
      this.notifyDrained();
      return;
    }
    if (holdOpen && host) startHold(host);
  }

  private armDrain(gen: number) {
    this.clearDrainTimer();
    const samples = this.queue.reduce((n, p) => n + p.length, this.pendingSamples);
    const wait = Math.max(600, (samples / ARA_PCM_RATE) * 1000 + 1200);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (gen !== this.playbackGeneration) return;
      this.flushPending(true);
      if (this.playingSpeech || this.queue.length) {
        this.armDrain(gen);
        return;
      }
      this.notifyDrained();
    }, wait);
  }

  private notifyDrained() {
    if (this.drainNotified) return;
    if (this.playingSpeech || this.queue.length || this.pendingSamples) return;
    this.drainNotified = true;
    this.onDrained?.();
  }

  private clearDrainTimer() {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  async close() {
    if (replayHandler) replayHandler = null;
    if (endedHandler) endedHandler = null;
    this.stop();
  }

  setMuted(v: boolean) {
    this.muted = v;
    const host = hostEl || (typeof document === "undefined" ? null : document.getElementById("la-ara-voice-out") as HTMLAudioElement | null);
    if (host) {
      host.muted = v;
      host.volume = v ? 0 : 1;
      if (v) {
        try { host.pause(); } catch { /* ignore */ }
        this.playingSpeech = false;
        host.setAttribute("data-ara-playing", "0");
      }
    }
  }
}

function concatPcm(parts: Int16Array[]): Int16Array {
  if (parts.length === 1) return parts[0];
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
