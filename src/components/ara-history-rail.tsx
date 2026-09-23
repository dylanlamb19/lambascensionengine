"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { AraHit, AraLog, AraTurn } from "@/lib/voice/ara-history";
import { searchAraLog } from "@/lib/voice/ara-history";

const MENU_ID = "ara-history-actions";

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
  const re = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "ig",
  );
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        terms.some((term) => part.toLowerCase() === term) ? (
          <mark key={i}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function speaker(role: AraTurn["role"]): string {
  return role === "you" ? "You" : "Ara";
}

function messageKey(threadId: string, turnId: string): string {
  return `message:${threadId}:${turnId}`;
}

function threadKey(threadId: string): string {
  return `thread:${threadId}`;
}

function findTurn(log: AraLog, threadId: string, turnId: string): AraTurn | null {
  return (
    log.threads
      .find((thread) => thread.id === threadId)
      ?.turns.find((turn) => turn.id === turnId) ?? null
  );
}

function selectionInside(node: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode;
  return !!anchor && node.contains(anchor);
}

type MessageMenu = {
  kind: "message";
  key: string;
  threadId: string;
  turnId: string;
  text: string;
  role: AraTurn["role"];
  fromSearch: boolean;
};

type ThreadMenu = {
  kind: "thread";
  key: string;
  threadId: string;
  title: string;
};

type OpenMenu = (MessageMenu | ThreadMenu) & { top: number; left: number };

type MenuAction = {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
};

function guessHeight(target: { kind: OpenMenu["kind"]; fromSearch?: boolean }): number {
  const count = target.kind === "message" && target.fromSearch ? 4 : 3;
  return count * 36 + 16;
}

function placeMenu(
  anchor: HTMLElement,
  width: number,
  height: number,
): { top: number; left: number } {
  const box = anchor.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  let left = anchor.hasAttribute("data-ara-menu-trigger") ? box.right - width : box.left;
  left = Math.min(left, window.innerWidth - width - margin);
  left = Math.max(margin, left);
  let top = box.bottom + gap;
  if (top + height > window.innerHeight - margin) {
    const above = box.top - height - gap;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
  }
  return { top, left };
}

function anchorInView(anchor: HTMLElement, bounds: HTMLElement | null): boolean {
  const box = anchor.getBoundingClientRect();
  if (box.bottom < 0 || box.top > window.innerHeight) return false;
  if (!bounds) return true;
  const frame = bounds.getBoundingClientRect();
  return box.bottom > frame.top + 2 && box.top < frame.bottom - 2;
}

function AraLogMenu({
  menu,
  actions,
  flash,
  failed,
  anchorRef,
  scrollerRef,
  onClose,
}: {
  menu: OpenMenu;
  actions: MenuAction[];
  flash: string | null;
  failed: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    function place(fromScroll: boolean) {
      const anchor = anchorRef.current;
      const node = menuRef.current;
      if (!anchor || !node) return;
      if (fromScroll && !anchorInView(anchor, scrollerRef.current)) {
        onCloseRef.current(false);
        return;
      }
      const next = placeMenu(anchor, node.offsetWidth, node.offsetHeight);
      node.style.top = `${next.top}px`;
      node.style.left = `${next.left}px`;
    }
    place(false);
    function onScroll() {
      place(true);
    }
    function onResize() {
      place(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [anchorRef, scrollerRef, menu.key]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [menu.key]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (target instanceof Element) {
        if (target.closest("[data-ara-menu-trigger]")) return;
        const owner = target.closest("[data-menu-key]");
        if (owner?.getAttribute("data-menu-key") === menu.key) return;
      }
      onCloseRef.current(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current(true);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu.key]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list[(index < 0 ? 0 : index + 1) % list.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      list[index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list[list.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose(true);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      id={MENU_ID}
      role="menu"
      aria-label={menu.kind === "thread" ? "Conversation actions" : "Message actions"}
      className="la-ara-log-menu"
      style={{ top: menu.top, left: menu.left }}
      onKeyDown={onMenuKeyDown}
    >
      {actions.map((action) => {
        const copied = flash === action.id;
        const label = copied ? (failed ? "Couldn't copy" : "Copied") : action.label;
        return (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className="la-btn la-ara-log-menu-item"
            data-danger={action.danger ? "1" : "0"}
            data-copied={copied && !failed ? "1" : "0"}
            onClick={() => action.run()}
          >
            {label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function MenuTrigger({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: (anchor: HTMLButtonElement, keepOpen: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="la-btn la-btn-quiet la-ara-log-more"
      data-ara-menu-trigger="1"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? MENU_ID : undefined}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event.currentTarget, false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        onToggle(event.currentTarget, true);
      }}
    >
      <span aria-hidden="true">⋯</span>
    </button>
  );
}

export function AraHistoryRail({
  log,
  onSelect,
  onNew,
  onDeleteMessage,
  onDeleteThread,
  focusTurnId,
}: {
  log: AraLog;
  onSelect: (threadId: string, turnId?: string) => void;
  onNew: () => void;
  onDeleteMessage: (threadId: string, turnId: string) => void;
  onDeleteThread: (threadId: string) => void;
  focusTurnId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(true);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuKeyRef = useRef<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  menuKeyRef.current = menu?.key ?? null;
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

  useEffect(() => {
    if (!menu) return;
    const gone =
      menu.kind === "message"
        ? !findTurn(log, menu.threadId, menu.turnId)
        : !log.threads.some((thread) => thread.id === menu.threadId);
    if (gone) setMenu(null);
  }, [log, menu]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  function clearFlashTimer() {
    if (!flashTimer.current) return;
    clearTimeout(flashTimer.current);
    flashTimer.current = null;
  }

  function closeMenu(restoreFocus: boolean) {
    const back = triggerRef.current;
    clearFlashTimer();
    setFlash(null);
    setFailed(false);
    setMenu(null);
    if (restoreFocus) back?.focus();
  }

  function toggleMenu(
    next: MessageMenu | ThreadMenu,
    anchor: HTMLElement,
    trigger: HTMLElement,
    keepOpen = false,
  ) {
    if (menu?.key === next.key) {
      if (keepOpen) {
        document
          .getElementById(MENU_ID)
          ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
          ?.focus();
        return;
      }
      closeMenu(false);
      return;
    }
    clearFlashTimer();
    setFlash(null);
    setFailed(false);
    setStatus("");
    anchorRef.current = anchor;
    triggerRef.current = trigger;
    setMenu({ ...next, ...placeMenu(anchor, 208, guessHeight(next)) });
  }

  function openHit(hit: AraHit) {
    onSelect(hit.threadId, hit.turnId);
    setQuery("");
    setBrowsing(false);
    closeMenu(false);
  }

  async function copyValue(text: string, actionId: string) {
    const key = menuKeyRef.current;
    if (!key) return;
    clearFlashTimer();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    if (menuKeyRef.current !== key) return;
    setFlash(actionId);
    setFailed(!ok);
    setStatus(ok ? "Copied to clipboard" : "Couldn't copy");
    if (!ok) return;
    clearFlashTimer();
    flashTimer.current = setTimeout(() => {
      if (menuKeyRef.current !== key) return;
      closeMenu(false);
    }, 900);
  }

  function messageTarget(
    threadId: string,
    turnId: string,
    role: AraTurn["role"],
    text: string,
    fromSearch: boolean,
  ): MessageMenu {
    const turn = findTurn(log, threadId, turnId);
    return {
      kind: "message",
      key: messageKey(threadId, turnId),
      threadId,
      turnId,
      role: turn?.role ?? role,
      text: turn?.text ?? text,
      fromSearch,
    };
  }

  const actions: MenuAction[] = !menu
    ? []
    : menu.kind === "thread"
      ? [
          {
            id: "open",
            label: "Open",
            run: () => {
              onSelect(menu.threadId);
              setBrowsing(false);
              closeMenu(false);
            },
          },
          {
            id: "copy-title",
            label: "Copy title",
            run: () => void copyValue(menu.title, "copy-title"),
          },
          {
            id: "delete",
            label: "Delete conversation",
            danger: true,
            run: () => {
              onDeleteThread(menu.threadId);
              closeMenu(false);
            },
          },
        ]
      : [
          ...(menu.fromSearch
            ? [
                {
                  id: "open",
                  label: "Open",
                  run: () => {
                    onSelect(menu.threadId, menu.turnId);
                    setQuery("");
                    setBrowsing(false);
                    closeMenu(false);
                  },
                },
              ]
            : []),
          { id: "copy", label: "Copy", run: () => void copyValue(menu.text, "copy") },
          {
            id: "copy-as",
            label: `Copy as ${speaker(menu.role)}`,
            run: () => void copyValue(`${speaker(menu.role)}: ${menu.text}`, "copy-as"),
          },
          {
            id: "delete",
            label: "Delete",
            danger: true,
            run: () => {
              onDeleteMessage(menu.threadId, menu.turnId);
              closeMenu(false);
            },
          },
        ];

  return (
    <aside className="la-ara-log" data-ara-history="1" aria-label="Ara conversations">
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      <div className="la-ara-log-head">
        <div>
          <p className="la-kicker">Ara</p>
          <h2 className="font-display">Conversations</h2>
        </div>
        <button
          type="button"
          className="la-btn la-btn-ghost"
          onClick={() => {
            setBrowsing(false);
            setQuery("");
            closeMenu(false);
            onNew();
          }}
        >
          New
        </button>
      </div>
      <div className="la-ara-log-search">
        <input
          className="la-field"
          value={query}
          aria-label="Search messages"
          placeholder="Search messages"
          onChange={(e) => {
            setQuery(e.target.value);
            closeMenu(false);
          }}
        />
      </div>
      <div className="la-ara-log-scroll" ref={scroller}>
        {query.trim() ? (
          hits.length ? (
            hits.map((hit, index) => {
              const key = messageKey(hit.threadId, hit.turnId);
              return (
                <div
                  key={`${hit.threadId}:${hit.turnId}:${hit.at}:${index}:${hit.snippet}`}
                  className="la-ara-log-hit"
                  data-turn={hit.turnId}
                >
                  <button type="button" className="la-ara-log-open" onClick={() => openHit(hit)}>
                    <span className="la-ara-log-meta">
                      {speaker(hit.role)} · {when(hit.at)}
                    </span>
                    <span className="la-ara-log-title">{hit.title}</span>
                    <span className="la-ara-log-snippet">
                      <Mark text={hit.snippet} query={query} />
                    </span>
                  </button>
                  <MenuTrigger
                    label={`Actions for ${speaker(hit.role)} message`}
                    open={menu?.key === key}
                    onToggle={(anchor, keepOpen) =>
                      toggleMenu(
                        messageTarget(hit.threadId, hit.turnId, hit.role, hit.snippet, true),
                        anchor,
                        anchor,
                        keepOpen,
                      )
                    }
                  />
                </div>
              );
            })
          ) : (
            <p className="la-ara-log-empty">No messages match that.</p>
          )
        ) : browsing || !active ? (
          log.threads.length ? (
            log.threads.map((thread) => {
              const key = threadKey(thread.id);
              return (
                <div
                  key={thread.id}
                  className="la-ara-log-item"
                  data-on={thread.id === log.activeId ? "1" : "0"}
                >
                  <button
                    type="button"
                    className="la-ara-log-open"
                    onClick={() => {
                      onSelect(thread.id);
                      setBrowsing(false);
                      closeMenu(false);
                    }}
                  >
                    <span className="la-ara-log-title">{thread.title}</span>
                    <span className="la-ara-log-meta">
                      {when(thread.updatedAt)} · {thread.turns.length}
                    </span>
                  </button>
                  <MenuTrigger
                    label={`Actions for ${thread.title}`}
                    open={menu?.key === key}
                    onToggle={(anchor, keepOpen) =>
                      toggleMenu(
                        { kind: "thread", key, threadId: thread.id, title: thread.title },
                        anchor,
                        anchor,
                        keepOpen,
                      )
                    }
                  />
                </div>
              );
            })
          ) : (
            <p className="la-ara-log-empty">Nothing saved yet. Talk to Ara and it stays here.</p>
          )
        ) : (
          <>
            <button
              type="button"
              className="la-btn la-btn-quiet"
              onClick={() => {
                setBrowsing(true);
                closeMenu(false);
              }}
            >
              All conversations
            </button>
            <p className="la-ara-log-current">{active.title}</p>
            {active.turns.length ? (
              active.turns.map((turn) => {
                const key = messageKey(active.id, turn.id);
                return (
                  <article
                    key={turn.id}
                    className="la-ara-log-turn"
                    data-turn={turn.id}
                    data-on={focusTurnId === turn.id ? "1" : "0"}
                    data-menu-key={key}
                    data-menu={menu?.key === key ? "1" : "0"}
                    onClick={(event) => {
                      if (selectionInside(event.currentTarget)) return;
                      const trigger =
                        event.currentTarget.querySelector<HTMLButtonElement>(
                          "[data-ara-menu-trigger]",
                        );
                      if (!trigger || trigger.contains(event.target as Node)) return;
                      toggleMenu(
                        messageTarget(active.id, turn.id, turn.role, turn.text, false),
                        event.currentTarget,
                        trigger,
                      );
                    }}
                  >
                    <div className="la-ara-log-meta-row">
                      <p className="la-ara-log-meta">
                        {speaker(turn.role)} · {when(turn.at)}
                      </p>
                      <MenuTrigger
                        label={`Actions for ${speaker(turn.role)} message`}
                        open={menu?.key === key}
                        onToggle={(anchor, keepOpen) =>
                          toggleMenu(
                            messageTarget(active.id, turn.id, turn.role, turn.text, false),
                            anchor,
                            anchor,
                            keepOpen,
                          )
                        }
                      />
                    </div>
                    <p className={turn.role === "ara" ? "la-ara-log-ara" : "la-ara-log-you"}>
                      {turn.text}
                    </p>
                  </article>
                );
              })
            ) : (
              <p className="la-ara-log-empty">This conversation is empty.</p>
            )}
          </>
        )}
      </div>
      {menu ? (
        <AraLogMenu
          menu={menu}
          actions={actions}
          flash={flash}
          failed={failed}
          anchorRef={anchorRef}
          scrollerRef={scroller}
          onClose={closeMenu}
        />
      ) : null}
    </aside>
  );
}
