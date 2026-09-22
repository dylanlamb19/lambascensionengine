/**
 * Server-only Ara / Grok Voice session minting.
 * XAI_API_KEY never leaves the handler — the client only receives an ephemeral token.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { araClientSecretsMintBodies, publicAraSessionPayload } from "./ara-token";
import { classifyMintHttp, voiceFailure } from "./voice-failure";

const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";

async function postClientSecrets(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export const createAraSessionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) return voiceFailure("XAI_KEY_MISSING");
    try {
      const bodies = araClientSecretsMintBodies();
      let res = await postClientSecrets(apiKey, bodies[0]!);
      // xAI docs disagree on whether `session` is allowed. Retry the other shape only on 400.
      if (res.status === 400 && bodies[1]) {
        res = await postClientSecrets(apiKey, bodies[1]);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return voiceFailure(classifyMintHttp(res.status, text));
      }
      const body = await res.json();
      const pub = publicAraSessionPayload(body, apiKey);
      if (!pub.ok) return voiceFailure("SESSION_CREATE_FAILED");
      try {
        const { logActivity } = await import("@/lib/prospects/repo.server");
        await logActivity(context.userId, "ara_session", "Ara voice session started", undefined, "VOICE");
      } catch {
        /* audit must not block talking to Ara */
      }
      return pub;
    } catch {
      return voiceFailure("SESSION_CREATE_FAILED");
    }
  });

export const logVoiceAuditFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { tool: string; prospectUid?: string | null; confirmation?: string | null; result: string }) => data)
  .handler(async ({ data, context }) => {
    try {
      const { logActivity } = await import("@/lib/prospects/repo.server");
      const confirm = data.confirmation ? ` confirm=${data.confirmation}` : "";
      await logActivity(
        context.userId,
        `voice:${data.tool}`,
        `${data.result}${confirm}`,
        data.prospectUid || undefined,
        "VOICE",
      );
    } catch {
      /* keep the desk usable if the log write fails */
    }
    return { ok: true as const, audioStored: false as const };
  });
