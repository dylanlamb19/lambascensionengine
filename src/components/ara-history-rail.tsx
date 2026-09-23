"use client";

import { useEffect, useRef, useState } from "react";
import type { AraHit, AraLog } from "@/lib/voice/ara-history";
import { searchAraLog } from "@/lib/voice/ara-history";

function when(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Mark({ text, query }: { text: string; query: string }) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => (
        terms.some((term) => part.toLowerCase() === term)
          ? <mark key={i}>{part}</mark>
          : <span key={i}>{part}</span>
      ))}
    </>
  );
}

export function AraHistoryRail({
  log,
  onSelect,
  onNew,
  focusTurnId,
}: {
  log: AraLog;
  onSelect: (threadId: string, turnId?: string) => void;
  onNew: () => void;
  focusTurnId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const hits = searchAraLog(log, query);
  const active = log.threads.find((t) => t.id === log.activeId) || log.threads[0] || null;
  const turnCount = active?.turns.length || 0;
  const seenTurns = useRef(turnCount);

  useEffect(() => {
    if (turnCount > seenTurns.current) setBrowsing(false);
    seenTurns.current = turnCount;
  }, [turnCount, active?.id]);

  useEffect(() => {
    if (!focusTurnId || !scroller.current) return;
    const node = scroller.current.querySelector(`[data-turn="${focusTurnId}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  }, [focusTurnId, active?.id, query]);

  function openHit(hit: AraHit) {
    onSelect(hit.threadId, hit.turnId);
    setQuery("");
    setBrowsing(false);
  }

  return (
    <aside className="la-ara-log" data-ara-history="1" aria-label="Ara conversations">
      <div className="la-ara-log-head">
        <div>
          <p className="la-kicker">Ara</p>
          <h2 className="font-display">Conversations</h2>
        </div>
        <button type="button" className="la-btn la-btn-ghost" onClick={() => { setBrowsing(false); setQuery(""); onNew(); }}>
          New
        </button>
      </div>
      <div className="la-ara-log-search">
        <input
          className="la-field"
          value={query}
          aria-label="Search messages"
          placeholder="Search messages"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="la-ara-log-scroll" ref={scroller}>
        {query.trim() ? (
          hits.length ? hits.map((hit) => (
            <button
              key={`${hit.threadId}:${hit.turnId}:${hit.at}`}
              type="button"
              className="la-ara-log-hit"
              data-turn={hit.turnId}
              onClick={() => openHit(hit)}
            >
              <span className="la-ara-log-meta">{hit.role === "you" ? "You" : "Ara"} · {when(hit.at)}</span>
              <span className="la-ara-log-title">{hit.title}</span>
              <span className="la-ara-log-snippet"><Mark text={hit.snippet} query={query} /></span>
            </button>
          )) : <p className="la-ara-log-empty">No messages match that.</p>
        ) : browsing || !active ? (
          log.threads.length ? log.threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className="la-ara-log-item"
              data-on={thread.id === log.activeId ? "1" : "0"}
              onClick={() => { onSelect(thread.id); setBrowsing(false); }}
            >
              <span className="la-ara-log-title">{thread.title}</span>
              <span className="la-ara-log-meta">{when(thread.updatedAt)} · {thread.turns.length}</span>
            </button>
          )) : <p className="la-ara-log-empty">Nothing saved yet. Talk to Ara and it stays here.</p>
        ) : (
          <>
            <button type="button" className="la-btn la-btn-quiet" onClick={() => setBrowsing(true)}>
              All conversations
            </button>
            <p className="la-ara-log-current">{active.title}</p>
            {active.turns.length ? active.turns.map((turn) => (
              <article
                key={turn.id}
                className="la-ara-log-turn"
                data-turn={turn.id}
                data-on={focusTurnId === turn.id ? "1" : "0"}
              >
                <p className="la-ara-log-meta">{turn.role === "you" ? "You" : "Ara"} · {when(turn.at)}</p>
                <p className={turn.role === "ara" ? "la-ara-log-ara" : "la-ara-log-you"}>{turn.text}</p>
              </article>
            )) : <p className="la-ara-log-empty">This conversation is empty.</p>}
          </>
        )}
      </div>
    </aside>
  );
}
