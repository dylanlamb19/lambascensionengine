export type VoiceFailureCode =
  | "XAI_KEY_MISSING"
  | "SESSION_CREATE_FAILED"
  | "WEBSOCKET_FAILED"
  | "MIC_BLOCKED"
  | "AUDIO_OUTPUT_BLOCKED"
  | "PROVIDER_ERROR";

const LABEL: Record<VoiceFailureCode, string> = {
  XAI_KEY_MISSING: "Ara's voice isn't available (XAI_KEY_MISSING).",
  SESSION_CREATE_FAILED: "Ara's voice isn't available (SESSION_CREATE_FAILED).",
  WEBSOCKET_FAILED: "Ara's voice isn't available (WEBSOCKET_FAILED).",
  MIC_BLOCKED: "Microphone permission is needed to talk to Ara. (MIC_BLOCKED)",
  AUDIO_OUTPUT_BLOCKED: "Ara's voice isn't available (AUDIO_OUTPUT_BLOCKED).",
  PROVIDER_ERROR: "Ara's voice isn't available (PROVIDER_ERROR).",
};

export function voiceFailure(code: VoiceFailureCode): { ok: false; code: VoiceFailureCode; reason: string } {
  return { ok: false as const, code, reason: LABEL[code] };
}

export function voiceFailureReason(code: VoiceFailureCode): string {
  return LABEL[code];
}
