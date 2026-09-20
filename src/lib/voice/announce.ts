export type AnnouncePriority =
  | "BLOCKER"
  | "ERROR"
  | "WARNING"
  | "INFO"
  | "SUCCESS"
  | "TASK"
  | "REPLY"
  | "NAVIGATION";

export type AnnounceEvent = {
  type: AnnouncePriority;
  text: string;
  spoken?: string;
  view?: string;
  action?: string;
  dedupeKey: string;
};

const recent = new Map<string, number>();
const DEDUPE_MS = 30_000;

export function resetAnnounceDedupe(): void {
  recent.clear();
}

export function shouldAnnounce(ev: Pick<AnnounceEvent, "dedupeKey" | "text">, now = Date.now()): boolean {
  const text = (ev.text || "").trim();
  if (!text) return false;
  const last = recent.get(ev.dedupeKey) || 0;
  if (last > 0 && now - last < DEDUPE_MS) return false;
  recent.set(ev.dedupeKey, now);
  return true;
}

/** Returns the event when it should be spoken; otherwise null (duplicate / empty). */
export function announceToAra(ev: AnnounceEvent, now = Date.now()): AnnounceEvent | null {
  const text = (ev.spoken || ev.text || "").trim();
  if (!text) return null;
  if (!shouldAnnounce({ dedupeKey: ev.dedupeKey, text }, now)) return null;
  return { ...ev, text, spoken: text };
}

export function announceSource(type: AnnouncePriority): "BLOCKER" | "ERROR" | "WARNING" | "TASK" | "NAVIGATION" | "SCREEN_READER" {
  if (type === "BLOCKER") return "BLOCKER";
  if (type === "ERROR") return "ERROR";
  if (type === "WARNING") return "WARNING";
  if (type === "TASK" || type === "REPLY") return "TASK";
  if (type === "NAVIGATION") return "NAVIGATION";
  return "SCREEN_READER";
}
