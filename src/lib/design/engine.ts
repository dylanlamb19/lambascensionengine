import {
  applyLayoutCommand,
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGETS,
  matchWidget,
  visibleOrder,
  widgetLabel,
  type HomeLayout,
  type HomeWidget,
} from "../voice/layout.ts";
import {
  applyVisualCommand,
  DEFAULT_VISUAL_THEME,
  visualFromUnknown,
  type VisualTheme,
} from "../visual/theme.ts";
import {
  DEFAULT_CHROME,
  DESIGN_COMPONENTS,
  type ComponentSize,
  type DesignActor,
  type DesignApplyRequest,
  type DesignChange,
  type DesignChrome,
  type DesignComponent,
  type DesignDocument,
  type DesignHistoryState,
  type DesignOp,
  type DesignOpResult,
  type DesignViewport,
  type SafeDesignSnapshot,
  type ViewportPatch,
} from "./types.ts";
import { designOpBlocked } from "./guard.ts";

export type { DesignHistoryState, DesignDocument, DesignOp } from "./types.ts";

const HISTORY_MAX = 24;
const STORE = "la_design_v1";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function cloneLayout(layout: HomeLayout): HomeLayout {
  return {
    order: [...layout.order],
    hidden: [...layout.hidden],
    emphasis: layout.emphasis,
    compact: layout.compact,
  };
}

function cloneChrome(chrome: DesignChrome): DesignChrome {
  return {
    araScale: chrome.araScale,
    typeScale: chrome.typeScale,
    spacingScale: chrome.spacingScale,
    mainWidth: chrome.mainWidth,
    widgetSize: { ...chrome.widgetSize },
  };
}

function clonePatch(patch: ViewportPatch): ViewportPatch {
  return {
    layout: patch.layout ? cloneLayout({ ...DEFAULT_HOME_LAYOUT, ...patch.layout }) : undefined,
    chrome: patch.chrome ? { ...cloneChrome(DEFAULT_CHROME), ...patch.chrome, widgetSize: { ...DEFAULT_CHROME.widgetSize, ...(patch.chrome.widgetSize || {}) } } : undefined,
  };
}

export function cloneDesign(doc: DesignDocument): DesignDocument {
  return {
    version: 1,
    visual: visualFromUnknown(doc.visual),
    layout: cloneLayout(doc.layout || DEFAULT_HOME_LAYOUT),
    chrome: cloneChrome(doc.chrome || DEFAULT_CHROME),
    mobile: clonePatch(doc.mobile || {}),
    desktop: clonePatch(doc.desktop || {}),
  };
}

export function emptyHistory(baseline?: DesignDocument | null): DesignHistoryState {
  return { past: [], future: [], baseline: baseline ? cloneDesign(baseline) : null };
}

export function designFromParts(
  visual: VisualTheme = DEFAULT_VISUAL_THEME,
  layout: HomeLayout = DEFAULT_HOME_LAYOUT,
  extra?: Partial<DesignDocument>,
): DesignDocument {
  return {
    version: 1,
    visual: visualFromUnknown(visual),
    layout: cloneLayout(layout),
    chrome: cloneChrome(extra?.chrome || DEFAULT_CHROME),
    mobile: clonePatch(extra?.mobile || {}),
    desktop: clonePatch(extra?.desktop || {}),
  };
}

export function designFromUnknown(raw: unknown): DesignDocument {
  if (!raw || typeof raw !== "object") return designFromParts();
  const v = raw as Partial<DesignDocument>;
  return designFromParts(v.visual, v.layout, {
    chrome: v.chrome,
    mobile: v.mobile,
    desktop: v.desktop,
  });
}

export function matchDesignComponent(raw: string): DesignComponent | null {
  const t = (raw || "").toLowerCase().replace(/[_-]+/g, " ").trim();
  if (!t) return null;
  if (t === "ara" || t === "voice bar" || t === "conversation bar") return "ara";
  if (t === "current task" || t === "up next" || t === "the current task") return "up_next";
  if (t === "revenue" || t === "sales summary" || t === "sales") return "sales";
  if (t === "start my tasks" || t === "hero") return "hero";
  const widget = matchWidget(t);
  if (widget && (DESIGN_COMPONENTS as readonly string[]).includes(widget)) return widget;
  if ((DESIGN_COMPONENTS as readonly string[]).includes(t.replace(/\s+/g, "_"))) {
    return t.replace(/\s+/g, "_") as DesignComponent;
  }
  return null;
}

function componentToWidget(c: DesignComponent): HomeWidget | null {
  if (c === "ara") return null;
  return c;
}

function mergeLayout(base: HomeLayout, patch?: Partial<HomeLayout>): HomeLayout {
  if (!patch) return cloneLayout(base);
  return {
    order: patch.order ? [...patch.order] : [...base.order],
    hidden: patch.hidden ? [...patch.hidden] : [...base.hidden],
    emphasis: patch.emphasis !== undefined ? patch.emphasis : base.emphasis,
    compact: patch.compact !== undefined ? patch.compact : base.compact,
  };
}

function mergeChrome(base: DesignChrome, patch?: Partial<DesignChrome>): DesignChrome {
  if (!patch) return cloneChrome(base);
  return {
    araScale: patch.araScale ?? base.araScale,
    typeScale: patch.typeScale ?? base.typeScale,
    spacingScale: patch.spacingScale ?? base.spacingScale,
    mainWidth: patch.mainWidth ?? base.mainWidth,
    widgetSize: { ...base.widgetSize, ...(patch.widgetSize || {}) },
  };
}

export function resolveDesign(doc: DesignDocument, viewport: "mobile" | "desktop"): {
  visual: VisualTheme;
  layout: HomeLayout;
  chrome: DesignChrome;
} {
  const patch = viewport === "mobile" ? doc.mobile : doc.desktop;
  return {
    visual: doc.visual,
    layout: mergeLayout(doc.layout, patch.layout),
    chrome: mergeChrome(doc.chrome, patch.chrome),
  };
}

function writeLayout(doc: DesignDocument, layout: HomeLayout, viewport: DesignViewport): DesignDocument {
  const next = cloneDesign(doc);
  if (viewport === "mobile") next.mobile = { ...next.mobile, layout: cloneLayout(layout) };
  else if (viewport === "desktop") next.desktop = { ...next.desktop, layout: cloneLayout(layout) };
  else next.layout = cloneLayout(layout);
  return next;
}

function writeChrome(doc: DesignDocument, chrome: DesignChrome, viewport: DesignViewport): DesignDocument {
  const next = cloneDesign(doc);
  if (viewport === "mobile") next.mobile = { ...next.mobile, chrome: cloneChrome(chrome) };
  else if (viewport === "desktop") next.desktop = { ...next.desktop, chrome: cloneChrome(chrome) };
  else next.chrome = cloneChrome(chrome);
  return next;
}

function layoutFor(doc: DesignDocument, viewport: DesignViewport): HomeLayout {
  if (viewport === "mobile") return mergeLayout(doc.layout, doc.mobile.layout);
  if (viewport === "desktop") return mergeLayout(doc.layout, doc.desktop.layout);
  return cloneLayout(doc.layout);
}

function chromeFor(doc: DesignDocument, viewport: DesignViewport): DesignChrome {
  if (viewport === "mobile") return mergeChrome(doc.chrome, doc.mobile.chrome);
  if (viewport === "desktop") return mergeChrome(doc.chrome, doc.desktop.chrome);
  return cloneChrome(doc.chrome);
}

function applyOne(doc: DesignDocument, op: DesignOp): { doc: DesignDocument; result: DesignOpResult } {
  const blocked = designOpBlocked(op);
  if (blocked) {
    return { doc, result: { op: op.op, ok: false, blocked: true, reason: blocked, spoken: blocked } };
  }
  const viewport: DesignViewport = "viewport" in op && op.viewport ? op.viewport : "global";

  if (op.op === "move_component") {
    const widget = componentToWidget(op.component);
    if (!widget) {
      return { doc, result: { op: op.op, ok: false, blocked: true, reason: "Ara’s bar is not a Home block.", spoken: "Ara’s bar stays in the header. I can make it smaller or larger instead." } };
    }
    const hit = applyLayoutCommand(layoutFor(doc, viewport), { kind: "move", widget, place: op.position, index: op.index });
    return { doc: writeLayout(doc, hit.layout, viewport), result: { op: op.op, ok: true, blocked: false, spoken: hit.spoken } };
  }
  if (op.op === "hide_component") {
    const widget = componentToWidget(op.component);
    if (!widget) {
      return { doc, result: { op: op.op, ok: false, blocked: true, reason: "Ara is required.", spoken: "Ara stays on screen. I can make her smaller." } };
    }
    const hit = applyLayoutCommand(layoutFor(doc, viewport), { kind: "hide", widget });
    const blockedHide = widget === "hero" || widget === "greeting";
    return {
      doc: blockedHide ? doc : writeLayout(doc, hit.layout, viewport),
      result: { op: op.op, ok: !blockedHide, blocked: blockedHide, reason: blockedHide ? hit.spoken : undefined, spoken: hit.spoken },
    };
  }
  if (op.op === "show_component") {
    const widget = componentToWidget(op.component);
    if (!widget) return { doc, result: { op: op.op, ok: true, blocked: false, spoken: "Ara is already on screen." } };
    const hit = applyLayoutCommand(layoutFor(doc, viewport), { kind: "show", widget });
    return { doc: writeLayout(doc, hit.layout, viewport), result: { op: op.op, ok: true, blocked: false, spoken: hit.spoken } };
  }
  if (op.op === "emphasize_component") {
    const widget = componentToWidget(op.component);
    if (!widget) {
      return applyOne(doc, { op: "set_ara_scale", scale: 1.12, viewport });
    }
    const hit = applyLayoutCommand(layoutFor(doc, viewport), { kind: "emphasis", widget });
    const chrome = chromeFor(doc, viewport);
    chrome.widgetSize = { ...chrome.widgetSize, [widget]: "l" };
    let next = writeLayout(doc, hit.layout, viewport);
    next = writeChrome(next, chrome, viewport);
    return { doc: next, result: { op: op.op, ok: true, blocked: false, spoken: hit.spoken } };
  }
  if (op.op === "resize_component") {
    if (op.component === "ara") {
      const scale = op.size === "s" ? 0.82 : op.size === "m" ? 1 : op.size === "l" ? 1.12 : 1.22;
      return applyOne(doc, { op: "set_ara_scale", scale, viewport });
    }
    const widget = componentToWidget(op.component)!;
    const chrome = chromeFor(doc, viewport);
    chrome.widgetSize = { ...chrome.widgetSize, [widget]: op.size };
    let next = writeChrome(doc, chrome, viewport);
    if (op.size === "l" || op.size === "xl") {
      const hit = applyLayoutCommand(layoutFor(next, viewport), { kind: "emphasis", widget });
      next = writeLayout(next, hit.layout, viewport);
    }
    return { doc: next, result: { op: op.op, ok: true, blocked: false, spoken: `Made ${widgetLabel(widget)} ${op.size === "s" ? "smaller" : "larger"}.` } };
  }
  if (op.op === "set_spacing") {
    let next = doc;
    if (op.density) {
      const vis = applyVisualCommand(next.visual, { op: "density", density: op.density });
      next = { ...cloneDesign(next), visual: vis.theme };
    }
    if (op.scale != null) {
      const chrome = chromeFor(next, viewport);
      chrome.spacingScale = clamp(op.scale, 0.72, 1.4);
      next = writeChrome(next, chrome, viewport);
    }
    return { doc: next, result: { op: op.op, ok: true, blocked: false, spoken: "Updated spacing." } };
  }
  if (op.op === "set_typography") {
    const chrome = chromeFor(doc, viewport);
    chrome.typeScale = clamp(op.scale, 0.85, 1.35);
    return { doc: writeChrome(doc, chrome, viewport), result: { op: op.op, ok: true, blocked: false, spoken: chrome.typeScale > 1 ? "Made the text a little bigger." : "Made the text a little smaller." } };
  }
  if (op.op === "set_background") {
    const vis = applyVisualCommand(doc.visual, { op: "background", scene: op.scene, description: op.description });
    return { doc: { ...cloneDesign(doc), visual: vis.theme }, result: { op: op.op, ok: true, blocked: false, spoken: vis.spoken } };
  }
  if (op.op === "set_background_overlay") {
    const vis = applyVisualCommand(doc.visual, { op: "overlay", amount: op.amount, delta: op.delta });
    return { doc: { ...cloneDesign(doc), visual: vis.theme }, result: { op: op.op, ok: true, blocked: false, spoken: vis.spoken } };
  }
  if (op.op === "set_card_style") {
    const vis = applyVisualCommand(doc.visual, { op: "cards", glass: op.glass, opacity: op.opacity });
    return { doc: { ...cloneDesign(doc), visual: vis.theme }, result: { op: op.op, ok: true, blocked: false, spoken: vis.spoken } };
  }
  if (op.op === "set_accent_color") {
    const vis = applyVisualCommand(doc.visual, { op: "accent", amount: op.amount, delta: op.delta });
    return { doc: { ...cloneDesign(doc), visual: vis.theme }, result: { op: op.op, ok: true, blocked: false, spoken: vis.spoken } };
  }
  if (op.op === "set_visual_density") {
    const vis = applyVisualCommand(doc.visual, { op: "density", density: op.density });
    return { doc: { ...cloneDesign(doc), visual: vis.theme }, result: { op: op.op, ok: true, blocked: false, spoken: vis.spoken } };
  }
  if (op.op === "set_ara_scale") {
    const chrome = chromeFor(doc, viewport);
    chrome.araScale = clamp(op.scale, 0.7, 1.35);
    return { doc: writeChrome(doc, chrome, viewport), result: { op: op.op, ok: true, blocked: false, spoken: chrome.araScale < 1 ? "Made Ara a little smaller." : "Made Ara a little larger." } };
  }
  if (op.op === "set_main_width") {
    const chrome = chromeFor(doc, viewport);
    chrome.mainWidth = op.width;
    return { doc: writeChrome(doc, chrome, viewport), result: { op: op.op, ok: true, blocked: false, spoken: op.width === "wide" ? "Gave the layout more width." : op.width === "narrow" ? "Narrowed the layout." : "Restored the default width." } };
  }
  if (op.op === "apply_layout") {
    const cur = layoutFor(doc, viewport);
    const order = (op.order || cur.order).filter((w): w is HomeWidget => (HOME_WIDGETS as readonly string[]).includes(w));
    const hidden = (op.hidden || cur.hidden).filter((w): w is HomeWidget => (HOME_WIDGETS as readonly string[]).includes(w));
    const nextLayout: HomeLayout = {
      order: order.length ? order : cur.order,
      hidden,
      emphasis: op.emphasis === undefined ? cur.emphasis : op.emphasis,
      compact: cur.compact,
    };
    return { doc: writeLayout(doc, nextLayout, viewport), result: { op: op.op, ok: true, blocked: false, spoken: "Applied the new Home layout." } };
  }
  if (op.op === "reset_design") {
    return { doc: designFromParts(), result: { op: op.op, ok: true, blocked: false, spoken: "Reset Home to the default Lamb Ascension look." } };
  }
  return { doc, result: { op: op.op, ok: false, blocked: true, reason: "Unknown design operation.", spoken: "I can’t run that design change." } };
}

function newChange(actor: DesignActor, ops: DesignOp[], previous: DesignDocument, resulting: DesignDocument, spoken: string): DesignChange {
  return {
    id: `chg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    actor,
    ops,
    previous: cloneDesign(previous),
    resulting: cloneDesign(resulting),
    spoken,
  };
}

export function applyDesignOps(
  doc: DesignDocument,
  history: DesignHistoryState,
  request: DesignApplyRequest,
): {
  doc: DesignDocument;
  history: DesignHistoryState;
  results: DesignOpResult[];
  spoken: string;
  preview: boolean;
  changed: boolean;
} {
  const actor = request.actor || "ARA";
  const preview = Boolean(request.preview);
  const defaultVp = request.viewport;
  const ops = (request.operations || []).map((op) => {
    if (!defaultVp || defaultVp === "global") return op;
    if (op.op === "undo_design_change" || op.op === "redo_design_change" || op.op === "restore_baseline" || op.op === "reset_design") return op;
    if ("viewport" in op && op.viewport) return op;
    return { ...op, viewport: defaultVp };
  });
  let next = cloneDesign(doc);
  const results: DesignOpResult[] = [];

  for (const op of ops) {
    if (op.op === "undo_design_change") {
      const last = history.past[history.past.length - 1];
      if (!last) {
        results.push({ op: op.op, ok: false, blocked: false, spoken: "Nothing to undo." });
        continue;
      }
      next = cloneDesign(last.previous);
      history = {
        past: history.past.slice(0, -1),
        future: [last, ...history.future].slice(0, HISTORY_MAX),
        baseline: history.baseline,
      };
      results.push({ op: op.op, ok: true, blocked: false, spoken: "Undid the last design change." });
      continue;
    }
    if (op.op === "redo_design_change") {
      const nxt = history.future[0];
      if (!nxt) {
        results.push({ op: op.op, ok: false, blocked: false, spoken: "Nothing to redo." });
        continue;
      }
      next = cloneDesign(nxt.resulting);
      history = {
        past: [...history.past, nxt].slice(-HISTORY_MAX),
        future: history.future.slice(1),
        baseline: history.baseline,
      };
      results.push({ op: op.op, ok: true, blocked: false, spoken: "Redid that design change." });
      continue;
    }
    if (op.op === "restore_baseline") {
      if (!history.baseline) {
        results.push({ op: op.op, ok: false, blocked: false, spoken: "I don’t have the look from before this design session." });
        continue;
      }
      const previous = cloneDesign(next);
      next = cloneDesign(history.baseline);
      if (!preview) {
        history = {
          past: [...history.past, newChange(actor, [op], previous, next, "Put it back how it was before we started designing.")].slice(-HISTORY_MAX),
          future: [],
          baseline: history.baseline,
        };
      }
      results.push({ op: op.op, ok: true, blocked: false, spoken: "Put it back how it was before we started designing." });
      continue;
    }
    const hit = applyOne(next, op);
    next = hit.doc;
    results.push(hit.result);
  }

  const applied = results.filter((r) => r.ok && !r.blocked);
  const spoken = applied.length
    ? applied.map((r) => r.spoken).filter(Boolean).slice(0, 3).join(" ")
    : results[0]?.spoken || "No design change.";
  const changed = JSON.stringify(next) !== JSON.stringify(doc);
  if (changed && !preview && applied.length && !ops.some((o) => o.op === "undo_design_change" || o.op === "redo_design_change" || o.op === "restore_baseline")) {
    const change = newChange(actor, ops, doc, next, spoken);
    history = {
      past: [...history.past, change].slice(-HISTORY_MAX),
      future: [],
      baseline: history.baseline || cloneDesign(doc),
    };
  }
  return { doc: next, history, results, spoken, preview, changed };
}

export function undoLastByActor(
  doc: DesignDocument,
  history: DesignHistoryState,
  actor: DesignActor,
): ReturnType<typeof applyDesignOps> {
  const last = [...history.past].reverse().find((c) => c.actor === actor);
  if (!last) {
    return {
      doc,
      history,
      results: [{ op: "undo_design_change", ok: false, blocked: false, spoken: "ChatGPT hasn’t changed the design yet." }],
      spoken: "ChatGPT hasn’t changed the design yet.",
      preview: false,
      changed: false,
    };
  }
  return applyDesignOps(doc, history, { operations: [{ op: "undo_design_change" }], actor: "DYLAN" });
}

export function isMajorDesign(ops: DesignOp[]): boolean {
  if (ops.length >= 4) return true;
  return ops.some((o) => o.op === "apply_layout" || o.op === "reset_design");
}

export function safeSnapshot(
  doc: DesignDocument,
  viewport: "mobile" | "desktop",
  selected: DesignComponent | null = null,
): SafeDesignSnapshot {
  const resolved = resolveDesign(doc, viewport);
  const vis = visibleOrder(resolved.layout);
  const hidden = new Set(resolved.layout.hidden);
  const components: SafeDesignSnapshot["components"] = DESIGN_COMPONENTS.map((id) => {
    if (id === "ara") {
      return {
        id,
        name: "Ara",
        visible: true,
        position: null,
        size: resolved.chrome.araScale < 0.92 ? "s" : resolved.chrome.araScale > 1.08 ? "l" : "m",
        emphasized: false,
      };
    }
    const widget = id as HomeWidget;
    const ix = vis.indexOf(widget);
    return {
      id,
      name: widgetLabel(widget),
      visible: ix >= 0 && !hidden.has(widget),
      position: ix >= 0 ? ix : null,
      size: resolved.chrome.widgetSize[widget] || "default",
      emphasized: resolved.layout.emphasis === widget,
    };
  });
  return {
    screen: "HOME",
    viewport,
    breakpoint: viewport === "mobile" ? "<720px" : ">=720px",
    components,
    theme: {
      background: resolved.visual.home.backgroundLabel,
      overlay: resolved.visual.home.overlay,
      cardOpacity: resolved.visual.home.cardOpacity,
      cardGlass: resolved.visual.home.cardGlass,
      accent: resolved.visual.home.accent,
      density: resolved.visual.home.density,
    },
    chrome: resolved.chrome,
    selectedComponent: selected,
  };
}

export function parseDesignOp(raw: unknown): DesignOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = String(o.op || o.action || "").trim();
  const component = matchDesignComponent(String(o.component || o.widget || ""));
  const viewport = o.viewport === "mobile" || o.viewport === "desktop" || o.viewport === "global" ? o.viewport : undefined;
  const size = o.size === "s" || o.size === "m" || o.size === "l" || o.size === "xl" ? o.size : undefined;
  if (op === "move_component" && component) {
    const position = o.position === "bottom" || o.position === "higher" || o.position === "lower" || o.position === "top"
      ? o.position
      : "top";
    return { op: "move_component", component, position, index: typeof o.index === "number" ? o.index : undefined, viewport };
  }
  if (op === "resize_component" && component && size) return { op: "resize_component", component, size, viewport };
  if (op === "hide_component" && component) return { op: "hide_component", component, viewport };
  if (op === "show_component" && component) return { op: "show_component", component, viewport };
  if (op === "emphasize_component" && component) return { op: "emphasize_component", component, viewport };
  if (op === "set_spacing") {
    return {
      op: "set_spacing",
      density: o.density === "compact" || o.density === "comfortable" ? o.density : undefined,
      scale: typeof o.scale === "number" ? o.scale : undefined,
      viewport,
    };
  }
  if (op === "set_typography" && typeof o.scale === "number") return { op: "set_typography", scale: o.scale, viewport };
  if (op === "set_background") return { op: "set_background", scene: o.scene ? String(o.scene) : undefined, description: o.description ? String(o.description) : undefined };
  if (op === "set_background_overlay") {
    return { op: "set_background_overlay", amount: typeof o.amount === "number" ? o.amount : undefined, delta: typeof o.delta === "number" ? o.delta : undefined };
  }
  if (op === "set_card_style") {
    return { op: "set_card_style", glass: typeof o.glass === "boolean" ? o.glass : undefined, opacity: typeof o.opacity === "number" ? o.opacity : undefined };
  }
  if (op === "set_accent_color") {
    return { op: "set_accent_color", amount: typeof o.amount === "number" ? o.amount : undefined, delta: typeof o.delta === "number" ? o.delta : undefined };
  }
  if (op === "set_visual_density" && (o.density === "compact" || o.density === "comfortable")) {
    return { op: "set_visual_density", density: o.density };
  }
  if (op === "set_ara_scale" && typeof o.scale === "number") return { op: "set_ara_scale", scale: o.scale, viewport };
  if (op === "set_main_width" && (o.width === "narrow" || o.width === "default" || o.width === "wide")) {
    return { op: "set_main_width", width: o.width, viewport };
  }
  if (op === "apply_layout") {
    const order = Array.isArray(o.order) ? o.order.filter((w): w is HomeWidget => typeof w === "string" && (HOME_WIDGETS as readonly string[]).includes(w)) : undefined;
    const hidden = Array.isArray(o.hidden) ? o.hidden.filter((w): w is HomeWidget => typeof w === "string" && (HOME_WIDGETS as readonly string[]).includes(w)) : undefined;
    const emphasis = o.emphasis == null ? undefined : matchWidget(String(o.emphasis));
    return { op: "apply_layout", order, hidden, emphasis: emphasis ?? null, viewport };
  }
  if (op === "undo_design_change" || op === "redo_design_change" || op === "reset_design" || op === "restore_baseline") {
    return { op };
  }
  return null;
}

export function parseDesignOps(raw: unknown): DesignOp[] {
  if (!Array.isArray(raw)) {
    const one = parseDesignOp(raw);
    return one ? [one] : [];
  }
  return raw.map(parseDesignOp).filter((o): o is DesignOp => Boolean(o));
}

export function isDesignDirectorUtterance(raw: string): boolean {
  const t = (raw || "").toLowerCase().replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "").trim();
  if (!t) return false;
  if (/^chatgpt\b/.test(t)) return true;
  if (/design director/.test(t)) return true;
  if (/stop changing the (design|layout|look|ui)/.test(t)) return true;
  if (/pause (the )?design/.test(t)) return true;
  if (/undo what chatgpt/.test(t)) return true;
  if (/before we started designing/.test(t)) return true;
  return false;
}

export function designCssVars(chrome: DesignChrome): Record<string, string> {
  return {
    "--la-type-scale": String(chrome.typeScale),
    "--la-space-scale": String(chrome.spacingScale),
    "--la-ara-scale": String(chrome.araScale),
  };
}

export function loadDesignLocal(): DesignDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return null;
    return designFromUnknown(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDesignLocal(doc: DesignDocument): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE, JSON.stringify(doc));
  } catch {
    /* quota */
  }
}

export function detectViewport(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "mobile";
  return window.matchMedia("(max-width: 719px)").matches ? "mobile" : "desktop";
}
