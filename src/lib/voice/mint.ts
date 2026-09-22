import { ARA_MODEL } from "./ara-context.ts";
import { publicAraSessionPayload } from "./ara-token.ts";
import {
  classifyMintHttp,
  classifyTtsTransportError,
  type VoiceFailureCode,
} from "./voice-failure.ts";

export const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";
const MINT_TIMEOUT_MS = 12_000;

/** Session-bound body first: a bare expires_after call has 403'd as spending-limit while the session body succeeded. */
export function araClientSecretsMintBodies(): ReadonlyArray<Record<string, unknown>> {
  return [
    { expires_after: { seconds: 300 }, session: { model: ARA_MODEL } },
    { expires_after: { seconds: 300 } },
  ];
}

export function shouldRetryMint(status: number): boolean {
  if (status === 401 || status === 429) return false;
  return status >= 400;
}

export function classifyMintTransport(err: unknown): VoiceFailureCode {
  const mapped = classifyTtsTransportError(err);
  if (mapped === "VOICE_TIMEOUT") return "ARA_VOICE_NETWORK_FAILED";
  return "ARA_VOICE_NETWORK_FAILED";
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;

export async function mintEphemeralClientSecret(
  apiKey: string,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<{ ok: true; raw: unknown } | { ok: false; code: VoiceFailureCode; status?: number }> {
  const bodies = araClientSecretsMintBodies();
  let lastStatus = 0;
  let lastText = "";
  for (let i = 0; i < bodies.length; i++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), MINT_TIMEOUT_MS);
      const res = await fetchImpl(CLIENT_SECRETS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodies[i]),
        signal: ac.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, raw: await res.json() };
      }
      lastText = await res.text().catch(() => "");
      if (i + 1 < bodies.length && shouldRetryMint(res.status)) continue;
      return { ok: false, code: classifyMintHttp(res.status, lastText), status: res.status };
    } catch (err) {
      if (i + 1 < bodies.length) continue;
      return { ok: false, code: classifyMintTransport(err) };
    }
  }
  return { ok: false, code: classifyMintHttp(lastStatus, lastText), status: lastStatus };
}

export function publicPayloadOrFail(
  raw: unknown,
  apiKey: string,
): { ok: true; token: string; expiresAt: number; model: string; voice: string; wsUrl: string } | { ok: false; code: VoiceFailureCode } {
  const pub = publicAraSessionPayload(raw, apiKey);
  if (!pub.ok) return { ok: false, code: "ARA_VOICE_SESSION_CREATE_FAILED" };
  return pub;
}
