/**
 * ImageGenerationProvider — xAI Imagine is the official runtime image API
 * on this app. The key stays in this server module. Never call this from the browser.
 */
export const IMAGINE_ENDPOINT = "https://api.x.ai/v1/images/generations";
export const IMAGINE_QUALITY_MODEL = "grok-imagine-image-2.0";
export const IMAGINE_FAST_MODEL = "grok-imagine-image";
export const IMAGINE_PROVIDER = "xai-imagine";

export const ASPECT_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "5:2", "auto",
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type ImageQuality = "low" | "high";

export type GenerateImageRequest = {
  prompt: string;
  aspectRatio?: string;
  quality?: ImageQuality;
  n?: number;
};

export type GenerateImageSuccess = {
  ok: true;
  bytes: Buffer;
  mime: "image/jpeg";
  provider: typeof IMAGINE_PROVIDER;
  model: string;
  aspectRatio: string;
  resolution: "1k" | "2k";
};

export type GenerateImageFailure = {
  ok: false;
  reason: string;
  code: "PROVIDER_MISSING" | "PROVIDER_ERROR" | "EMPTY";
};

export function asAspectRatio(raw: string | undefined | null): AspectRatio {
  const t = (raw || "").trim();
  return (ASPECT_RATIOS as readonly string[]).includes(t) ? (t as AspectRatio) : "auto";
}

export function asQuality(raw: string | undefined | null): ImageQuality {
  const t = (raw || "").toLowerCase();
  if (t === "low" || t === "fast" || t === "cheap") return "low";
  return "high";
}

export function modelForQuality(quality: ImageQuality): string {
  return quality === "low" ? IMAGINE_FAST_MODEL : IMAGINE_QUALITY_MODEL;
}

export function isImagineConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

export function composeModelPrompt(opts: {
  prompt: string;
  kind?: string;
  style?: string;
  nsfw?: boolean;
}): string {
  const p = (opts.prompt || "").trim();
  const style = (opts.style || "").trim();
  const bits = [p];
  if (style) bits.push(style);
  if (opts.nsfw) {
    bits.unshift("Cinematic photograph of a consenting adult in their late 20s, dark navy and gold lighting, sharp, no watermark.");
  } else if (opts.kind === "logo") {
    bits.unshift("Premium logo mark concept, gold and black, high-end, sharp, clean negative space, no watermark.");
  } else if (opts.kind === "ad") {
    bits.unshift("Premium advertising creative, cinematic gold and black, sharp, brand-safe, no watermark.");
  } else if (opts.kind === "background") {
    bits.unshift("Cinematic wide scenery, sharp high-resolution, no watermark, suitable as a desktop wallpaper.");
  } else {
    bits.unshift("Sharp high-resolution image, cinematic, no watermark.");
  }
  return bits.filter(Boolean).join(" ");
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageSuccess | GenerateImageFailure> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, code: "PROVIDER_MISSING", reason: "Image generation isn’t configured yet. Nothing was saved." };
  }
  const quality = asQuality(req.quality);
  const model = modelForQuality(quality);
  const aspectRatio = asAspectRatio(req.aspectRatio);
  const resolution: "1k" | "2k" = quality === "low" ? "1k" : "2k";
  const n = Math.min(1, Math.max(1, Math.round(Number(req.n) || 1)));
  const payload: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    n,
    aspect_ratio: aspectRatio,
    resolution,
    response_format: "b64_json",
  };
  if (model === IMAGINE_QUALITY_MODEL) {
    payload.quality = quality === "low" ? "low" : "medium";
  }
  let res: Response;
  try {
    res = await fetch(IMAGINE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, code: "PROVIDER_ERROR", reason: "The image provider didn’t finish. Nothing was saved." };
  }
  if (!res.ok) {
    return { ok: false, code: "PROVIDER_ERROR", reason: "The image provider didn’t finish. Nothing was saved." };
  }
  const body = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  let bytes: Buffer | null = null;
  if (b64) bytes = Buffer.from(b64, "base64");
  else if (body.data?.[0]?.url) {
    try {
      const img = await fetch(body.data[0].url);
      if (img.ok) bytes = Buffer.from(await img.arrayBuffer());
    } catch {
      bytes = null;
    }
  }
  if (!bytes || bytes.length < 32) {
    return { ok: false, code: "EMPTY", reason: "The image provider returned nothing usable." };
  }
  return { ok: true, bytes, mime: "image/jpeg", provider: IMAGINE_PROVIDER, model, aspectRatio, resolution };
}

export function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) + bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: (bytes[i + 5] << 8) + bytes[i + 6], width: (bytes[i + 7] << 8) + bytes[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

export function promptHash(parts: string[]): string {
  const s = parts.join("|").toLowerCase().replace(/\s+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
