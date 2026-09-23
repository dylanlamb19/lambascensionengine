export type AraTurn = {
  id: string;
  role: "you" | "ara";
  text: string;
  at: number;
};

export type AraThread = {
  id: string;
  title: string;
  updatedAt: number;
  turns: AraTurn[];
};

export type AraLog = {
  activeId: string | null;
  threads: AraThread[];
};

export type AraHit = {
  threadId: string;
  turnId: string;
  title: string;
  role: AraTurn["role"];
  snippet: string;
  at: number;
};

const GAP_MS = 45 * 60 * 1000;
const DEDUPE_MS = 12_000;
const MAX_THREADS = 40;
const MAX_TURNS = 200;

export function emptyAraLog(): AraLog {
  return { activeId: null, threads: [] };
}

function uid(): string {
  return `ara_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromTurn(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 42) return clean;
  return `${clean.slice(0, 41).trim()}…`;
}

export function appendAraTurn(log: AraLog, role: AraTurn["role"], text: string, now = Date.now()): AraLog {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return log;
  const threads = log.threads.map((t) => ({ ...t, turns: t.turns.slice() }));
  let active = threads.find((t) => t.id === log.activeId) || null;
  const last = active?.turns[active.turns.length - 1];
  if (last && last.role === role && last.text === clean && now - last.at < DEDUPE_MS) return log;
  const stale = !active || (role === "you" && active.turns.length > 0 && now - active.updatedAt > GAP_MS);
  if (stale || !active) {
    active = {
      id: uid(),
      title: role === "you" ? titleFromTurn(clean) : "Ara",
      updatedAt: now,
      turns: [],
    };
    threads.unshift(active);
  }
  if (role === "you" && (active.turns.length === 0 || active.title === "Ara")) {
    active.title = titleFromTurn(clean);
  }
  active.turns.push({ id: uid(), role, text: clean, at: now });
  if (active.turns.length > MAX_TURNS) active.turns = active.turns.slice(-MAX_TURNS);
  active.updatedAt = now;
  const next = threads
    .map((t) => (t.id === active!.id ? active! : t))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS);
  return { activeId: active.id, threads: next };
}

export function startAraThread(log: AraLog, now = Date.now()): AraLog {
  const current = log.threads.find((t) => t.id === log.activeId);
  if (current && current.turns.length === 0) return log;
  const thread: AraThread = { id: uid(), title: "New conversation", updatedAt: now, turns: [] };
  return { activeId: thread.id, threads: [thread, ...log.threads].slice(0, MAX_THREADS) };
}

function snippet(text: string, term: string): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(term.toLowerCase());
  const start = Math.max(0, at < 0 ? 0 : at - 28);
  const slice = text.slice(start, start + 90).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + 90 < text.length ? "…" : ""}`;
}

export function searchAraLog(log: AraLog, query: string): AraHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: AraHit[] = [];
  for (const thread of log.threads) {
    const title = thread.title.toLowerCase();
    if (terms.every((term) => title.includes(term))) {
      const first = thread.turns[0];
      hits.push({
        threadId: thread.id,
        turnId: first?.id || thread.id,
        title: thread.title,
        role: "you",
        snippet: thread.title,
        at: thread.updatedAt,
      });
    }
    for (const turn of thread.turns) {
      const hay = turn.text.toLowerCase();
      if (!terms.every((term) => hay.includes(term))) continue;
      hits.push({
        threadId: thread.id,
        turnId: turn.id,
        title: thread.title,
        role: turn.role,
        snippet: snippet(turn.text, terms[0]),
        at: turn.at,
      });
    }
  }
  hits.sort((a, b) => b.at - a.at);
  return hits.slice(0, 40);
}

const KEY_PREFIX = "lasc.ara.chats.v1";

export function araLogKey(userId?: string | null): string {
  return `${KEY_PREFIX}:${userId || "local"}`;
}

export function loadAraLog(userId?: string | null): AraLog {
  if (typeof localStorage === "undefined") return emptyAraLog();
  try {
    const raw = localStorage.getItem(araLogKey(userId));
    if (!raw) return emptyAraLog();
    const parsed = JSON.parse(raw) as AraLog;
    if (!parsed || !Array.isArray(parsed.threads)) return emptyAraLog();
    return {
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      threads: parsed.threads.filter((t) => t && typeof t.id === "string" && Array.isArray(t.turns)),
    };
  } catch {
    return emptyAraLog();
  }
}

export function saveAraLog(userId: string | null | undefined, log: AraLog): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(araLogKey(userId), JSON.stringify(log));
  } catch {
    /* full storage should not break the desk */
  }
}
