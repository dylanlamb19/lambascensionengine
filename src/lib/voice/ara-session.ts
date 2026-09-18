/**
 * Server-only Ara / Grok Voice session minting.
 * XAI_API_KEY never leaves the handler — the client only receives an ephemeral token.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ARA_UNAVAILABLE } from "./ara-context";
import { publicAraSessionPayload } from "./ara-token";

export const createAraSessionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) return { ok: false as const, reason: ARA_UNAVAILABLE };
    try {
      const res = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: { seconds: 300 },
          session: { model: "grok-voice-latest" },
        }),
      });
      if (!res.ok) return { ok: false as const, reason: ARA_UNAVAILABLE };
      const body = (await res.json()) as { value?: string; expires_at?: number };
      const pub = publicAraSessionPayload(body, apiKey);
      if (pub.ok) {
        try {
          const { logActivity } = await import("@/lib/prospects/repo.server");
          await logActivity(context.userId, "ara_session", "Ara voice session started", undefined, "VOICE");
        } catch {
          /* audit must not block talking to Ara */
        }
      }
      return pub;
    } catch {
      return { ok: false as const, reason: ARA_UNAVAILABLE };
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
