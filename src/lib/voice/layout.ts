/** Home is Ara’s screen. These are the real Owner Mode blocks she can rearrange. */

export const HOME_WIDGETS = [
  "greeting",
  "hero",
  "status",
  "up_next",
  "needs_you",
  "sales",
  "connections",
  "pipeline",
] as const;

export type HomeWidget = (typeof HOME_WIDGETS)[number];

export type HomeLayout = {
  order: HomeWidget[];
  hidden: HomeWidget[];
  emphasis: HomeWidget | null;
  compact: boolean;
};

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  order: ["greeting", "hero", "status", "up_next", "needs_you"],
  hidden: ["sales", "connections", "pipeline"],
  emphasis: "hero",
  compact: true,
};

export type LayoutCommand =
  | { kind: "move"; widget: HomeWidget; place: "top" | "bottom" | "higher" | "lower"; index?: number }
  | { kind: "hide"; widget: HomeWidget }
  | { kind: "show"; widget: HomeWidget }
  | { kind: "emphasis"; widget: HomeWidget }
  | { kind: "clean" }
  | { kind: "nav_calendar" };


const ALIASES: Array<{ widget: HomeWidget; keys: string[] }> = [
  { widget: "hero", keys: ["start my tasks", "start tasks", "the big button", "hero", "main button"] },
  { widget: "sales", keys: ["sales", "sales status", "the sales card"] },
  { widget: "status", keys: ["status", "compact status", "the numbers"] },
  { widget: "up_next", keys: ["up next", "current task", "the current task"] },
  { widget: "needs_you", keys: ["needs you", "remaining tasks", "waiting on you"] },
  { widget: "greeting", keys: ["greeting", "hello", "good morning"] },
  { widget: "connections", keys: ["connections", "gmail", "connect gmail"] },
  { widget: "pipeline", keys: ["pipeline", "the pipeline"] },
];

export function widgetLabel(w: HomeWidget): string {
  switch (w) {
    case "hero": return "Start My Tasks";
    case "sales": return "Sales";
    case "status": return "status";
    case "up_next": return "Up next";
    case "needs_you": return "Needs you";
    case "greeting": return "the greeting";
    case "connections": return "Connections";
    case "pipeline": return "Pipeline";
  }
}

export function matchWidget(raw: string): HomeWidget | null {
  const t = (raw || "").toLowerCase().replace(/[_-]+/g, " ").trim();
  if ((HOME_WIDGETS as readonly string[]).includes(t)) return t as HomeWidget;
  if (t === "start my tasks" || t === "start tasks" || t === "hero") return "hero";
  for (const row of ALIASES) {
    if (row.keys.some((k) => t === k || t.includes(k))) return row.widget;
  }
  return null;
}

export function visibleOrder(layout: HomeLayout): HomeWidget[] {
  const hidden = new Set(layout.hidden);
  const seen = new Set<HomeWidget>();
  const out: HomeWidget[] = [];
  for (const w of layout.order) {
    if (hidden.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function uniqueOrder(order: HomeWidget[]): HomeWidget[] {
  const seen = new Set<HomeWidget>();
  const out: HomeWidget[] = [];
  for (const w of order) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export function applyLayoutCommand(layout: HomeLayout, cmd: LayoutCommand): { layout: HomeLayout; spoken: string } {
  if (cmd.kind === "nav_calendar") {
    return { layout, spoken: "Calendar is already in the top navigation." };
  }
  if (cmd.kind === "clean") {
    const next: HomeLayout = {
      order: ["greeting", "hero", "status", "up_next", "needs_you"],
      hidden: ["sales", "connections", "pipeline"],
      emphasis: "hero",
      compact: true,
    };
    return { layout: next, spoken: "Home is cleaner. Start My Tasks is at the top." };
  }
  if (cmd.kind === "hide") {
    if (cmd.widget === "hero" || cmd.widget === "greeting") {
      return { layout, spoken: "I need to keep that on Home so you can still run the desk." };
    }
    const hidden = [...new Set([...layout.hidden, cmd.widget])];
    return {
      layout: { ...layout, hidden },
      spoken: `Hid ${widgetLabel(cmd.widget)}.`,
    };
  }
  if (cmd.kind === "show") {
    const hidden = layout.hidden.filter((w) => w !== cmd.widget);
    const order = layout.order.includes(cmd.widget) ? layout.order : [...layout.order, cmd.widget];
    return {
      layout: { ...layout, hidden, order: uniqueOrder(order) },
      spoken: `Showing ${widgetLabel(cmd.widget)}.`,
    };
  }
  if (cmd.kind === "emphasis") {
    return {
      layout: { ...layout, emphasis: cmd.widget, compact: true },
      spoken: `Made ${widgetLabel(cmd.widget)} bigger.`,
    };
  }
  const hidden = layout.hidden.filter((w) => w !== cmd.widget);
  const vis = visibleOrder({ ...layout, hidden, order: layout.order.includes(cmd.widget) ? layout.order : [...layout.order, cmd.widget] });
  const from = vis.indexOf(cmd.widget);
  let nextVis = vis.filter((w) => w !== cmd.widget);
  const place = cmd.place || "top";
  if (place === "bottom") {
    nextVis = [...nextVis, cmd.widget];
  } else if (place === "higher") {
    const at = Math.max(0, (from < 0 ? 0 : from) - 1);
    nextVis.splice(at, 0, cmd.widget);
  } else if (place === "lower") {
    const at = Math.min(nextVis.length, (from < 0 ? nextVis.length : from) + 1);
    nextVis.splice(at, 0, cmd.widget);
  } else if (typeof cmd.index === "number") {
    nextVis.splice(Math.max(0, Math.min(nextVis.length, cmd.index)), 0, cmd.widget);
  } else {
    nextVis = [cmd.widget, ...nextVis];
  }
  return {
    layout: { ...layout, order: uniqueOrder(nextVis), hidden, emphasis: cmd.widget === "hero" ? "hero" : layout.emphasis },
    spoken: place === "top"
      ? `Moved ${widgetLabel(cmd.widget)} to the top.`
      : place === "bottom"
        ? `Moved ${widgetLabel(cmd.widget)} lower on Home.`
        : place === "higher"
          ? `Moved ${widgetLabel(cmd.widget)} up.`
          : `Moved ${widgetLabel(cmd.widget)} farther down.`,
  };
}

export function parseLayoutCommand(raw: string): LayoutCommand | null {
  const t = (raw || "")
    .toLowerCase()
    .replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "")
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  if (/move calendar into (the )?nav|calendar (in|into) (the )?navigation/.test(t)) {
    return { kind: "nav_calendar" };
  }
  if (/make (home|this) clean|cleaner home|make home cleaner/.test(t)) {
    return { kind: "clean" };
  }
  if (/^(hide|remove) /.test(t) || /hide (sales|connections|pipeline|status)/.test(t)) {
    const widget = matchWidget(t);
    if (widget) return { kind: "hide", widget };
  }
  if (/^(show|unhide|bring back) /.test(t)) {
    const widget = matchWidget(t);
    if (widget) return { kind: "show", widget };
  }
  if (/make (this|it|start my tasks|sales) bigger|make this bigger/.test(t)) {
    const widget = matchWidget(t) || "hero";
    return { kind: "emphasis", widget };
  }
  if (/put pipeline (over here|on home|here)|show pipeline on home/.test(t)) {
    return { kind: "show", widget: "pipeline" };
  }
  if (/move .+ farther down|move .+ lower|sales farther down|put .+ lower/.test(t)) {
    const widget = matchWidget(t);
    if (widget) return { kind: "move", widget, place: "lower" };
  }
  if (/move .+ (up|higher)|put .+ higher/.test(t)) {
    const widget = matchWidget(t);
    if (widget) return { kind: "move", widget, place: "higher" };
  }
  if (/move .+ to the bottom|put .+ at the bottom/.test(t)) {
    const widget = matchWidget(t);
    if (widget) return { kind: "move", widget, place: "bottom" };
  }
  if (/move .+ to the top|move .+ above everything|put .+ (at|to) the top/.test(t)) {
    const widget = matchWidget(t);
    if (widget) return { kind: "move", widget, place: "top" };
  }
  return null;
}

export function loadHomeLayout(): HomeLayout {
  if (typeof window === "undefined") return DEFAULT_HOME_LAYOUT;
  try {
    const raw = window.localStorage.getItem("la_home_layout_v2");
    if (!raw) return DEFAULT_HOME_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<HomeLayout>;
    const order = (parsed.order || DEFAULT_HOME_LAYOUT.order).filter((w): w is HomeWidget =>
      (HOME_WIDGETS as readonly string[]).includes(w),
    );
    const hidden = (parsed.hidden || DEFAULT_HOME_LAYOUT.hidden).filter((w): w is HomeWidget =>
      (HOME_WIDGETS as readonly string[]).includes(w),
    );
    return {
      order: uniqueOrder(order.length ? order : DEFAULT_HOME_LAYOUT.order),
      hidden,
      emphasis: parsed.emphasis && (HOME_WIDGETS as readonly string[]).includes(parsed.emphasis) ? parsed.emphasis : "hero",
      compact: parsed.compact !== false,
    };
  } catch {
    return DEFAULT_HOME_LAYOUT;
  }
}

export function saveHomeLayout(layout: HomeLayout) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("la_home_layout_v2", JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}
