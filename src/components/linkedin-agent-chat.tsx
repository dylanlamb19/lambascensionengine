"use client";

import "@/styles-linkedin-agent.css";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  createLinkedInAgentOrderFn,
  fillHighTicketLeadsFn,
  listLinkedInAgentMessagesFn,
  listLinkedInAgentOrdersFn,
  postLinkedInAgentMessageFn,
} from "@/lib/linkedin-agent/actions";
import type { LinkedInAgentMessage, LinkedInAgentOrder } from "@/lib/linkedin-agent/types";

/**
 * In-app LinkedIn agent chat dock (not an iframe of Grok Bot).
 * Stores messages + queues orders for the external LinkedIn agent to poll.
 */
export function LinkedInAgentChat() {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [messages, setMessages] = useState<LinkedInAgentMessage[]>([]);
  const [pending, setPending] = useState<LinkedInAgentOrder[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [msgs, ords] = await Promise.all([
        listLinkedInAgentMessagesFn(),
        listLinkedInAgentOrdersFn(),
      ]);
      if (msgs.ok) setMessages(msgs.messages);
      if (ords.ok) setPending(ords.pending);
      setErr("");
    } catch {
      setErr("Could not load LinkedIn agent chat.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, expanded]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setDraft("");
    try {
      const posted = await postLinkedInAgentMessageFn({ data: { body, role: "user" } });
      if (!posted.ok) {
        setErr(posted.reason);
        setDraft(body);
        return;
      }
      await createLinkedInAgentOrderFn({
        data: {
          kind: "chat_reply",
          payload: { message_id: posted.message.id, body },
          note: body.slice(0, 500),
        },
      });
      await refresh();
    } catch {
      setErr("Message failed to send.");
      setDraft(body);
    } finally {
      setBusy(false);
    }
  }

  async function queueFill() {
    if (busy) return;
    setBusy(true);
    try {
      await createLinkedInAgentOrderFn({
        data: {
          kind: "fill_leads",
          payload: { source: "chat_ui" },
          note: "Fill high-ticket TX leads via Places",
        },
      });
      const fill = await fillHighTicketLeadsFn({ data: { maxSearches: 3, perSearchLimit: 5 } });
      await postLinkedInAgentMessageFn({
        data: {
          role: "system",
          body: fill.ok
            ? fill.reason
            : ("reason" in fill ? fill.reason : "High-ticket fill failed."),
        },
      });
      await refresh();
    } catch {
      setErr("Could not queue high-ticket fill.");
    } finally {
      setBusy(false);
    }
  }

  async function queueEnrichNeedsContact() {
    if (busy) return;
    setBusy(true);
    try {
      await createLinkedInAgentOrderFn({
        data: {
          kind: "enrich",
          payload: { focus: "NEEDS_CONTACT_INFO", soft_cap: true },
          note: "Enrich contacts for Needs Contact Info",
        },
      });
      await postLinkedInAgentMessageFn({
        data: {
          role: "system",
          body: "Queued enrich for Needs Contact Info. Soft-capped — no invented emails.",
        },
      });
      await refresh();
    } catch {
      setErr("Could not queue enrich order.");
    } finally {
      setBusy(false);
    }
  }

  async function queueOutreachDraft() {
    if (busy) return;
    setBusy(true);
    try {
      await createLinkedInAgentOrderFn({
        data: {
          kind: "outreach",
          payload: {
            safety_note: "draft/request LinkedIn connects under soft caps",
            auto_send: false,
            gmail_auto_send: false,
          },
          note: "Draft LinkedIn connects under soft caps (no auto-send)",
        },
      });
      await refresh();
    } catch {
      setErr("Could not queue outreach order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`la-li-chat ${expanded ? "is-expanded" : "is-compact"}`} data-linkedin-agent="1">
      <button
        type="button"
        className="la-li-chat-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`la-li-orb ${busy ? "is-busy" : "is-ready"}`} aria-hidden="true" />
        <span className="la-li-chat-title">
          <b>LinkedIn Agent</b>
          <span className="la-li-chat-sub">
            {pending.length ? `${pending.length} pending order${pending.length === 1 ? "" : "s"}` : "Orders + chat"}
          </span>
        </span>
        <span className="la-li-chat-chev">{expanded ? "Collapse" : "Open"}</span>
      </button>

      {expanded ? (
        <div className="la-li-chat-panel">
          <p className="la-li-chat-hint">
            In-app thread for the LinkedIn Grok Bot agent. Messages and orders are stored here —
            the agent polls orders externally. No LinkedIn scraping in Lamb Ascension.
          </p>

          <div className="la-li-thread" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <p className="la-empty">No messages yet. Ask for leads, enrich, or LinkedIn drafts.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`la-li-msg la-li-msg-${m.role}`}>
                  <span className="la-li-msg-role">{m.role}</span>
                  <p className="la-li-msg-body">{m.body}</p>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {pending.length ? (
            <div className="la-li-orders">
              <p className="la-li-orders-label">Pending orders</p>
              <ul>
                {pending.slice(0, 6).map((o) => (
                  <li key={o.id}>
                    <b>{o.kind}</b> · {o.status}
                    {o.kind === "outreach" ? " · soft-capped drafts only" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {err ? <p className="la-li-err">{err}</p> : null}

          <div className="la-li-quick">
            <button type="button" className="la-btn la-btn-ghost" disabled={busy} onClick={() => void queueFill()}>
              Fill high-ticket leads
            </button>
            <button type="button" className="la-btn la-btn-ghost" disabled={busy} onClick={() => void queueEnrichNeedsContact()}>
              Enrich Needs Contact Info
            </button>
            <button type="button" className="la-btn la-btn-ghost" disabled={busy} onClick={() => void queueOutreachDraft()}>
              Queue LinkedIn drafts
            </button>
          </div>

          <form className="la-li-compose" onSubmit={(e) => void send(e)}>
            <input
              className="la-field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the LinkedIn agent…"
              disabled={busy}
              maxLength={4000}
            />
            <button className="la-btn la-btn-primary" type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
