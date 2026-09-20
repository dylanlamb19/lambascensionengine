"use client";

import { useEffect, useState } from "react";
import type { DesignDirectorStatus } from "@/lib/design/types";

export function DesignDirectorBar({
  status,
  paused,
  spoken,
  preview,
  busy,
  onSend,
  onPause,
  onUndo,
  onKeep,
  onDiscard,
  onTryAnother,
  onOpenSettings,
}: {
  status: DesignDirectorStatus;
  paused: boolean;
  spoken: string;
  preview: boolean;
  busy: boolean;
  onSend: (prompt: string) => void;
  onPause: (paused: boolean) => void;
  onUndo: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  onTryAnother: () => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (preview || status === "designing" || status === "waiting") setOpen(true);
  }, [preview, status]);

  const label =
    status === "disconnected" ? "Disconnected"
      : paused || status === "paused" ? "Paused"
        : status === "designing" ? "Designing"
          : status === "waiting" ? "Waiting"
            : "Connected";

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  }

  return (
    <div className="la-dd" data-dd-status={status} data-dd-preview={preview ? "1" : "0"}>
      <div className="la-dd-row">
        <p className="la-dd-status">
          <span className={`la-dot la-dot-inline ${status === "connected" || status === "designing" ? "la-dot-good" : status === "paused" || paused ? "la-dot-warn" : "la-dot-bad"}`} />
          ChatGPT Design Director · {label}
        </p>
        <div className="la-dd-actions">
          {status === "disconnected" ? (
            <button type="button" className="la-btn la-btn-quiet" onClick={onOpenSettings}>Connect</button>
          ) : (
            <>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => onPause(!(paused || status === "paused"))}>
                {paused || status === "paused" ? "Resume" : "Pause"}
              </button>
              <button type="button" className="la-btn la-btn-quiet" onClick={onUndo}>Undo</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => setOpen((v) => !v)}>
                {open ? "Hide" : "Ask"}
              </button>
            </>
          )}
        </div>
      </div>
      {preview ? (
        <div className="la-dd-preview">
          <p className="la-dd-note">{spoken || "Preview on screen. Keep it, undo, or try another."}</p>
          <div className="la-dd-actions">
            <button type="button" className="la-btn la-btn-primary" onClick={onKeep}>Keep design</button>
            <button type="button" className="la-btn la-btn-ghost" onClick={onDiscard}>Undo</button>
            <button type="button" className="la-btn la-btn-ghost" onClick={onTryAnother}>Try another</button>
          </div>
        </div>
      ) : null}
      {open && status !== "disconnected" ? (
        <form
          className="la-dd-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="la-field"
            value={text}
            placeholder={busy ? "Designing…" : "Make Home more luxurious…"}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            aria-label="Design Director request"
          />
          <button className="la-btn la-btn-primary" type="submit" disabled={busy || !text.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      ) : null}
      {spoken && !preview ? <p className="la-dd-note">{spoken}</p> : null}
    </div>
  );
}
