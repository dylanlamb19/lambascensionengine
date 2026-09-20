export type VoiceFailureCode =
  | "XAI_KEY_MISSING"
  | "SESSION_CREATE_FAILED"
  | "WEBSOCKET_FAILED"
  | "MIC_BLOCKED"
  | "AUDIO_OUTPUT_BLOCKED"
  | "PROVIDER_ERROR"
  | "VOICE_AUTH_FAILED"
  | "VOICE_RATE_LIMITED"
  | "VOICE_UPSTREAM_4XX"
  | "VOICE_UPSTREAM_5XX"
  | "VOICE_TIMEOUT"
  | "VOICE_BAD_RESPONSE"
  | "VOICE_AUDIO_DECODE_FAILED"
  | "VOICE_PLAYBACK_FAILED";

const LABEL: Record<VoiceFailureCode, string> = {
  XAI_KEY_MISSING: "Ara's voice isn't available (XAI_KEY_MISSING).",
  SESSION_CREATE_FAILED: "Ara's voice isn't available (SESSION_CREATE_FAILED).",
  WEBSOCKET_FAILED: "Ara's voice isn't available (WEBSOCKET_FAILED).",
  MIC_BLOCKED: "Microphone permission is needed to talk to Ara. (MIC_BLOCKED)",
  AUDIO_OUTPUT_BLOCKED: "Ara's voice isn't available (AUDIO_OUTPUT_BLOCKED).",
  PROVIDER_ERROR: "Ara's voice isn't available (PROVIDER_ERROR).",
  VOICE_AUTH_FAILED: "Ara's voice isn't available (VOICE_AUTH_FAILED).",
  VOICE_RATE_LIMITED: "Ara's voice isn't available (VOICE_RATE_LIMITED).",
  VOICE_UPSTREAM_4XX: "Ara's voice isn't available (VOICE_UPSTREAM_4XX).",
  VOICE_UPSTREAM_5XX: "Ara's voice isn't available (VOICE_UPSTREAM_5XX).",
  VOICE_TIMEOUT: "Ara's voice isn't available (VOICE_TIMEOUT).",
  VOICE_BAD_RESPONSE: "Ara's voice isn't available (VOICE_BAD_RESPONSE).",
  VOICE_AUDIO_DECODE_FAILED: "Ara's voice isn't available (VOICE_AUDIO_DECODE_FAILED).",
  VOICE_PLAYBACK_FAILED: "Ara's voice isn't available (VOICE_PLAYBACK_FAILED).",
};

export function voiceFailure(code: VoiceFailureCode): { ok: false; code: VoiceFailureCode; reason: string } {
  return { ok: false as const, code, reason: LABEL[code] };
}

export function voiceFailureReason(code: VoiceFailureCode): string {
  return LABEL[code];
}

/** Map an xAI TTS HTTP status. Never include response bodies — they can leak request context. */
export function classifyTtsHttp(status: number): VoiceFailureCode {
  if (status === 401 || status === 403) return "VOICE_AUTH_FAILED";
  if (status === 429) return "VOICE_RATE_LIMITED";
  if (status >= 500) return "VOICE_UPSTREAM_5XX";
  if (status >= 400) return "VOICE_UPSTREAM_4XX";
  return "PROVIDER_ERROR";
}

export function classifyTtsTransportError(err: unknown): VoiceFailureCode {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  const msg = err instanceof Error ? err.message : String(err || "");
  if (name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(msg)) return "VOICE_TIMEOUT";
  return "PROVIDER_ERROR";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? v as Record<string, unknown> : null;
}

/** Pull a provider error string without logging Authorization or raw frames. */
export function realtimeErrorText(ev: Record<string, unknown>): string {
  const err = asRecord(ev.error) || asRecord(ev.data);
  const bits: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) bits.push(v.trim());
  };
  if (typeof ev.error === "string") push(ev.error);
  if (err) {
    push(err.code);
    push(err.message);
    push(err.type);
    if (typeof err.error === "string") push(err.error);
  }
  push(ev.code);
  push(ev.message);
  return bits.join(" ");
}
