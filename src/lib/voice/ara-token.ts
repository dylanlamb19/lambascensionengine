import { ARA_MODEL, ARA_UNAVAILABLE, ARA_VOICE, ARA_WS_URL } from "./ara-context.ts";

export function publicAraSessionPayload(
  raw: { value?: string; expires_at?: number },
  apiKey: string | undefined,
): { ok: true; token: string; expiresAt: number; model: string; voice: string; wsUrl: string } | { ok: false; reason: string } {
  const token = (raw.value || "").trim();
  if (!token) return { ok: false, reason: ARA_UNAVAILABLE };
  if (apiKey && (token === apiKey || token.includes(apiKey))) {
    return { ok: false, reason: ARA_UNAVAILABLE };
  }
  const payload = {
    ok: true as const,
    token,
    expiresAt: Number(raw.expires_at) || Math.floor(Date.now() / 1000) + 300,
    model: ARA_MODEL,
    voice: ARA_VOICE,
    wsUrl: ARA_WS_URL,
  };
  if (apiKey && JSON.stringify(payload).includes(apiKey)) {
    return { ok: false, reason: ARA_UNAVAILABLE };
  }
  return payload;
}
