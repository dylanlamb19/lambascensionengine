/** Pure TTS request helpers. Safe to import from node:test (no server/auth aliases). */

export const TTS_TIMEOUT_MS = 12_000;
export const TTS_URL = "https://api.x.ai/v1/tts";
export const TTS_MAX_CHARS = 1800;
export const TTS_VOICE_ID = "ara";

export function ttsRequestBody(text: string): {
  text: string;
  voice_id: string;
  language: string;
  output_format: { codec: "pcm"; sample_rate: 24000 };
} {
  return {
    text,
    voice_id: TTS_VOICE_ID,
    language: "en",
    output_format: { codec: "pcm", sample_rate: 24000 },
  };
}
