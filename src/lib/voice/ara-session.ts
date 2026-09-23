/**
 * Server-only Ara / Grok Voice session minting.
 * XAI_API_KEY never leaves the handler — the client only receives an ephemeral token.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { mintEphemeralClientSecret, publicPayloadOrFail } from "./mint";
import { voiceFailure, type VoiceFailureCode } from "./voice-failure";

async function recordVoiceHeartbeat(ok: boolean, code: string, detail: string): Promise<void> {
  try {
    const { touchHeartbeat } = await import("@/lib/sentinel/sql.server");
    await touchHeartbeat("ara_voice", ok, code, detail);
  } catch {
    /* health write must not block talking to Ara */
  }
}

export const createAraSessionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) {
      await recordVoiceHeartbeat(false, "XAI_KEY_MISSING", "key absent");
      return voiceFailure("XAI_KEY_MISSING");
    }
    const minted = await mintEphemeralClientSecret(apiKey);
    if (!minted.ok) {
      await recordVoiceHeartbeat(false, minted.code, minted.status ? `http ${minted.status}` : "transport");
      return voiceFailure(minted.code);
    }
    const pub = publicPayloadOrFail(minted.raw, apiKey);
    if (!pub.ok) {
      await recordVoiceHeartbeat(false, pub.code, "bad token shape");
      return voiceFailure(pub.code);
    }
    await recordVoiceHeartbeat(true, "SENTINEL_OK", "ephemeral token minted");
    try {
      const { logActivity } = await import("@/lib/prospects/repo.server");
      await logActivity(context.userId, "ara_session", "Ara voice session started", undefined, "VOICE");
    } catch {
      /* audit must not block talking to Ara */
    }
    return pub;
  });

export const loadAraConversationFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { loadAraConversation } = await import("./ara-store.server");
    const { scopedConversationUser } = await import("./ara-memory");
    const userId = scopedConversationUser(context.userId);
    if (!userId) return { ok: false as const, reason: "Not signed in." };
    const log = await loadAraConversation(userId);
    try {
      const { logActivity } = await import("@/lib/prospects/repo.server");
      const turns = log.threads.reduce((n, t) => n + t.turns.length, 0);
      await logActivity(userId, "ARA_HISTORY_LOADED", `${turns} turns`, undefined, "VOICE");
    } catch {
      /* audit must not block the desk */
    }
    return { ok: true as const, log };
  });

export const saveAraConversationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { log: unknown; requestedUserId?: string }) => data)
  .handler(async ({ data, context }) => {
    const { scopedConversationUser, sanitizeAraLog } = await import("./ara-memory");
    const userId = scopedConversationUser(context.userId, data.requestedUserId);
    if (!userId) return { ok: false as const, reason: "That conversation belongs to another owner." };
    const { saveAraConversation } = await import("./ara-store.server");
    const saved = await saveAraConversation(userId, sanitizeAraLog(data.log));
    return saved ? { ok: true as const } : { ok: false as const, reason: "Could not save the conversation." };
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

export type { VoiceFailureCode };
