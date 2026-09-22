import { ARA_MODEL, ARA_UNAVAILABLE, ARA_VOICE, ARA_WS_URL } from "./ara-context.ts";

/** xAI ephemeral-token docs: client_secrets does not support a `session` field. */
export function araClientSecretsMintBodies(): ReadonlyArray<Record<string, unknown>> {
  return [
    { expires_after: { seconds: 300 } },
    { expires_after: { seconds: 300 }, session: { model: ARA_MODEL } },
  ];
}

export function extractClientSecret(raw: unknown): { value: string; expires_at?: number } {
  const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!rec) return { value: "" };
  const nested = rec.client_secret && typeof rec.client_secret === "object"
    ? rec.client_secret as Record<string, unknown>
    : null;
  const candidates: unknown[] = [
    rec.value,
    rec.secret,
    rec.token,
    typeof rec.client_secret === "string" ? rec.client_secret : null,
    nested?.value,
  ];
  let value = "";
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      value = c.trim();
      break;
    }
  }
  const exp = rec.expires_at ?? nested?.expires_at ?? rec.expiresAt;
  let expires_at: number | undefined;
  if (typeof exp === "number" && Number.isFinite(exp)) expires_at = exp;
  else if (typeof exp === "string" && Number.isFinite(Number(exp))) expires_at = Number(exp);
  return { value, expires_at };
}

export function publicAraSessionPayload(
  raw: unknown,
  apiKey: string | undefined,
): { ok: true; token: string; expiresAt: number; model: string; voice: string; wsUrl: string } | { ok: false; reason: string } {
  const extracted = extractClientSecret(raw);
  const token = extracted.value;
  if (!token) return { ok: false, reason: ARA_UNAVAILABLE };
  if (apiKey && (token === apiKey || token.includes(apiKey))) {
    return { ok: false, reason: ARA_UNAVAILABLE };
  }
  const payload = {
    ok: true as const,
    token,
    expiresAt: extracted.expires_at || Math.floor(Date.now() / 1000) + 300,
    model: ARA_MODEL,
    voice: ARA_VOICE,
    wsUrl: ARA_WS_URL,
  };
  if (apiKey && JSON.stringify(payload).includes(apiKey)) {
    return { ok: false, reason: ARA_UNAVAILABLE };
  }
  return payload;
}
