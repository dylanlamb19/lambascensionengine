import type { AraLog, AraTurn } from "./ara-history.ts";
import { appendAraTurn, emptyAraLog } from "./ara-history.ts";

export type MemoryAsk =
  | { kind: "last_ara" }
  | { kind: "last_user" }
  | { kind: "ara_before" }
  | { kind: "recent_ara"; n: number }
  | { kind: "topic" }
  | { kind: "can_read" };

export type UtteranceMark = { itemId: string; text: string; at: number };

const REPLAY_MS = 20_000;

export function shouldPersistTranscript(isFinal: boolean): boolean {
  return isFinal === true;
}

export function classifyMemoryAsk(text: string): MemoryAsk | null {
  const q = (text || "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[?.!]+$/g, "");
  if (!q) return null;
  if (/what did you just add|what am i looking at|what is on (this )?screen|explain this screen/.test(q)) return null;
  const recent = q.match(/repeat your last (\d+) messages?/);
  if (recent) return { kind: "recent_ara", n: Math.min(5, Math.max(1, Number(recent[1]))) };
  if (/what did you say before that|go back to what you said/.test(q)) return { kind: "ara_before" };
  if (/what did you just (say|tell me)|repeat what you (just )?said|show me (what you just said|your last message)|your last message/.test(q)) return { kind: "last_ara" };
  if (/what did i just (say|tell you|ask)|what did i just ask you/.test(q)) return { kind: "last_user" };
  if (/what were we just talking about|what were we talking about/.test(q)) return { kind: "topic" };
  if (/read (our |the )?ara conversation|conversations box|saved ara conversation|can you not read the conversation/.test(q)) return { kind: "can_read" };
  return null;
}

export function memoryAskClearsPending(_ask: MemoryAsk | null): boolean {
  return false;
}

function turns(log: AraLog): AraTurn[] {
  const thread = log.threads.find((t) => t.id === log.activeId) || log.threads[0];
  return thread?.turns || [];
}

function prior(log: AraLog, currentText: string): AraTurn[] {
  const all = turns(log);
  const clean = currentText.replace(/\s+/g, " ").trim();
  const last = all[all.length - 1];
  if (last && last.role === "you" && last.text === clean) return all.slice(0, -1);
  return all;
}

export function answerMemory(log: AraLog, ask: MemoryAsk, currentText = ""): { ok: boolean; text: string; action: string } {
  const history = prior(log, currentText);
  const ara = history.filter((t) => t.role === "ara");
  const you = history.filter((t) => t.role === "you");
  if (ask.kind === "last_ara" || ask.kind === "can_read") {
    const last = ara[ara.length - 1];
    if (!last) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn’t retrieve the previous Ara message." };
    if (ask.kind === "can_read") {
      return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `I can access the saved Ara conversation. The last thing I said was: ${last.text}` };
    }
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: last.text };
  }
  if (ask.kind === "last_user") {
    const last = you[you.length - 1];
    if (!last) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn’t retrieve your previous message." };
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `You said: ${last.text}` };
  }
  if (ask.kind === "ara_before") {
    const last = ara[ara.length - 2];
    if (!last) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn’t retrieve the Ara message before that." };
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: last.text };
  }
  if (ask.kind === "recent_ara") {
    const slice = ara.slice(-ask.n);
    if (!slice.length) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn’t retrieve the previous Ara messages." };
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: slice.map((t) => t.text).join(" ") };
  }
  const bits = history.slice(-6).map((t) => `${t.role === "you" ? "You" : "I"}: ${t.text}`);
  if (!bits.length) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn’t retrieve the previous conversation." };
  return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `We were just talking about this. ${bits.join(" ")}` };
}

export function conversationContext(log: AraLog, limit = 24): { summary: string; recent: string } {
  const all = turns(log);
  const recentTurns = all.slice(-limit);
  const older = all.slice(0, Math.max(0, all.length - limit));
  const summary = older
    .filter((t) => t.role === "you" || t.role === "ara")
    .slice(-8)
    .map((t) => `${t.role === "you" ? "Dylan" : "Ara"}: ${t.text.slice(0, 140)}`)
    .join(" | ")
    .slice(0, 700);
  const recent = recentTurns
    .map((t) => `${t.role === "you" ? "USER" : "ARA"}: ${t.text.slice(0, 500)}`)
    .join("\n")
    .slice(0, 4000);
  return { summary, recent };
}

export function historyInstruction(log: AraLog): string {
  const { summary, recent } = conversationContext(log);
  return [
    "CONVERSATION HISTORY is the saved Ara thread for this owner. It is not the current page and not a screen reading.",
    "If Dylan asks what you just said, what he just said, or what you were talking about, answer only from CONVERSATION HISTORY. Do not answer with the company on screen.",
    "You cannot see the Conversations box or read the screen. You can use the saved conversation history included here.",
    "If that history does not contain the message, say you couldn’t retrieve it. Do not invent it.",
    summary ? `OLDER SUMMARY: ${summary}` : "OLDER SUMMARY: none.",
    recent ? `RECENT TURNS:\n${recent}` : "RECENT TURNS: none saved.",
  ].join("\n");
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function foldFinalUserTurn(
  log: AraLog,
  text: string,
  itemId: string,
  now: number,
  last: UtteranceMark | null,
): { log: AraLog; action: "new" | "replace" | "replay" | "ignore"; state: UtteranceMark | null } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { log, action: "ignore", state: last };
  if (last && norm(clean) === norm(last.text) && now - last.at < REPLAY_MS) {
    return { log, action: "replay", state: last };
  }
  const sameItem = Boolean(itemId && last?.itemId && itemId === last.itemId);
  const growingWithoutId = Boolean(
    last
    && !itemId
    && !last.itemId
    && now - last.at < 2500
    && norm(last.text).length > 12
    && norm(clean).startsWith(norm(last.text))
    && norm(clean).length > norm(last.text).length,
  );
  if ((sameItem || growingWithoutId) && last) {
    const thread = log.threads.find((t) => t.id === log.activeId) || log.threads[0];
    if (thread) {
      const idx = [...thread.turns].reverse().findIndex((t) => t.role === "you" && norm(t.text) === norm(last.text));
      if (idx >= 0) {
        const at = thread.turns.length - 1 - idx;
        const turnsNext = thread.turns.slice();
        turnsNext[at] = { ...turnsNext[at], text: clean, at: now };
        const threads = log.threads.map((t) => t.id === thread.id ? { ...t, turns: turnsNext, updatedAt: now } : t);
        return { log: { ...log, threads }, action: "replace", state: { itemId: itemId || last.itemId, text: clean, at: now } };
      }
    }
  }
  return {
    log: appendAraTurn(log, "you", clean, now),
    action: "new",
    state: { itemId, text: clean, at: now },
  };
}

export function sanitizeAraLog(raw: unknown): AraLog {
  if (!raw || typeof raw !== "object") return emptyAraLog();
  const src = raw as AraLog;
  if (!Array.isArray(src.threads)) return emptyAraLog();
  const threads = src.threads.filter((t) => t && typeof t.id === "string" && Array.isArray(t.turns)).slice(0, 40).map((t) => ({
    id: t.id,
    title: String(t.title || "Ara").slice(0, 80),
    updatedAt: Number(t.updatedAt) || 0,
    turns: t.turns.filter((turn) => turn && (turn.role === "you" || turn.role === "ara") && typeof turn.text === "string").slice(-200).map((turn) => ({
      id: String(turn.id || "turn"),
      role: turn.role,
      text: turn.text.replace(/\s+/g, " ").trim().slice(0, 2000),
      at: Number(turn.at) || 0,
    })).filter((turn) => turn.text),
  }));
  const activeId = threads.some((t) => t.id === src.activeId) ? src.activeId : (threads[0]?.id ?? null);
  return { activeId, threads };
}

export function preferServerLog(server: AraLog, local: AraLog): AraLog {
  const count = (log: AraLog) => log.threads.reduce((n, t) => n + t.turns.length, 0);
  if (count(server) === 0 && count(local) > 0) return local;
  return count(server) > 0 ? server : local;
}

export function scopedConversationUser(sessionUserId: string, requested?: string | null): string | null {
  const session = (sessionUserId || "").trim();
  if (!session) return null;
  if (requested && requested.trim() && requested.trim() !== session) return null;
  return session;
}
