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
  const q = (text || "")
    .replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/g, "");
  if (!q) return null;
  if (/what did you just add|what am i looking at|what is on (this )?screen|explain this screen/.test(q)) return null;
  const recent = q.match(/repeat your last (\d+) messages?/);
  if (recent) return { kind: "recent_ara", n: Math.min(5, Math.max(1, Number(recent[1]))) };
  if (/what did you say before that|go back to what you said/.test(q)) return { kind: "ara_before" };
  if (
    /what did you just (say|tell me)|repeat what you (just )?said|show me (what you just said|your last message)|your last message/.test(q)
    || /last thing you (said|told)/.test(q)
    || /what('s|s| is| was) the last thing you (said|told)/.test(q)
    || /what did you last (say|tell)/.test(q)
    || /previous (message|thing) you (said|told)/.test(q)
  ) return { kind: "last_ara" };
  if (
    /what did i just (say|tell you|ask)|what did i just ask you/.test(q)
    || /last thing i (said|told|asked)/.test(q)
  ) return { kind: "last_user" };
  if (/what were we just talking about|what were we talking about|previous conversation|what did we just talk about/.test(q)) return { kind: "topic" };
  if (/read (our |the )?ara conversation|conversations box|saved ara conversation|can you not read the conversation|do you have a record/.test(q)) return { kind: "can_read" };
  if (/why can'?t you (go back|see|read)|go back and see|can you go back/.test(q)) return { kind: "can_read" };
  return null;
}

export function memoryAskClearsPending(_ask: MemoryAsk | null): boolean {
  return false;
}

export function panelMessages(log: AraLog): { conversationId: string | null; messages: AraTurn[] } {
  const thread = log.threads.find((item) => item.id === log.activeId) || log.threads[0] || null;
  return { conversationId: thread?.id || null, messages: thread?.turns || [] };
}

function turns(log: AraLog): AraTurn[] {
  return panelMessages(log).messages;
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
  const ara = history.filter((turn) => turn.role === "ara");
  const you = history.filter((turn) => turn.role === "you");
  if (ask.kind === "last_ara" || ask.kind === "can_read") {
    const last = ara[ara.length - 1];
    if (!last) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn't load our previous conversation messages right now." };
    if (ask.kind === "can_read") {
      return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `I can read this saved conversation. The last thing I said was: ${last.text}` };
    }
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `I said, '${last.text}'` };
  }
  if (ask.kind === "last_user") {
    const last = you[you.length - 1];
    if (!last) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn't load our previous conversation messages right now." };
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `You said: ${last.text}` };
  }
  if (ask.kind === "ara_before") {
    const last = ara[ara.length - 2];
    if (!last) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn't load our previous conversation messages right now." };
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: last.text };
  }
  if (ask.kind === "recent_ara") {
    const slice = ara.slice(-ask.n);
    if (!slice.length) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn't load our previous conversation messages right now." };
    return { ok: true, action: "ARA_HISTORY_LOOKUP", text: slice.map((turn) => turn.text).join(" ") };
  }
  const bits = history.slice(-6).map((turn) => `${turn.role === "you" ? "You" : "I"}: ${turn.text}`);
  if (!bits.length) return { ok: false, action: "ARA_HISTORY_LOOKUP_FAILED", text: "I couldn't load our previous conversation messages right now." };
  return { ok: true, action: "ARA_HISTORY_LOOKUP", text: `We were just talking about this. ${bits.join(" ")}` };
}

export function savedConversationLookup(messages: AraTurn[], ask: MemoryAsk, currentText = "") {
  return answerMemory({
    activeId: "panel",
    threads: [{ id: "panel", title: "Ara", updatedAt: messages.at(-1)?.at || 0, turns: messages }],
  }, ask, currentText);
}

export function conversationItemEvent(message: { role: "you" | "ara"; text: string }): Record<string, unknown> {
  const assistant = message.role === "ara";
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: assistant ? "assistant" : "user",
      content: [{ type: assistant ? "output_text" : "input_text", text: message.text }],
    },
  };
}

export function conversationContext(log: AraLog, limit = 24): { summary: string; recent: string } {
  const all = turns(log);
  const recentTurns = all.slice(-limit);
  const older = all.slice(0, Math.max(0, all.length - limit));
  const summary = older
    .slice(-8)
    .map((turn) => `${turn.role === "you" ? "Dylan" : "Ara"}: ${turn.text.slice(0, 140)}`)
    .join(" | ")
    .slice(0, 700);
  const recent = recentTurns
    .map((turn) => `${turn.role === "you" ? "USER" : "ARA"}: ${turn.text.slice(0, 500)}`)
    .join("\n")
    .slice(0, 4000);
  return { summary, recent };
}

export function historyInstruction(log: AraLog): string {
  const panel = panelMessages(log);
  const { recent } = conversationContext(log);
  return [
    "SAVED CONVERSATION is separate from the current screen.",
    `Active conversation id: ${panel.conversationId || "none"}.`,
    recent ? `VISIBLE TURNS:\n${recent}` : "VISIBLE TURNS: none in the open conversation.",
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
    const thread = log.threads.find((item) => item.id === log.activeId) || log.threads[0];
    if (thread) {
      const idx = [...thread.turns].reverse().findIndex((turn) => turn.role === "you" && norm(turn.text) === norm(last.text));
      if (idx >= 0) {
        const at = thread.turns.length - 1 - idx;
        const turnsNext = thread.turns.slice();
        turnsNext[at] = { ...turnsNext[at], text: clean, at: now };
        const threads = log.threads.map((item) => item.id === thread.id ? { ...item, turns: turnsNext, updatedAt: now } : item);
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
  const threads = src.threads.filter((item) => item && typeof item.id === "string" && Array.isArray(item.turns)).slice(0, 40).map((item) => ({
    id: item.id,
    title: String(item.title || "Ara").slice(0, 80),
    updatedAt: Number(item.updatedAt) || 0,
    turns: item.turns.filter((turn) => turn && (turn.role === "you" || turn.role === "ara") && typeof turn.text === "string").slice(-200).map((turn) => ({
      id: String(turn.id || "turn"),
      role: turn.role,
      text: turn.text.replace(/\s+/g, " ").trim().slice(0, 2000),
      at: Number(turn.at) || 0,
    })).filter((turn) => turn.text),
  }));
  const activeId = threads.some((item) => item.id === src.activeId) ? src.activeId : (threads[0]?.id ?? null);
  return { activeId, threads };
}

export function preferServerLog(server: AraLog, local: AraLog): AraLog {
  const count = (log: AraLog) => log.threads.reduce((n, item) => n + item.turns.length, 0);
  if (count(server) === 0 && count(local) > 0) return local;
  return count(server) > 0 ? server : local;
}

export function scopedConversationUser(sessionUserId: string, requested?: string | null): string | null {
  const session = (sessionUserId || "").trim();
  if (!session) return null;
  if (requested && requested.trim() && requested.trim() !== session) return null;
  return session;
}
