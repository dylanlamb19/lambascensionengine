export type CalView = "day" | "week" | "month";

const TZ = "America/Chicago";

function partsOf(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const grab = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { y: grab("year"), m: grab("month"), d: grab("day"), w: grab("weekday") };
}

export function ymdInTz(d = new Date()): string {
  const p = partsOf(d);
  return `${p.y}-${p.m}-${p.d}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = (s || "").split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function addDays(anchor: string, n: number): string {
  const d = parseYmd(anchor);
  d.setDate(d.getDate() + n);
  return ymdInTz(d);
}

export function addMonths(anchor: string, n: number): string {
  const d = parseYmd(anchor);
  d.setMonth(d.getMonth() + n);
  return ymdInTz(d);
}

export function startOfWeek(anchor: string): string {
  const d = parseYmd(anchor);
  d.setDate(d.getDate() - d.getDay());
  return ymdInTz(d);
}

export function shiftAnchor(view: CalView, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "month") return addMonths(anchor, dir);
  return addDays(startOfWeek(anchor), dir * 7);
}

export function rangeFor(view: CalView, anchor: string): { from: Date; to: Date; label: string; days: string[] } {
  if (view === "day") {
    const from = parseYmd(anchor);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to, label: formatLong(anchor), days: [anchor] };
  }
  if (view === "month") {
    const d = parseYmd(anchor);
    const from = new Date(d.getFullYear(), d.getMonth(), 1, 12);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
    const label = from.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const days: string[] = [];
    for (let x = new Date(from); x < to; x.setDate(x.getDate() + 1)) days.push(ymdInTz(x));
    return { from, to, label, days };
  }
  const start = startOfWeek(anchor);
  const from = parseYmd(start);
  const to = parseYmd(addDays(start, 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const label = `${formatShort(days[0])} – ${formatShort(days[6])}`;
  return { from, to, label, days };
}

export function formatShort(anchor: string): string {
  const d = parseYmd(anchor);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatLong(anchor: string): string {
  const d = parseYmd(anchor);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "UNKNOWN";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function hourOf(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return -1;
  const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TZ }).format(d);
  return parseInt(h, 10);
}

export function parseSpokenHour(raw: string): number | null {
  const t = (raw || "").toLowerCase();
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (h > 23) return null;
  const ap = (m[3] || "").replace(/\./g, "");
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  if (!ap && h < 7) h += 12;
  return h;
}
