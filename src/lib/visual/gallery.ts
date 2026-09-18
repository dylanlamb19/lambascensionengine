import { asIntendedUse, type IntendedUse, type SafetyStatus } from "./safety.ts";

export type ImageKind = "image" | "background" | "logo" | "ad";

export type GalleryItem = {
  id: string;
  url: string;
  prompt: string;
  label: string;
  kind: ImageKind;
  nsfw: boolean;
  favorite: boolean;
  saved: boolean;
  createdAt: string;
  source: "generated" | "upload";
  provider?: string;
  model?: string;
  intendedUse?: IntendedUse;
  width?: number | null;
  height?: number | null;
  safetyStatus?: SafetyStatus;
  aspectRatio?: string;
};

export type GalleryState = {
  items: GalleryItem[];
  currentId: string | null;
  busy: boolean;
  error: string | null;
  expanded: boolean;
  lastPrompt: string;
  lastKind: ImageKind;
  lastNsfw: boolean;
  lastAspect?: string;
  lastQuality?: string;
  lastStyle?: string;
  lastUse?: IntendedUse;
  status?: "idle" | "creating" | "ready" | "failed";
  libraryOpen?: boolean;
};

export const EMPTY_GALLERY: GalleryState = {
  items: [],
  currentId: null,
  busy: false,
  error: null,
  expanded: false,
  lastPrompt: "",
  lastKind: "image",
  lastNsfw: false,
  status: "idle",
  libraryOpen: false,
};

export type ImageCommand =
  | {
      op: "generate";
      prompt: string;
      n: number;
      kind: ImageKind;
      nsfw?: boolean;
      asBackground?: boolean;
      aspectRatio?: string;
      quality?: string;
      style?: string;
      intendedUse?: IntendedUse;
    }
  | { op: "again"; extra?: string; aspectRatio?: string; quality?: string; style?: string }
  | { op: "reuse" }
  | { op: "as_background"; id?: string; query?: string }
  | { op: "favorite"; id?: string }
  | { op: "save"; id?: string }
  | { op: "select"; id: string }
  | { op: "to_ad"; id?: string }
  | { op: "clear" }
  | { op: "expand" }
  | { op: "collapse" }
  | { op: "delete"; id?: string; index?: number }
  | { op: "list" }
  | { op: "open_library" };

const KINDS: ImageKind[] = ["image", "background", "logo", "ad"];
const STORE = "la_image_gallery_v1";

export function asImageKind(raw: string | undefined): ImageKind {
  const t = (raw || "").toLowerCase();
  if (t === "logo") return "logo";
  if (t === "ad" || t === "creative") return "ad";
  if (t === "background" || t === "wallpaper") return "background";
  return "image";
}

export function detectImageKind(raw: string): ImageKind {
  const t = (raw || "").toLowerCase();
  if (/\blogo\b/.test(t)) return "logo";
  if (/\b(ad creative|facebook ad|instagram ad|ad for|creative for|ad mockup)\b/.test(t)) return "ad";
  if (/\b(background|wallpaper|behind (the )?home)\b/.test(t)) return "background";
  return "image";
}

export function extractImagePrompt(raw: string): string {
  return (raw || "")
    .replace(/^(ara[,:\s]+)/i, "")
    .replace(/^(please\s+)?(can you |could you |would you )?/i, "")
    .replace(/^(generate(\s+me)?|make me|create|draw|imagine)\s+/i, "")
    .replace(/^(an |a )?(image|picture|photo|illustration)\b(\s+of)?\s*/i, "")
    .replace(/\s+as (my |the )?(home )?background$/i, "")
    .replace(/\s+behind (the )?home$/i, "")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenerateIntent(t: string): boolean {
  if (/^(make it|make the|make them|make this|make home)\b/.test(t) && !/wider|photorealistic/.test(t)) return false;
  if (/^(generate|make me|create|draw|imagine)\b/.test(t)) return true;
  if (/\bgenerate (an |a |me )?(image|picture|photo|logo|ad|creative|background|new background)\b/.test(t)) return true;
  if (/^(make) (an |a )?(image|picture|photo|illustration|logo|ad|creative|background)\b/.test(t)) return true;
  return false;
}

function detectAspect(t: string): string | undefined {
  if (/\b(21:9|ultra[\s-]?wide|cinematic wide)\b/.test(t) || /make it wider|wider for (my )?(home )?background/.test(t)) return "21:9";
  if (/\b16:9|widescreen|wide for (my )?(home )?background\b/.test(t)) return "16:9";
  if (/\b9:16|phone wallpaper|story\b/.test(t)) return "9:16";
  if (/\b1:1|square\b/.test(t)) return "1:1";
  return undefined;
}

function detectStyle(t: string): string | undefined {
  if (/photorealistic|photo realistic|as a photo/.test(t)) return "photorealistic";
  if (/illustration|illustrated|painterly/.test(t)) return "illustration";
  if (/anime|manga/.test(t)) return "anime";
  return undefined;
}

function detectUse(t: string, kind: ImageKind): IntendedUse {
  if (/\b(facebook|instagram|social|post this)\b/.test(t)) return "social";
  if (kind === "ad" || /\b(ad|ads|advertising)\b/.test(t)) return "ad";
  if (/\bclient work|for a client\b/.test(t)) return "client";
  if (/\bmarketing|public\b/.test(t)) return "marketing";
  if (kind === "background") return "home";
  return "general";
}

function ordinalIndex(t: string): number | null {
  if (/\bfirst\b/.test(t)) return 0;
  if (/\bsecond\b/.test(t)) return 1;
  if (/\bthird\b/.test(t)) return 2;
  const m = t.match(/\b(\d+)(st|nd|rd|th)\b/);
  if (m) return Math.max(0, Number(m[1]) - 1);
  return null;
}

export function parseImageCommand(raw: string): ImageCommand | null {
  let t = (raw || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(ara )+/, "").replace(/^(please )?(can you |could you |would you )?/, "").trim();
  if (!t) return null;
  if (/show (me )?(the )?(evidence|explanation|explain panel|pipeline|calendar)/.test(t)) return null;
  if (/^show me( that| this| it)?$/.test(t)) return null;
  if (/what am i looking at|explain this screen|what does this (page |screen )?mean/.test(t)) return null;
  if (/what is this image|what did you generate|what('s| is) the prompt/.test(t)) return null;

  if (/show me (the |my )?(generated )?images|images we('ve| have) made|open (the )?(image )?(library|gallery)|show (the )?library/.test(t)) {
    return { op: "list" };
  }
  if (/delete (that|this|it|the .+?\b(one|image|picture|background))/.test(t) && !/delete test/.test(t)) {
    const index = ordinalIndex(t);
    return { op: "delete", index: index ?? undefined };
  }

  if (/use (this|that|it) as (my |the )?(home )?background|apply (this|that|the image) as (the |my )?(home )?background|use that as home/.test(t)) {
    return { op: "as_background" };
  }
  const prior = t.match(/use (the )?(.+?) (image|one|background) we generated/);
  if (prior) return { op: "as_background", query: prior[2].trim() };

  if (/try that as (a )?photorealistic/.test(t)) {
    return { op: "again", style: "photorealistic" };
  }
  if (/make it wider( for (my )?(home )?background)?$/.test(t)) {
    return { op: "again", aspectRatio: "21:9" };
  }
  const anotherBut = t.match(/^(make another( one)?|generate another( version| one)?)(?: but | with )(.+)$/);
  if (anotherBut && anotherBut[4]) {
    const extra = anotherBut[4].replace(/^(one|version)\s+/, "").trim();
    if (extra && extra !== "one" && extra !== "version" && !/background$/.test(extra)) {
      return { op: "again", extra, aspectRatio: detectAspect(t), style: detectStyle(t) };
    }
  }
  if (/^(generate again|regenerate|another variation|make another( one)?|generate another( one| version)?)$/.test(t)
    || /generate (it )?again|make (me )?another variation|reuse (the |this )?prompt/.test(t)) {
    return /reuse/.test(t) ? { op: "reuse" } : { op: "again" };
  }
  if (/send (this|it|the image) (to|into) (an? )?(ad|ads|meta|facebook)|use (this|it) (in|for) (an? )?(ad|ads|creative)/.test(t)) {
    return { op: "to_ad" };
  }
  if (/favorite this|star this/.test(t)) return { op: "favorite" };
  if (/save this|save (it |this )?(to (the )?gallery)/.test(t)) return { op: "save" };
  if (/clear the (image|picture|gallery)|hide the image|clear the image area/.test(t)) return { op: "clear" };
  if (/expand the image|show (the image|it) bigger|full screen (the )?image/.test(t)) return { op: "expand" };
  if (/close the (expanded )?image|collapse the image/.test(t)) return { op: "collapse" };

  if (!isGenerateIntent(t)) return null;

  const n = /\b(three|3) (versions|variations|images)\b/.test(t) ? 3
    : /\b(two|2|a few|a couple) (versions|variations|images)?\b/.test(t) ? 2
    : 1;
  const prompt = extractImagePrompt(raw) || "cinematic gold and black scene";
  const asBackground = /behind (the )?home|as (my |the )?(home )?background|new background for home/.test(t);
  const kind = asBackground ? "background" : detectImageKind(t);
  return {
    op: "generate",
    prompt,
    n,
    kind,
    nsfw: /\b(nsfw|adult|pin-?up|erotic|nude|naked|boudoir|sexy)\b/.test(t),
    asBackground,
    aspectRatio: detectAspect(t) || (kind === "background" ? "16:9" : undefined),
    quality: /fast|quick|cheap/.test(t) ? "low" : "high",
    style: detectStyle(t),
    intendedUse: detectUse(t, kind),
  };
}

export function galleryFromUnknown(raw: unknown): GalleryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<GalleryItem>;
  if (!v.id || !v.url) return null;
  return {
    id: String(v.id),
    url: String(v.url),
    prompt: String(v.prompt || ""),
    label: String(v.label || "Generated image"),
    kind: KINDS.includes(v.kind as ImageKind) ? (v.kind as ImageKind) : "image",
    nsfw: Boolean(v.nsfw),
    favorite: Boolean(v.favorite),
    saved: v.saved !== false,
    createdAt: String(v.createdAt || ""),
    source: v.source === "upload" ? "upload" : "generated",
    provider: v.provider ? String(v.provider) : undefined,
    model: v.model ? String(v.model) : undefined,
    intendedUse: v.intendedUse ? asIntendedUse(String(v.intendedUse)) : undefined,
    width: typeof v.width === "number" ? v.width : null,
    height: typeof v.height === "number" ? v.height : null,
    safetyStatus: v.safetyStatus,
    aspectRatio: v.aspectRatio ? String(v.aspectRatio) : undefined,
  };
}

export function galleryStateFromUnknown(raw: unknown): GalleryState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_GALLERY };
  const v = raw as Partial<GalleryState>;
  const items = Array.isArray(v.items) ? v.items.map(galleryFromUnknown).filter((x): x is GalleryItem => Boolean(x)) : [];
  return {
    items,
    currentId: typeof v.currentId === "string" ? v.currentId : items[0]?.id || null,
    busy: false,
    error: null,
    expanded: false,
    lastPrompt: String(v.lastPrompt || ""),
    lastKind: KINDS.includes(v.lastKind as ImageKind) ? (v.lastKind as ImageKind) : "image",
    lastNsfw: Boolean(v.lastNsfw),
    lastAspect: v.lastAspect,
    lastQuality: v.lastQuality,
    lastStyle: v.lastStyle,
    lastUse: v.lastUse,
    status: "idle",
    libraryOpen: false,
  };
}

export function currentGalleryItem(state: GalleryState): GalleryItem | null {
  if (!state.items.length) return null;
  return state.items.find((i) => i.id === state.currentId) || state.items[0];
}

export function matchGalleryQuery(items: GalleryItem[], query: string): GalleryItem | null {
  const q = (query || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  return items.find((i) => i.label.toLowerCase().includes(q) || i.prompt.toLowerCase().includes(q) || i.id === q) || null;
}

export function summarizeGallery(items: GalleryItem[], currentId?: string | null): string {
  const generated = items.filter((i) => i.source === "generated");
  if (!generated.length) return "No AI-generated images yet. Ask Ara to generate one — that calls the xAI Imagine model, not a preset.";
  const cur = generated.find((i) => i.id === currentId) || generated[0];
  return `Latest AI generated: ${cur.label}. Prompt: ${cur.prompt || "none"}. ${generated.length} generated.`;
}

export function originLabel(item: Pick<GalleryItem, "source"> | { source?: string } | null | undefined): string {
  if (!item) return "";
  return item.source === "generated" ? "AI generated" : item.source === "upload" ? "Uploaded" : "Background preset";
}

export function formatImageTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(d);
}

export function loadGalleryLocal(): GalleryState {
  if (typeof window === "undefined") return { ...EMPTY_GALLERY };
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return { ...EMPTY_GALLERY };
    return galleryStateFromUnknown(JSON.parse(raw));
  } catch {
    return { ...EMPTY_GALLERY };
  }
}

export function saveGalleryLocal(state: GalleryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE, JSON.stringify({
      items: state.items.slice(0, 40),
      currentId: state.currentId,
      lastPrompt: state.lastPrompt,
      lastKind: state.lastKind,
      lastNsfw: state.lastNsfw,
      lastAspect: state.lastAspect,
      lastQuality: state.lastQuality,
      lastStyle: state.lastStyle,
      lastUse: state.lastUse,
    }));
  } catch {
    /* quota */
  }
}

export function mergeGalleryItems(prev: GalleryItem[], incoming: GalleryItem[]): GalleryItem[] {
  const seen = new Set<string>();
  const out: GalleryItem[] = [];
  for (const item of [...incoming, ...prev]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.slice(0, 40);
}

export function kindLabel(kind: ImageKind): string {
  if (kind === "logo") return "Logo";
  if (kind === "ad") return "Ad creative";
  if (kind === "background") return "Background";
  return "Image";
}

export function confirmGenerateSpeech(prompt: string, n: number): string {
  const short = prompt.replace(/\s+/g, " ").trim();
  if (n > 1) return `Creating ${n} images of ${short}…`;
  return `Creating image… ${short}`;
}
