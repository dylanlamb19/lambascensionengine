/**
 * xAI Ara TTS server function. The API key never leaves the handler.
 * Used to render known text in Ara's voice without a conversation model turn.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ARA_VOICE } from "./ara-context";
import { voiceFailure } from "./voice-failure";

const MAX_CHARS = 1800;
const TTS_URL = "https://api.x.ai/v1/tts";

export const speakAraFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { text: string; source?: string }) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) return voiceFailure("XAI_KEY_MISSING");
    const text = (data.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
    if (!text) return { ok: false as const, code: "PROVIDER_ERROR" as const, reason: "Nothing to read." };
    try {
      const res = await fetch(TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice_id: ARA_VOICE,
          language: "en",
          output_format: { codec: "pcm", sample_rate: 24000 },
        }),
      });
      if (!res.ok) return voiceFailure("PROVIDER_ERROR");
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        ok: true as const,
        pcm: buf.toString("base64"),
        rate: 24000,
        voice: "Ara",
        voice_id: ARA_VOICE,
        provider: "xAI",
        speech_source: data.source || "SCREEN_ANNOUNCEMENT",
      };
    } catch {
      return voiceFailure("PROVIDER_ERROR");
    }
  });
