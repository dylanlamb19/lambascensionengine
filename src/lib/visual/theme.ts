import { parseImageCommand } from "./gallery.ts";

export type VisualPage = "home";
export type VisualDensity = "comfortable" | "compact";
export type VisualFocus = "center" | "left" | "right" | "top" | "bottom";
export type VisualSource = "bundled" | "upload" | "generated";

export type PageTheme = {
  backgroundId: string | null;
  backgroundUrl: string | null;
  backgroundLabel: string;
  overlay: number;
  blur: 0;
  cardOpacity: number;
  cardGlass: boolean;
  accent: number;
  density: VisualDensity;
  gradient: string | null;
  nsfw: boolean;
  source: VisualSource;
  focus: VisualFocus;
};

export type VisualTheme = {
  version: 1;
  page: VisualPage;
  home: PageTheme;
  history: PageTheme[];
  future: PageTheme[];
  adultMode: boolean;
  hideAdultUntilUnlock: boolean;
  uploads: VisualAsset[];
};

export type VisualCommand =
  | { op: "background"; scene?: string; description?: string; nsfw?: boolean }
  | { op: "overlay"; amount?: number; delta?: number }
  | { op: "readable" }
  | { op: "cards"; glass?: boolean; opacity?: number; opacityDelta?: number }
  | { op: "accent"; amount?: number; delta?: number }
  | { op: "density"; density: VisualDensity }
  | { op: "focus"; focus: VisualFocus }
  | { op: "cycle" }
  | { op: "adult"; enabled: boolean }
  | { op: "privacy"; hideAdultUntilUnlock: boolean }
  | { op: "upload"; id: string; url: string; label: string; nsfw?: boolean; source?: VisualSource }
  | { op: "generate"; prompt?: string; nsfw?: boolean }
  | { op: "pick"; nsfw?: boolean }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "reset" };

export type VisualAsset = {
  id: string;
  label: string;
  url: string;
  keys: string[];
  overlay: number;
  nsfw?: boolean;
  source?: VisualSource;
  license?: string;
};

export const NATURE_ASSETS: VisualAsset[] = [
  {
    id: "mountain-lake-sunrise",
    label: "Mountain Lake Sunrise",
    url: "/backgrounds/mountain-lake-sunrise.jpg",
    keys: ["mountain lake", "lake at sunrise", "relaxing mountain", "serene mountain", "mountain view", "sunrise lake", "beautiful scenery", "scenery", "pick something", "nature"],
    overlay: 0.58,
  },
  {
    id: "misty-forest",
    label: "Misty Forest",
    url: "/backgrounds/misty-forest.jpg",
    keys: ["misty forest", "forest mist", "foggy forest", "mist forest"],
    overlay: 0.6,
  },
  {
    id: "dark-alpine-mountains",
    label: "Dark Alpine Mountains",
    url: "/backgrounds/dark-alpine-mountains.jpg",
    keys: ["night mountain", "dark alpine", "nighttime mountain", "dark mountain", "alpine night"],
    overlay: 0.52,
  },
  {
    id: "forest-sunrise",
    label: "Forest Sunrise",
    url: "/backgrounds/forest-sunrise.jpg",
    keys: ["forest sunrise", "sunrise forest", "woods at sunrise"],
    overlay: 0.56,
  },
  {
    id: "desert-sunset",
    label: "Desert Sunset",
    url: "/backgrounds/desert-sunset.jpg",
    keys: ["desert", "desert sunset", "canyon sunset"],
    overlay: 0.55,
  },
  {
    id: "ocean-cliffs",
    label: "Ocean Cliffs",
    url: "/backgrounds/ocean-cliffs.jpg",
    keys: ["ocean", "cliffs", "ocean cliffs", "sea cliffs", "coast"],
    overlay: 0.57,
  },
  {
    id: "minimal-dark-landscape",
    label: "Minimal Dark Landscape",
    url: "/backgrounds/minimal-dark-landscape.jpg",
    keys: ["minimal", "minimal dark", "dark landscape", "simple dark", "subtle"],
    overlay: 0.62,
  },
];

export const ADULT_ASSETS: VisualAsset[] = [
  {
    id: "adult-pinup-gold",
    label: "Gold Pin-up",
    url: "/backgrounds/adult/pinup-gold.jpg",
    keys: ["nsfw", "adult", "pin-up", "pinup", "erotic", "adult background", "nsfw background"],
    overlay: 0.56,
    nsfw: true,
    source: "bundled",
    license: "Lamb Ascension owner library",
  },
  {
    id: "adult-boudoir-lamp",
    label: "Lamp-lit Boudoir",
    url: "/backgrounds/adult/boudoir-lamp.jpg",
    keys: ["boudoir", "nsfw", "adult", "erotic", "pin-up"],
    overlay: 0.58,
    nsfw: true,
    source: "bundled",
    license: "Lamb Ascension owner library",
  },
  {
    id: "adult-silk-window",
    label: "Silk at the Window",
    url: "/backgrounds/adult/silk-window.jpg",
    keys: ["subtle", "silk", "nsfw", "adult", "more subtle"],
    overlay: 0.54,
    nsfw: true,
    source: "bundled",
    license: "Lamb Ascension owner library",
  },
];

/** @deprecated use NATURE_ASSETS. Kept so older imports still resolve. */
export const VISUAL_ASSETS = NATURE_ASSETS;

export const DEFAULT_PAGE_THEME: PageTheme = {
  backgroundId: null,
  backgroundUrl: null,
  backgroundLabel: "Default Lamb Ascension",
  overlay: 0,
  blur: 0,
  cardOpacity: 0.96,
  cardGlass: false,
  accent: 1,
  density: "comfortable",
  gradient: null,
  nsfw: false,
  source: "bundled",
  focus: "center",
};

export const DEFAULT_VISUAL_THEME: VisualTheme = {
  version: 1,
  page: "home",
  home: { ...DEFAULT_PAGE_THEME },
  history: [],
  future: [],
  adultMode: false,
  hideAdultUntilUnlock: false,
  uploads: [],
};

const HISTORY_MAX = 16;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clonePage(page: PageTheme): PageTheme {
  return { ...page, blur: 0 };
}

export function catalogFor(theme: VisualTheme, nsfw?: boolean): VisualAsset[] {
  const adult = nsfw === true || (nsfw !== false && theme.adultMode);
  const extra = theme.uploads || [];
  if (adult) return [...ADULT_ASSETS, ...extra.filter((a) => a.nsfw), ...NATURE_ASSETS];
  return [...NATURE_ASSETS, ...extra.filter((a) => !a.nsfw)];
}

export function matchVisualAsset(raw: string, theme: VisualTheme = DEFAULT_VISUAL_THEME, nsfwHint?: boolean): VisualAsset | null {
  const t = (raw || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(nsfw|adult|erotic|sexy|nude|naked)$/.test(t)) return null;
  const nsfw = nsfwHint ?? wantsNsfw(t);
  if (/subtle/.test(t) && (nsfw || (theme.adultMode && theme.home.nsfw))) {
    return ADULT_ASSETS.find((a) => a.id === "adult-silk-window") || ADULT_ASSETS[0];
  }
  const pool = catalogFor(theme, nsfw);
  for (const asset of pool) {
    if (t === asset.id || t === asset.label.toLowerCase()) return asset;
  }
  let best: VisualAsset | null = null;
  let bestLen = 0;
  for (const asset of pool) {
    for (const key of asset.keys) {
      if ((t.includes(key) || key.includes(t)) && key.length > bestLen) {
        best = asset;
        bestLen = key.length;
      }
    }
  }
  if (best) return best;
  if (nsfw) return ADULT_ASSETS[0];
  if (/mountain|lake|scenery|beautiful|relaxing|sunrise|nature/.test(t)) return NATURE_ASSETS[0];
  if (/upload|my picture|my photo|this picture/.test(t)) return theme.uploads[theme.uploads.length - 1] || null;
  return null;
}

export function wantsNsfw(raw: string): boolean {
  return /\b(nsfw|adult|pin-?up|erotic|nude|naked|boudoir|sexy)\b/.test((raw || "").toLowerCase());
}

export function nextInFamily(theme: VisualTheme): VisualAsset | null {
  const nsfw = theme.home.nsfw && theme.adultMode;
  const family = nsfw
    ? [...ADULT_ASSETS, ...theme.uploads.filter((a) => a.nsfw)]
    : NATURE_ASSETS;
  if (!family.length) return null;
  const ix = family.findIndex((a) => a.id === theme.home.backgroundId);
  return family[(ix + 1) % family.length];
}

export function summarizeTheme(theme: VisualTheme): string {
  const p = theme.home;
  const adult = theme.adultMode ? " Adult Background Mode is on." : "";
  if (!p.backgroundId) return `Default Lamb Ascension theme. No scenery background.${adult}`;
  const origin = p.source === "generated" ? "AI generated" : p.source === "upload" ? "Uploaded" : "Background preset";
  const kind = p.nsfw ? "Adult image" : "Scenery";
  return `${origin}. ${kind}: ${p.backgroundLabel}. Sharp (no image blur). Overlay ${Math.round(p.overlay * 100)}%. Cards at ${Math.round(p.cardOpacity * 100)}% opacity. Gold accent ${Math.round(p.accent * 100)}%.${adult}`;
}

function pushHistory(theme: VisualTheme): VisualTheme {
  return {
    ...theme,
    history: [...theme.history, clonePage(theme.home)].slice(-HISTORY_MAX),
    future: [],
  };
}

function applyAsset(next: PageTheme, asset: VisualAsset): PageTheme {
  return {
    ...next,
    backgroundId: asset.id,
    backgroundUrl: asset.url,
    backgroundLabel: asset.label,
    overlay: asset.overlay,
    blur: 0,
    cardGlass: true,
    cardOpacity: Math.min(next.cardOpacity || 0.86, 0.86),
    nsfw: Boolean(asset.nsfw),
    source: asset.source || "bundled",
    focus: next.focus || "center",
  };
}

export function applyVisualCommand(theme: VisualTheme, cmd: VisualCommand): { theme: VisualTheme; spoken: string } {
  if (cmd.op === "undo") {
    const prev = theme.history[theme.history.length - 1];
    if (!prev) return { theme, spoken: "Nothing to undo." };
    return {
      theme: {
        ...theme,
        home: clonePage(prev),
        history: theme.history.slice(0, -1),
        future: [clonePage(theme.home), ...theme.future].slice(0, HISTORY_MAX),
      },
      spoken: `Undid that. Back to ${prev.backgroundLabel}. The picture stays sharp.`,
    };
  }
  if (cmd.op === "redo") {
    const nxt = theme.future[0];
    if (!nxt) return { theme, spoken: "Nothing to redo." };
    return {
      theme: {
        ...theme,
        home: clonePage(nxt),
        history: [...theme.history, clonePage(theme.home)].slice(-HISTORY_MAX),
        future: theme.future.slice(1),
      },
      spoken: `Redid that. ${nxt.backgroundLabel}.`,
    };
  }
  if (cmd.op === "reset") {
    if (!theme.home.backgroundId && theme.home.overlay === 0 && theme.home.accent === 1 && !theme.home.cardGlass) {
      return { theme, spoken: "Home is already the default Lamb Ascension theme." };
    }
    return {
      theme: { ...pushHistory(theme), home: clonePage(DEFAULT_PAGE_THEME) },
      spoken: "Reset Home to the default Lamb Ascension theme.",
    };
  }
  if (cmd.op === "adult") {
    if (theme.adultMode === cmd.enabled) {
      return { theme, spoken: cmd.enabled ? "Adult Background Mode is already on." : "Adult Background Mode is already off." };
    }
    const nextTheme = { ...theme, adultMode: cmd.enabled };
    if (!cmd.enabled && theme.home.nsfw) {
      const mountain = NATURE_ASSETS[0];
      return {
        theme: { ...pushHistory(nextTheme), adultMode: false, home: applyAsset(clonePage(theme.home), mountain) },
        spoken: "Adult Background Mode is off. I put Mountain Lake Sunrise back.",
      };
    }
    return { theme: nextTheme, spoken: cmd.enabled ? "Adult Background Mode is on. Ask me for an adult background whenever you want." : "Adult Background Mode is off." };
  }
  if (cmd.op === "privacy") {
    return {
      theme: { ...theme, hideAdultUntilUnlock: cmd.hideAdultUntilUnlock },
      spoken: cmd.hideAdultUntilUnlock
        ? "I’ll hide adult backgrounds until you unlock them after sign-in."
        : "Adult backgrounds will show as soon as you’re signed in.",
    };
  }
  if (cmd.op === "generate") {
    return { theme, spoken: "Creating image…" };
  }
  if (cmd.op === "pick") {
    return { theme, spoken: "Pick a picture. I’ll import it and keep it sharp." };
  }

  const current = theme.home;
  let next = clonePage(current);
  let spoken = "Updated the Home look.";
  let adultMode = theme.adultMode;
  let uploads = theme.uploads;

  if (cmd.op === "background") {
    const nsfw = cmd.nsfw || wantsNsfw(cmd.scene || cmd.description || "");
    if (nsfw) adultMode = true;
    const asset = matchVisualAsset(cmd.scene || cmd.description || (nsfw ? "nsfw background" : "mountain lake"), { ...theme, adultMode }, nsfw);
    if (!asset) {
      return { theme, spoken: nsfw && !adultMode
        ? "Adult Background Mode is off. Say “use an adult background” to turn it on."
        : "I don’t have that scene. I can use the bundled scenery, an uploaded picture, or generate one." };
    }
    next = applyAsset(next, asset);
    const origin = (asset.source || "bundled") === "generated" ? "AI generated" : "Preset selected";
    spoken = nsfw
      ? `${origin}: ${asset.label} is behind Home. The image stays sharp — I used a dark overlay so the desk stays readable.`
      : `${origin}: ${asset.label} is behind Home, sharp, with a darker overlay so the desk stays readable.`;
  } else if (cmd.op === "cycle") {
    const asset = nextInFamily({ ...theme, adultMode });
    if (!asset) return { theme, spoken: "I don’t have another background in that set yet." };
    next = applyAsset(next, asset);
    spoken = `Preset selected: ${asset.label}. Still sharp.`;
  } else if (cmd.op === "upload") {
    const asset: VisualAsset = {
      id: cmd.id,
      label: cmd.label,
      url: cmd.url,
      keys: ["upload", "my picture", "my photo", "uploaded"],
      overlay: 0.55,
      nsfw: Boolean(cmd.nsfw),
      source: cmd.source || "upload",
      license: cmd.source === "generated" ? "xAI Imagine, owner-generated" : "Owner upload",
    };
    uploads = [...uploads.filter((a) => a.id !== asset.id), asset].slice(-12);
    if (asset.nsfw) adultMode = true;
    next = applyAsset(next, asset);
    spoken = asset.source === "generated"
      ? `AI generated. ${asset.label} is behind Home. Sharp, with a dark overlay so the desk stays readable.`
      : "Using your picture as the Home background. It stays sharp.";
  } else if (cmd.op === "overlay") {
    const amount = cmd.amount != null ? cmd.amount : next.overlay + (cmd.delta ?? 0);
    next.overlay = clamp(amount, 0.12, 0.88);
    spoken = next.overlay > current.overlay ? "Darkened the overlay. The picture stays sharp." : "Let more of the picture through. Still no blur.";
  } else if (cmd.op === "readable") {
    next.overlay = clamp(next.overlay + 0.12, 0.28, 0.88);
    next.cardOpacity = clamp(next.cardOpacity + 0.1, 0.7, 0.96);
    next.cardGlass = true;
    spoken = "Made the interface easier to read with a stronger overlay and darker cards. The picture stays sharp.";
  } else if (cmd.op === "cards") {
    if (cmd.glass != null) next.cardGlass = cmd.glass;
    if (cmd.opacity != null) next.cardOpacity = clamp(cmd.opacity, 0.42, 1);
    else if (cmd.opacityDelta != null) next.cardOpacity = clamp(next.cardOpacity + cmd.opacityDelta, 0.42, 1);
    if (cmd.glass) next.cardOpacity = Math.min(next.cardOpacity, 0.88);
    spoken = next.cardGlass ? "Darkened the cards so the picture stays readable underneath." : "Made the cards more solid.";
  } else if (cmd.op === "accent") {
    const amount = cmd.amount != null ? cmd.amount : next.accent + (cmd.delta ?? 0);
    next.accent = clamp(amount, 0.25, 1);
    spoken = next.accent < current.accent ? "Quieted the gold." : "Brought the gold back up.";
  } else if (cmd.op === "density") {
    next.density = cmd.density;
    spoken = cmd.density === "compact" ? "Tightened the Home spacing." : "Gave Home more room.";
  } else if (cmd.op === "focus") {
    next.focus = cmd.focus;
    spoken = cmd.focus === "center" ? "The image fills the screen, centered." : `Moved the focal point to the ${cmd.focus}.`;
  }

  next.blur = 0;
  if (JSON.stringify(next) === JSON.stringify(current) && adultMode === theme.adultMode) return { theme, spoken };
  return {
    theme: { ...pushHistory({ ...theme, adultMode, uploads }), home: next, adultMode, uploads },
    spoken,
  };
}

export function parseVisualCommand(raw: string): VisualCommand | null {
  const t = (raw || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/show (me )?(the )?(evidence|explanation|explain panel|pipeline|calendar)/.test(t)) return null;
  if (/^show me( that| this| it)?$/.test(t)) return null;
  if (parseImageCommand(raw)?.op === "generate") return null;
  if (/use (this|that|it) as (my |the )?(home )?background/.test(t)) return null;

  if (/^(undo that|undo the (last )?(change|background|theme)|go back on that)$/.test(t) || /^undo$/.test(t)) return { op: "undo" };
  if (/go back to (my |the )?(previous|last) background|previous background|last background/.test(t)) return { op: "undo" };
  if (/^(redo that|redo)$/.test(t)) return { op: "redo" };
  if (/reset (home|the (home )?theme|the background|visuals)|default (home )?theme|remove the background/.test(t)) return { op: "reset" };

  if (/turn off adult|disable adult background/.test(t)) return { op: "adult", enabled: false };
  if (/hide adult (backgrounds? )?on startup|lock adult background/.test(t)) return { op: "privacy", hideAdultUntilUnlock: true };
  if (/show adult (backgrounds? )?on startup|don't hide adult/.test(t)) return { op: "privacy", hideAdultUntilUnlock: false };

  if (/less gold|quieter gold|too much gold|tone down the gold/.test(t)) return { op: "accent", delta: -0.28 };
  if (/more gold|bring (the )?gold back|stronger gold/.test(t)) return { op: "accent", delta: 0.28 };

  if (/easier to read|make the (text|ui|interface|desk) (easier|more readable)|strengthen (the )?(overlay|cards)|make the ui darker|keep the picture sharp/.test(t)) {
    return { op: "readable" };
  }
  if (/more glassy|make (the )?cards (more )?(glassy|glass)|glass(y)? cards/.test(t)) return { op: "cards", glass: true };
  if (/more solid|less glassy|solid cards/.test(t)) return { op: "cards", glass: false };
  if (/more transparent|cards more transparent|see through cards/.test(t)) return { op: "cards", glass: true, opacityDelta: -0.12 };
  if (/less transparent|cards more opaque|darker cards/.test(t)) return { op: "cards", opacityDelta: 0.12 };

  if (/focal|focus|to the left|to the right|fill the (whole )?screen/.test(t)) {
    if (/left/.test(t)) return { op: "focus", focus: "left" };
    if (/right/.test(t)) return { op: "focus", focus: "right" };
    if (/top/.test(t)) return { op: "focus", focus: "top" };
    if (/bottom/.test(t)) return { op: "focus", focus: "bottom" };
    return { op: "focus", focus: "center" };
  }

  if (/my uploaded|use my uploaded/.test(t)) return { op: "background", description: "my uploaded picture" };
  if (/use this picture|upload (a |this )?(picture|photo|image)|import (this |an )?(picture|photo|image)/.test(t)) {
    return { op: "pick", nsfw: wantsNsfw(t) };
  }

  if (/more subtle|something more subtle|use something (more )?subtle/.test(t)) {
    return { op: "background", description: "subtle", nsfw: wantsNsfw(t) };
  }
  if (/try another|another one|different (nature |adult |nsfw )?background|use a different/.test(t)) return { op: "cycle" };

  if (/see (more of )?(the )?(mountain|lake|forest|scenery|background|picture)|less overlay|too dark|make it lighter|let me see more|make the picture brighter|picture more/.test(t)) {
    return { op: "overlay", delta: -0.12 };
  }
  if (/make it( a little)? darker|increase overlay|too bright|more overlay/.test(t) && !/ui|interface|text/.test(t)) {
    return { op: "overlay", delta: 0.1 };
  }
  if (/more blur|blur (it|the background)|less blur|sharpen|too blurry|less blurry/.test(t)) {
    return /more blur/.test(t) ? { op: "readable" } : { op: "overlay", delta: -0.12 };
  }

  if (/go back to the mountain|mountain lake sunrise|put mountain lake/.test(t)) {
    return { op: "background", description: "mountain lake sunrise" };
  }
  if (wantsNsfw(t) || /adult background mode/.test(t)) {
    return { op: "background", description: t, nsfw: true };
  }
  if (/put .+ behind home|behind (the )?home|change the (home )?background/.test(t)) {
    return { op: "background", description: t };
  }
  if (!/^(generate|make me|create|draw|imagine)\b/.test(t) && /background|scenery|mountain|forest|desert|ocean|cliff|lake|sunrise|sunset|alpine|nature/.test(t)) {
    return { op: "background", description: t };
  }
  return null;
}

export function visualFromUnknown(raw: unknown): VisualTheme {
  if (!raw || typeof raw !== "object") return DEFAULT_VISUAL_THEME;
  const v = raw as Partial<VisualTheme> & { home?: Partial<PageTheme> };
  const homeIn: Partial<PageTheme> = v.home && typeof v.home === "object" ? v.home : {};
  const home: PageTheme = {
    ...DEFAULT_PAGE_THEME,
    ...homeIn,
    blur: 0,
    nsfw: Boolean(homeIn.nsfw),
    source: homeIn.source === "upload" || homeIn.source === "generated" ? homeIn.source : "bundled",
    focus: (["center", "left", "right", "top", "bottom"] as VisualFocus[]).includes(homeIn.focus as VisualFocus)
      ? (homeIn.focus as VisualFocus)
      : "center",
  };
  return {
    version: 1,
    page: "home",
    home,
    history: Array.isArray(v.history) ? v.history.filter(Boolean).map((p) => ({ ...DEFAULT_PAGE_THEME, ...p, blur: 0 as const })).slice(-HISTORY_MAX) : [],
    future: Array.isArray(v.future) ? v.future.filter(Boolean).map((p) => ({ ...DEFAULT_PAGE_THEME, ...p, blur: 0 as const })).slice(-HISTORY_MAX) : [],
    adultMode: Boolean(v.adultMode),
    hideAdultUntilUnlock: Boolean(v.hideAdultUntilUnlock),
    uploads: Array.isArray(v.uploads) ? v.uploads.filter(Boolean).slice(-12) : [],
  };
}

const STORE = "la_visual_theme_v1";

export function loadVisualThemeLocal(): VisualTheme {
  if (typeof window === "undefined") return DEFAULT_VISUAL_THEME;
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return DEFAULT_VISUAL_THEME;
    return visualFromUnknown(JSON.parse(raw));
  } catch {
    return DEFAULT_VISUAL_THEME;
  }
}

export function saveVisualThemeLocal(theme: VisualTheme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE, JSON.stringify(theme));
  } catch {
    /* quota */
  }
}

const FOCUS_POS: Record<VisualFocus, string> = {
  center: "center center",
  left: "left center",
  right: "right center",
  top: "center top",
  bottom: "center bottom",
};

export function visualCssVars(page: PageTheme): Record<string, string> {
  const gold = Math.round(page.accent * 100);
  const url = (page.backgroundUrl || "").replace(/["'\\)]/g, "");
  return {
    "--la-overlay": String(page.overlay),
    "--la-card-a": String(page.cardOpacity),
    "--la-accent": String(page.accent),
    "--la-focus": FOCUS_POS[page.focus] || "center center",
    "--la-scene-url": url ? `url("${url}")` : "none",
    "--color-gold": `color-mix(in oklab, #4a8fd4 ${gold}%, #8b909a)`,
    "--color-gold2": `color-mix(in oklab, #b8d4f0 ${gold}%, #c5c8ce)`,
  };
}

export function nsfwLocked(theme: VisualTheme, unlocked: boolean): boolean {
  return Boolean(theme.adultMode && theme.hideAdultUntilUnlock && theme.home.nsfw && !unlocked);
}

export function visibleBackgroundUrl(theme: VisualTheme, unlocked: boolean): string | null {
  if (!theme.home.backgroundUrl) return null;
  if (nsfwLocked(theme, unlocked)) return null;
  return theme.home.backgroundUrl;
}
