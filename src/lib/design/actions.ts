import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import {
  applyDesignOps,
  designFromUnknown,
  emptyHistory,
  isMajorDesign,
  parseDesignOps,
  safeSnapshot,
} from "./engine";
import { runDesignDirectorTurn } from "./openai";
import type { DesignActor, DesignDocument, DesignDirectorStatus, DesignHistoryState, DesignOp } from "./types";
import { DEFAULT_CHROME } from "./types";
import { DEFAULT_HOME_LAYOUT } from "@/lib/voice/layout";
import { DEFAULT_VISUAL_THEME } from "@/lib/visual/theme";

type SessionRow = {
  status: DesignDirectorStatus;
  paused: boolean;
  viewport: "mobile" | "desktop";
  selected_component: string | null;
  openai_previous_response_id: string | null;
  preview: DesignDocument | null;
  baseline: DesignDocument | null;
};

function openaiEnvKey(): string | undefined {
  const v = process.env.OPENAI_API_KEY?.trim();
  return v || undefined;
}

async function loadKey(userId: string): Promise<string | null> {
  const envKey = openaiEnvKey();
  if (envKey) return envKey;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ ciphertext: string; iv: string; tag: string }>`
    select ciphertext, iv, tag from owner_secrets where user_id = ${userId} and kind = ${"openai"} limit 1
  `;
  if (!rows[0]) return null;
  try {
    return decryptSecret(rows[0]);
  } catch {
    return null;
  }
}

async function loadDoc(userId: string): Promise<DesignDocument> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ payload: unknown }>`
    select payload from design_document where user_id = ${userId} limit 1
  `;
  if (!rows[0]) {
    return designFromUnknown({ visual: DEFAULT_VISUAL_THEME, layout: DEFAULT_HOME_LAYOUT, chrome: DEFAULT_CHROME });
  }
  return designFromUnknown(rows[0].payload);
}

async function saveDoc(userId: string, doc: DesignDocument) {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const payload = JSON.stringify(doc);
  await sql`
    insert into design_document (user_id, payload, updated_at)
    values (${userId}, ${payload}::jsonb, now())
    on conflict (user_id) do update set payload = excluded.payload, updated_at = now()
  `;
}

async function loadHistory(userId: string, baseline: DesignDocument | null): Promise<DesignHistoryState> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    at: Date | string;
    actor: DesignActor;
    ops: unknown;
    previous: unknown;
    resulting: unknown;
    spoken: string | null;
  }>`
    select id, at, actor, ops, previous, resulting, spoken
    from design_history
    where user_id = ${userId}
    order by at desc
    limit 24
  `;
  const past = rows.reverse().map((r) => ({
    id: r.id,
    at: typeof r.at === "string" ? r.at : r.at.toISOString(),
    actor: r.actor,
    ops: parseDesignOps(r.ops),
    previous: designFromUnknown(r.previous),
    resulting: designFromUnknown(r.resulting),
    spoken: r.spoken || "",
  }));
  return { past, future: [], baseline };
}

async function appendHistory(userId: string, history: DesignHistoryState) {
  const last = history.past[history.past.length - 1];
  if (!last) return;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await sql`
    insert into design_history (id, user_id, at, actor, ops, previous, resulting, spoken)
    values (
      ${last.id},
      ${userId},
      ${last.at}::timestamptz,
      ${last.actor},
      ${JSON.stringify(last.ops)}::jsonb,
      ${JSON.stringify(last.previous)}::jsonb,
      ${JSON.stringify(last.resulting)}::jsonb,
      ${last.spoken}
    )
    on conflict (id) do nothing
  `;
  try {
    await sql`
      delete from design_history
      where user_id = ${userId}
        and id not in (
          select id from (
            select id from design_history where user_id = ${userId} order by at desc limit 40
          ) keep
        )
    `;
  } catch {
    /* PGLite may reject the prune; history still records. */
  }
}

async function loadSession(userId: string): Promise<SessionRow> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{
    status: DesignDirectorStatus;
    paused: boolean;
    viewport: "mobile" | "desktop";
    selected_component: string | null;
    openai_previous_response_id: string | null;
    preview: unknown;
    baseline: unknown;
  }>`
    select status, paused, viewport, selected_component, openai_previous_response_id, preview, baseline
    from design_session where user_id = ${userId} limit 1
  `;
  if (rows[0]) {
    return {
      status: rows[0].status,
      paused: rows[0].paused,
      viewport: rows[0].viewport === "desktop" ? "desktop" : "mobile",
      selected_component: rows[0].selected_component,
      openai_previous_response_id: rows[0].openai_previous_response_id,
      preview: rows[0].preview ? designFromUnknown(rows[0].preview) : null,
      baseline: rows[0].baseline ? designFromUnknown(rows[0].baseline) : null,
    };
  }
  return {
    status: "disconnected",
    paused: false,
    viewport: "mobile",
    selected_component: null,
    openai_previous_response_id: null,
    preview: null,
    baseline: null,
  };
}

async function saveSession(userId: string, patch: Partial<SessionRow>) {
  const cur = await loadSession(userId);
  const next = { ...cur, ...patch };
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
    const previewJson = next.preview == null ? null : JSON.stringify(next.preview);
    const baselineJson = next.baseline == null ? null : JSON.stringify(next.baseline);
    await sql`
      insert into design_session (
        user_id, status, paused, viewport, selected_component, openai_previous_response_id, preview, baseline, updated_at
      ) values (
        ${userId},
        ${next.status},
        ${next.paused},
        ${next.viewport},
        ${next.selected_component},
        ${next.openai_previous_response_id},
        ${previewJson}::jsonb,
        ${baselineJson}::jsonb,
        now()
      )
      on conflict (user_id) do update set
        status = excluded.status,
        paused = excluded.paused,
        viewport = excluded.viewport,
        selected_component = excluded.selected_component,
        openai_previous_response_id = excluded.openai_previous_response_id,
        preview = excluded.preview,
        baseline = excluded.baseline,
        updated_at = now()
    `;
}

export const designDirectorStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const key = await loadKey(context.userId);
    const session = await loadSession(context.userId);
    let last4: string | null = null;
    if (!openaiEnvKey()) {
      try {
        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        const rows = await sql<{ last4: string | null }>`
          select last4 from owner_secrets where user_id = ${context.userId} and kind = ${"openai"} limit 1
        `;
        last4 = rows[0]?.last4 || null;
      } catch {
        last4 = null;
      }
    }
    const status: DesignDirectorStatus = !key
      ? "disconnected"
      : session.paused
        ? "paused"
        : session.status === "designing" || session.status === "waiting"
          ? session.status
          : "connected";
    return {
      ok: true as const,
      status,
      paused: session.paused,
      hasKey: Boolean(key),
      envKey: Boolean(openaiEnvKey()),
      last4,
    };
  });

export const saveOpenAiKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { key: string }) => data)
  .handler(async ({ data, context }) => {
    const key = (data.key || "").trim();
    if (!key || key.length < 20 || !key.startsWith("sk-")) {
      return { ok: false as const, reason: "That does not look like an OpenAI key. Nothing was saved." };
    }
    const enc = encryptSecret(key);
    const last4 = key.slice(-4);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into owner_secrets (user_id, kind, ciphertext, iv, tag, last4, updated_at)
      values (${context.userId}, ${"openai"}, ${enc.ciphertext}, ${enc.iv}, ${enc.tag}, ${last4}, now())
      on conflict (user_id, kind) do update set
        ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, last4 = excluded.last4, updated_at = now()
    `;
    await saveSession(context.userId, { status: "connected", paused: false });
    return { ok: true as const, last4 };
  });

export const clearOpenAiKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (openaiEnvKey()) return { ok: false as const, reason: "The server already has an OpenAI key. It cannot be cleared from Settings." };
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from owner_secrets where user_id = ${context.userId} and kind = ${"openai"}`;
    await saveSession(context.userId, { status: "disconnected" });
    return { ok: true as const };
  });

export const setDesignDirectorPausedFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { paused: boolean }) => data)
  .handler(async ({ data, context }) => {
    await saveSession(context.userId, { paused: data.paused, status: data.paused ? "paused" : "connected" });
    return { ok: true as const, paused: data.paused, status: (data.paused ? "paused" : "connected") as DesignDirectorStatus };
  });

export const loadDesignDocumentFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const doc = await loadDoc(context.userId);
    const session = await loadSession(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ user_id: string }>`
      select user_id from design_document where user_id = ${context.userId} limit 1
    `;
    return {
      ok: true as const,
      document: doc,
      exists: Boolean(rows[0]),
      preview: session.preview,
      paused: session.paused,
      status: session.status,
    };
  });

export const saveDesignDocumentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { document: DesignDocument }) => data)
  .handler(async ({ data, context }) => {
    const doc = designFromUnknown(data.document);
    await saveDoc(context.userId, doc);
    return { ok: true as const, document: doc };
  });

export const applyDesignOpsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    document: DesignDocument;
    operations: unknown;
    viewport?: "global" | "mobile" | "desktop";
    preview?: boolean;
    actor?: DesignActor;
    liveViewport?: "mobile" | "desktop";
  }) => data)
  .handler(async ({ data, context }) => {
    const session = await loadSession(context.userId);
    if (session.paused && data.actor === "CHATGPT_DESIGN_DIRECTOR") {
      return { ok: false as const, reason: "Design Director is paused. Suggestions only — nothing was applied." };
    }
    const doc = designFromUnknown(data.document);
    const ops = parseDesignOps(data.operations);
    if (!ops.length) return { ok: false as const, reason: "No valid design operations." };
    const history = await loadHistory(context.userId, session.baseline ? designFromUnknown(session.baseline) : doc);
    if (!history.baseline) history.baseline = doc;
    const preview = Boolean(data.preview) || isMajorDesign(ops);
    const applied = applyDesignOps(doc, history, {
      operations: ops,
      viewport: data.viewport,
      preview,
      actor: data.actor || "ARA",
    });
    if (!preview) {
      await saveDoc(context.userId, applied.doc);
      await appendHistory(context.userId, applied.history);
      await saveSession(context.userId, { preview: null, baseline: applied.history.baseline, status: "connected" });
    } else {
      await saveSession(context.userId, { preview: applied.doc, status: "waiting", baseline: applied.history.baseline });
    }
    const live = data.liveViewport || "mobile";
    return {
      ok: true as const,
      document: applied.doc,
      results: applied.results,
      spoken: applied.spoken,
      preview,
      snapshot: safeSnapshot(applied.doc, live),
    };
  });

export const designDirectorTurnFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    prompt: string;
    document: DesignDocument;
    viewport: "mobile" | "desktop";
    selectedComponent?: string | null;
  }) => data)
  .handler(async ({ data, context }): Promise<
    | { ok: false; reason: string; paused?: boolean }
    | { ok: true; spoken: string; document: DesignDocument; preview: boolean }
  > => {
    const prompt = (data.prompt || "").trim();
    if (prompt.length < 2) return { ok: false as const, reason: "Say what you want the design to do." };
    const session = await loadSession(context.userId);
    if (session.paused) {
      return { ok: false as const, paused: true, reason: "Design Director is paused. I can still talk, but Ara will not apply design changes." };
    }
    const key = await loadKey(context.userId);
    if (!key) return { ok: false as const, reason: "ChatGPT Design Director is disconnected. Add an OpenAI key in Settings." };

    await saveSession(context.userId, { status: "designing", viewport: data.viewport });
    const doc = designFromUnknown(data.document);
    const snapshot = safeSnapshot(doc, data.viewport, (data.selectedComponent as never) || null);
    const history = await loadHistory(context.userId, session.baseline ? designFromUnknown(session.baseline) : doc);
    if (!history.baseline) history.baseline = cloneOr(doc);
    let working = doc;
    let workingHistory = history;
    let preview = false;
    let lastSpoken = "";

    const turn = await runDesignDirectorTurn({
      apiKey: key,
      prompt,
      snapshot,
      document: doc,
      previousResponseId: session.openai_previous_response_id,
      execute: (name, args) => {
        if (name === "get_current_design") {
          return { output: { ok: true, design: safeSnapshot(working, data.viewport) }, ops: [], preview: false, spoken: "" };
        }
        const ops: DesignOp[] =
          name === "undo_last_design_change" ? [{ op: "undo_design_change" }]
            : name === "restore_session_baseline" ? [{ op: "restore_baseline" }]
              : parseDesignOps(args.operations);
        const wantPreview = args.preview === true || isMajorDesign(ops);
        const applied = applyDesignOps(working, workingHistory, {
          operations: ops,
          viewport: args.viewport === "mobile" || args.viewport === "desktop" || args.viewport === "global" ? args.viewport : "global",
          preview: wantPreview,
          actor: "CHATGPT_DESIGN_DIRECTOR",
        });
        working = applied.doc;
        workingHistory = applied.history;
        preview = preview || applied.preview || wantPreview;
        lastSpoken = applied.spoken;
        return {
          output: { ok: true, results: applied.results, spoken: applied.spoken, snapshot: safeSnapshot(working, data.viewport) },
          ops,
          preview: wantPreview,
          spoken: applied.spoken,
        };
      },
    });

    if (!turn.ok) {
      await saveSession(context.userId, { status: "connected" });
      return { ok: false as const, reason: turn.reason || "ChatGPT Design Director could not finish." };
    }

    if (preview) {
      await saveSession(context.userId, {
        status: "waiting",
        preview: working,
        baseline: workingHistory.baseline,
        openai_previous_response_id: turn.previousResponseId,
      });
    } else {
      await saveDoc(context.userId, working);
      await appendHistory(context.userId, workingHistory);
      await saveSession(context.userId, {
        status: "connected",
        preview: null,
        baseline: workingHistory.baseline,
        openai_previous_response_id: turn.previousResponseId,
      });
    }

    return {
      ok: true as const,
      spoken: turn.spoken || lastSpoken || "Design updated.",
      document: working,
      preview,
    };
  });

function cloneOr(doc: DesignDocument): DesignDocument {
  return designFromUnknown(doc);
}

export const keepDesignPreviewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { document: DesignDocument }) => data)
  .handler(async ({ data, context }) => {
    const doc = designFromUnknown(data.document);
    await saveDoc(context.userId, doc);
    await saveSession(context.userId, { preview: null, status: "connected" });
    return { ok: true as const, document: doc };
  });

export const discardDesignPreviewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const doc = await loadDoc(context.userId);
    await saveSession(context.userId, { preview: null, status: "connected" });
    return { ok: true as const, document: doc };
  });
