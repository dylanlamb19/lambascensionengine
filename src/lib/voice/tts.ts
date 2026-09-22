/**
 * xAI Ara TTS server function. The API key never leaves the handler.
 * Used to render known text in Ara's voice without a conversation model turn.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ARA_VOICE } from "./ara-context";
import { TTS_MAX_CHARS, TTS_TIMEOUT_MS, TTS_URL, ttsRequestBody } from "./tts-request";
import { classifyTtsHttp, classifyTtsTransportError, voiceFailure } from "./voice-failure";

export { TTS_TIMEOUT_MS, ttsRequestBody } from "./tts-request";

export const speakAraFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { text: string; source?: string }) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) return voiceFailure("XAI_KEY_MISSING");
    const text = (data.text || "").replace(/\s+/g, " ").trim().slice(0, TTS_MAX_CHARS);
    if (!text) return voiceFailure("VOICE_BAD_RESPONSE");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TTS_TIMEOUT_MS);
    try {
      const res = await fetch(TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ttsRequestBody(text)),
        signal: ac.signal,
      });
      if (!res.ok) return voiceFailure(classifyTtsHttp(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2) return voiceFailure("VOICE_BAD_RESPONSE");
      return {
        ok: true as const,
        pcm: buf.toString("base64"),
        rate: 24000,
        voice: "Ara",
        voice_id: ARA_VOICE,
        provider: "xAI",
        speech_source: data.source || "SCREEN_ANNOUNCEMENT",
      };
    } catch (err) {
      return voiceFailure(classifyTtsTransportError(err));
    } finally {
      clearTimeout(timer);
    }
  });
