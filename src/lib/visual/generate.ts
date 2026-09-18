import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { VisualAsset } from "./theme";
import { asImageKind, type GalleryItem, type ImageKind } from "./gallery";
import { asIntendedUse, evaluateImageSafety, type IntendedUse, type SafetyStatus } from "./safety";
import {
  asQuality,
  composeModelPrompt,
  generateImage,
  isImagineConfigured,
  jpegSize,
  promptHash,
  type ImageQuality,
} from "./provider";
import {
  beginInflight,
  endInflight,
  findRecentDuplicate,
  imagesUsedToday,
  loadImageCap,
  noteLastAsset,
  saveImageCap,
  tryReserveImageSlot,
} from "./usage";

function newId(): string {
  return `va_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function saveBytes(userId: string, id: string, bytes: Buffer, ext: string): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), "data", "visual-assets", userId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.${ext}`);
  await writeFile(path, bytes);
  return path;
}

export async function readOwnerAsset(userId: string, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const { getSql } = await import("@/lib/db");
  const { readFile } = await import("node:fs/promises");
  const sql = await getSql();
  const rows = await sql<{ path: string; mime: string; data_b64?: string | null }>`
    select path, mime, data_b64 from visual_assets where user_id = ${userId} and id = ${id} limit 1
  `;
  if (!rows[0]) return null;
  try {
    const bytes = await readFile(rows[0].path);
    return { bytes, mime: rows[0].mime || "image/jpeg" };
  } catch {
    if (rows[0].data_b64) {
      try {
        return { bytes: Buffer.from(rows[0].data_b64, "base64"), mime: rows[0].mime || "image/jpeg" };
      } catch {
        return null;
      }
    }
    return null;
  }
}

type AssetRow = {
  id: string;
  nsfw: boolean;
  label: string;
  mime: string;
  source: string;
  license?: string | null;
  prompt?: string | null;
  path: string;
  kind?: string;
  favorite?: boolean;
  saved?: boolean;
  created_at?: Date | string | null;
  provider?: string | null;
  model?: string | null;
  intended_use?: string | null;
  width?: number | null;
  height?: number | null;
  safety_status?: string | null;
  aspect_ratio?: string | null;
};

function asGalleryItem(row: AssetRow): GalleryItem {
  return {
    id: row.id,
    url: `/api/visual-assets/${row.id}`,
    prompt: row.prompt || "",
    label: row.label,
    kind: asImageKind(row.kind),
    nsfw: Boolean(row.nsfw),
    favorite: Boolean(row.favorite),
    saved: row.saved !== false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    source: row.source === "upload" ? "upload" : "generated",
    provider: row.provider || undefined,
    model: row.model || undefined,
    intendedUse: row.intended_use ? asIntendedUse(row.intended_use) : undefined,
    width: row.width ?? null,
    height: row.height ?? null,
    safetyStatus: (row.safety_status as SafetyStatus) || undefined,
    aspectRatio: row.aspect_ratio || undefined,
  };
}

function asVisualAsset(item: GalleryItem): VisualAsset {
  return {
    id: item.id,
    label: item.label,
    url: item.url,
    keys: ["upload", "generated", "my picture"],
    overlay: 0.55,
    nsfw: item.nsfw,
    source: item.source === "generated" ? "generated" : "upload",
    license: item.source === "generated" ? "xAI Imagine, owner-generated" : "Owner upload",
  };
}

async function loadItem(userId: string, id: string): Promise<GalleryItem | null> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<AssetRow>`
    select id, nsfw, label, mime, source, license, prompt, path, favorite, kind, saved, created_at,
           provider, model, intended_use, width, height, safety_status, aspect_ratio
    from visual_assets where user_id = ${userId} and id = ${id} limit 1
  `;
  return rows[0] ? asGalleryItem(rows[0]) : null;
}

async function insertAsset(userId: string, row: {
  id: string;
  nsfw: boolean;
  label: string;
  mime: string;
  source: string;
  license?: string;
  prompt?: string;
  path: string;
  kind?: ImageKind;
  favorite?: boolean;
  saved?: boolean;
  provider?: string;
  model?: string;
  intendedUse?: IntendedUse;
  width?: number | null;
  height?: number | null;
  safetyStatus?: SafetyStatus;
  aspectRatio?: string;
  promptHash?: string;
  dataB64?: string;
}): Promise<GalleryItem> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const kind = row.kind || "image";
  const favorite = Boolean(row.favorite);
  const saved = row.saved !== false;
  const created = new Date();
  await sql`
    insert into visual_assets (
      id, user_id, nsfw, label, mime, source, license, prompt, path, favorite, kind, saved,
      provider, model, intended_use, width, height, safety_status, aspect_ratio, prompt_hash, data_b64
    )
    values (
      ${row.id}, ${userId}, ${row.nsfw}, ${row.label}, ${row.mime}, ${row.source}, ${row.license || null},
      ${row.prompt || null}, ${row.path}, ${favorite}, ${kind}, ${saved},
      ${row.provider || null}, ${row.model || null}, ${row.intendedUse || "general"},
      ${row.width ?? null}, ${row.height ?? null}, ${row.safetyStatus || "brand_safe"},
      ${row.aspectRatio || null}, ${row.promptHash || null}, ${row.dataB64 || null}
    )
  `;
  return asGalleryItem({
    id: row.id,
    nsfw: row.nsfw,
    label: row.label,
    mime: row.mime,
    source: row.source,
    license: row.license,
    prompt: row.prompt,
    path: row.path,
    kind,
    favorite,
    saved,
    created_at: created,
    provider: row.provider,
    model: row.model,
    intended_use: row.intendedUse,
    width: row.width,
    height: row.height,
    safety_status: row.safetyStatus,
    aspect_ratio: row.aspectRatio,
  });
}

function labelFor(kind: ImageKind, prompt: string, nsfw: boolean): string {
  if (kind === "logo") return "Logo concept";
  if (kind === "ad") return "Ad creative";
  if (kind === "background") return nsfw ? "Generated adult background" : "AI generated background";
  const short = (prompt || "").replace(/\s+/g, " ").trim();
  if (!short) return nsfw ? "Generated adult image" : "AI generated image";
  return short.length > 48 ? `${short.slice(0, 45)}…` : short;
}

export const uploadBackgroundFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { filename: string; mime: string; base64: string; nsfw?: boolean; label?: string }) => data)
  .handler(async ({ data, context }) => {
    const mime = data.mime === "image/png" || data.mime === "image/webp" ? data.mime : "image/jpeg";
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const raw = data.base64.replace(/^data:[^;]+;base64,/, "");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(raw, "base64");
    } catch {
      return { ok: false as const, reason: "That file could not be read." };
    }
    if (bytes.length < 32 || bytes.length > 8 * 1024 * 1024) {
      return { ok: false as const, reason: "Use an image under 8 MB." };
    }
    const id = newId();
    const path = await saveBytes(context.userId, id, bytes, ext);
    const item = await insertAsset(context.userId, {
      id,
      nsfw: Boolean(data.nsfw),
      label: data.label || data.filename.replace(/\.[^.]+$/, "") || "Uploaded picture",
      mime,
      source: "upload",
      license: "Owner upload",
      path,
      kind: "background",
      saved: true,
      dataB64: bytes.toString("base64"),
      intendedUse: "home",
      safetyStatus: data.nsfw ? "owner_private" : "brand_safe",
    });
    return { ok: true as const, asset: asVisualAsset(item), item };
  });

type GenInput = {
  prompt: string;
  nsfw?: boolean;
  kind?: ImageKind;
  n?: number;
  aspectRatio?: string;
  quality?: ImageQuality | string;
  style?: string;
  intendedUse?: IntendedUse | string;
  asBackground?: boolean;
};

async function generateOne(userId: string, opts: {
  prompt: string;
  nsfw: boolean;
  kind: ImageKind;
  aspectRatio?: string;
  quality?: ImageQuality;
  style?: string;
  intendedUse: IntendedUse;
}): Promise<{ ok: true; item: GalleryItem } | { ok: false; reason: string; code: string }> {
  const safety = evaluateImageSafety({ intendedUse: opts.intendedUse, nsfw: opts.nsfw });
  if (!safety.ok) return { ok: false, reason: safety.reason, code: "SAFETY" };
  const userPrompt = (opts.prompt || "").trim();
  if (userPrompt.length < 3) return { ok: false, reason: "Tell me what to generate.", code: "PROMPT" };
  if (!isImagineConfigured()) {
    return { ok: false, reason: "Image generation isn’t configured yet. Nothing was saved.", code: "PROVIDER_MISSING" };
  }
  const hash = promptHash([userId, userPrompt, opts.kind, String(safety.nsfw), opts.aspectRatio || "", opts.quality || "", opts.style || ""]);
  const dup = await findRecentDuplicate(userId, hash);
  if (dup) {
    const existing = await loadItem(userId, dup.id);
    if (existing) return { ok: true, item: existing };
  }
  if (!beginInflight(userId, hash)) {
    return { ok: false, reason: "I’m already creating an image. I’ll finish that one first.", code: "BUSY" };
  }
  try {
    const slot = await tryReserveImageSlot(userId, hash);
    if (!slot.ok) return { ok: false, reason: slot.reason, code: "CAP" };
    const wrapped = composeModelPrompt({
      prompt: userPrompt,
      kind: opts.kind,
      style: opts.style,
      nsfw: safety.nsfw,
    });
    const imagined = await generateImage({
      prompt: wrapped,
      aspectRatio: opts.aspectRatio || (opts.kind === "background" ? "16:9" : "auto"),
      quality: opts.quality || "high",
    });
    if (!imagined.ok) return imagined;
    const size = jpegSize(imagined.bytes);
    const id = newId();
    const path = await saveBytes(userId, id, imagined.bytes, "jpg");
    const item = await insertAsset(userId, {
      id,
      nsfw: safety.nsfw,
      label: labelFor(opts.kind, userPrompt, safety.nsfw),
      mime: "image/jpeg",
      source: "generated",
      license: "xAI Imagine, owner-generated",
      prompt: userPrompt,
      path,
      kind: opts.kind,
      saved: true,
      provider: imagined.provider,
      model: imagined.model,
      intendedUse: opts.intendedUse,
      width: size?.width ?? null,
      height: size?.height ?? null,
      safetyStatus: safety.safetyStatus,
      aspectRatio: imagined.aspectRatio,
      promptHash: hash,
      dataB64: imagined.bytes.toString("base64"),
    });
    await noteLastAsset(userId, id);
    return { ok: true, item };
  } finally {
    endInflight(userId);
  }
}

export const generateBackgroundFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { prompt: string; nsfw?: boolean; aspectRatio?: string; quality?: string; style?: string }) => data)
  .handler(async ({ data, context }) => {
    const result = await generateOne(context.userId, {
      prompt: data.prompt,
      nsfw: Boolean(data.nsfw),
      kind: "background",
      aspectRatio: data.aspectRatio || "16:9",
      quality: asQuality(data.quality),
      style: data.style,
      intendedUse: "home",
    });
    if (!result.ok) return result;
    return { ok: true as const, asset: asVisualAsset(result.item), item: result.item, origin: "generated" as const };
  });

export const generateImageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: GenInput) => data)
  .handler(async ({ data, context }) => {
    const n = Math.min(3, Math.max(1, Math.round(Number(data.n) || 1)));
    const kind = asImageKind(data.kind);
    const intendedUse = asIntendedUse(String(data.intendedUse || (kind === "background" ? "home" : kind === "ad" ? "ad" : "general")));
    const nsfw = Boolean(data.nsfw);
    const prompt = (data.prompt || "").trim();
    const items: GalleryItem[] = [];
    for (let i = 0; i < n; i += 1) {
      const variation = n > 1 ? `${prompt} (variation ${i + 1})` : prompt;
      const result = await generateOne(context.userId, {
        prompt: variation,
        nsfw,
        kind,
        aspectRatio: data.aspectRatio,
        quality: asQuality(data.quality),
        style: data.style,
        intendedUse,
      });
      if (!result.ok) {
        if (items.length) return { ok: true as const, items, partial: true as const, origin: "generated" as const };
        return result;
      }
      items.push(result.item);
    }
    return { ok: true as const, items, origin: "generated" as const };
  });

export const listGalleryFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<AssetRow>`
      select id, nsfw, label, mime, source, license, prompt, path, favorite, kind, saved, created_at,
             provider, model, intended_use, width, height, safety_status, aspect_ratio
      from visual_assets
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
    return { ok: true as const, items: rows.map(asGalleryItem) };
  });

export const updateGalleryItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; favorite?: boolean; saved?: boolean; kind?: ImageKind }) => data)
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const existing = await sql<AssetRow>`
      select id, nsfw, label, mime, source, license, prompt, path, favorite, kind, saved, created_at,
             provider, model, intended_use, width, height, safety_status, aspect_ratio
      from visual_assets
      where user_id = ${context.userId} and id = ${data.id}
      limit 1
    `;
    if (!existing[0]) return { ok: false as const, reason: "I don’t have that image." };
    const favorite = data.favorite ?? Boolean(existing[0].favorite);
    const saved = data.saved ?? (existing[0].saved !== false);
    const kind = data.kind ? asImageKind(data.kind) : asImageKind(existing[0].kind);
    await sql`
      update visual_assets
      set favorite = ${favorite}, saved = ${saved}, kind = ${kind}
      where user_id = ${context.userId} and id = ${data.id}
    `;
    return { ok: true as const, item: asGalleryItem({ ...existing[0], favorite, saved, kind }) };
  });

export const deleteGeneratedImageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const { unlink } = await import("node:fs/promises");
    const sql = await getSql();
    const existing = await sql<{ path: string }>`
      select path from visual_assets where user_id = ${context.userId} and id = ${data.id} limit 1
    `;
    if (!existing[0]) return { ok: false as const, reason: "I don’t have that image." };
    await sql`delete from visual_assets where user_id = ${context.userId} and id = ${data.id}`;
    try { await unlink(existing[0].path); } catch { /* already gone */ }
    return { ok: true as const, id: data.id };
  });

export const imageGenerationSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const cap = await loadImageCap(context.userId);
    const used = await imagesUsedToday(context.userId);
    const configured = isImagineConfigured();
    return { ok: true as const, cap, used, remaining: Math.max(0, cap - used), configured };
  });

export const saveImageGenerationCapFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { cap: number }) => data)
  .handler(async ({ data, context }) => {
    const cap = await saveImageCap(context.userId, data.cap);
    const used = await imagesUsedToday(context.userId);
    return { ok: true as const, cap, used, remaining: Math.max(0, cap - used) };
  });

export const listBackgroundsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<AssetRow>`
      select id, nsfw, label, mime, source, license, prompt, path, favorite, kind, saved, created_at
      from visual_assets
      where user_id = ${context.userId}
      order by created_at desc
    `;
    return { ok: true as const, assets: rows.map((r) => asVisualAsset(asGalleryItem(r))) };
  });
