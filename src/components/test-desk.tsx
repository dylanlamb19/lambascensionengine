"use client";

import { useEffect, useState } from "react";
import {
  approveTestFollowupFn,
  chooseTestRecipientFn,
  confirmTestSendFn,
  connectionTestFn,
  googleStartFn,
  saveTestModeFn,
  syncTestRepliesFn,
  testBookingLinkFn,
  testBookSlotFn,
  testSettingsFn,
} from "@/lib/mail/actions";
import type { LiveCheck } from "@/lib/mail/test-mode";
import type { VisualCommand, VisualTheme } from "@/lib/visual/theme";
import { NATURE_ASSETS } from "@/lib/visual/theme";
import { imageGenerationSettingsFn, saveImageGenerationCapFn } from "@/lib/visual/generate";
import {
  clearOpenAiKeyFn,
  designDirectorStatusFn,
  saveOpenAiKeyFn,
} from "@/lib/design/actions";

type Ready = "ready" | "missing";
type View = {
  testMode: boolean;
  allowlist: string[];
  caps: { maxFirst: number; maxFollowups: number };
  integrations: Record<string, Ready | boolean>;
  worker?: { state: string; detail: string };
  gmailEmail: string;
  checks: LiveCheck[];
};

const LABELS: Record<string, string> = {
  googleOAuthClientId: "Google OAuth Client ID",
  googleOAuthClientSecret: "Google OAuth Client Secret",
  appSecret: "APP_SECRET",
  outreachJobSecret: "OUTREACH_JOB_SECRET",
  gmailConnection: "Gmail connection",
  calendarConnection: "Calendar connection",
};

function mark(ok: boolean) {
  return ok
    ? <><span className="la-dot la-dot-inline la-dot-good" />Ready</>
    : <><span className="la-dot la-dot-inline la-dot-bad" />Missing</>;
}

export function TestDesk({
  onBack,
  visual,
  onVisual,
  onPickUpload,
  onGenerate,
}: {
  onBack: () => void;
  visual?: VisualTheme;
  onVisual?: (cmd: VisualCommand) => void;
  onPickUpload?: (nsfw?: boolean) => void;
  onGenerate?: (prompt: string, nsfw: boolean) => void;
}) {
  const [data, setData] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [disableConfirm, setDisableConfirm] = useState("");
  const [probe, setProbe] = useState<Record<string, { ok: boolean; detail: string; email?: string }> | null>(null);
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState<{ subject?: string; body?: string } | null>(null);
  const [sendIds, setSendIds] = useState<{ messageId?: string; threadId?: string } | null>(null);
  const [followMsg, setFollowMsg] = useState("");
  const [replyMsg, setReplyMsg] = useState("");
  const [bookUrl, setBookUrl] = useState("");
  const [slots, setSlots] = useState<{ start: string; end: string; label: string }[]>([]);
  const [booked, setBooked] = useState("");
  const [imageCap, setImageCap] = useState(12);
  const [imageUsed, setImageUsed] = useState(0);
  const [imageConfigured, setImageConfigured] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiMeta, setOpenaiMeta] = useState<{ hasKey: boolean; envKey: boolean; last4: string | null; status: string } | null>(null);
  const [openaiMsg, setOpenaiMsg] = useState("");

  async function refresh() {
    const r = await testSettingsFn();
    if (r.ok) {
      setData({
        testMode: r.testMode,
        allowlist: r.allowlist,
        caps: r.caps,
        integrations: r.integrations as View["integrations"],
        worker: r.worker,
        gmailEmail: r.gmailEmail,
        checks: r.checks,
      });
      setStep(r.state.step || 1);
      if (r.state.message_id) setSendIds({ messageId: r.state.message_id, threadId: r.state.thread_id || undefined });
    }
  }

  useEffect(() => { void refresh().catch(() => setErr("Could not load Test Mode settings.")); }, []);
  useEffect(() => {
    void imageGenerationSettingsFn()
      .then((r) => {
        if (r.ok) {
          setImageCap(r.cap);
          setImageUsed(r.used);
          setImageConfigured(r.configured);
        }
      })
      .catch(() => { /* keep defaults */ });
    void designDirectorStatusFn()
      .then((r) => {
        if (r.ok) setOpenaiMeta({ hasKey: r.hasKey, envKey: r.envKey, last4: r.last4, status: r.status });
      })
      .catch(() => { /* keep disconnected */ });
  }, []);

  async function addEmail() {
    if (!data) return;
    setBusy("allow");
    setErr("");
    try {
      const r = await saveTestModeFn({ data: { allowlist: [...data.allowlist, newEmail] } });
      if (!r.ok) setErr(r.reason);
      else { setNewEmail(""); setData({ ...data, allowlist: r.allowlist, testMode: r.testMode, caps: r.caps, checks: r.checks, integrations: r.integrations as View["integrations"], gmailEmail: r.gmailEmail }); }
    } catch { setErr("Could not save the allowlist."); }
    setBusy("");
  }

  async function removeEmail(email: string) {
    if (!data) return;
    const r = await saveTestModeFn({ data: { allowlist: data.allowlist.filter((e) => e !== email) } });
    if (r.ok) setData({ ...data, allowlist: r.allowlist, checks: r.checks, integrations: r.integrations as View["integrations"], gmailEmail: r.gmailEmail, testMode: r.testMode, caps: r.caps });
  }

  if (!data) {
    return <section className="la-card"><p>Loading Test Mode…</p></section>;
  }

  return (
    <div className="space-y-4">
      <section className="la-card la-card-accent">
        <p className="la-kicker">TEST MODE {data.testMode ? "ON" : "OFF"}</p>
        <h2 className="font-display mt-2 text-2xl">Safe live Gmail + Calendar test</h2>
        <p className="mt-2 text-sm">Only addresses on your test list can receive email. First contact still needs your confirmation. Daily cap while testing: {data.caps.maxFirst} first emails, {data.caps.maxFollowups} follow-ups.</p>
      </section>
      {err ? <div className="la-ribbon la-ribbon-bad">{err}</div> : null}

      {visual && onVisual ? (
        <section className="la-card">
          <h3 className="font-display mb-2 text-lg">Home appearance</h3>
          <p className="mb-3 text-sm text-muted">Backgrounds stay sharp. Readability uses overlay and darker cards — never image blur.</p>
          <p className="mb-3 text-sm">{visual.home.backgroundLabel}. {visual.home.source === "generated" ? "AI generated" : visual.home.source === "upload" ? "Uploaded" : "Background preset"}. Overlay {Math.round(visual.home.overlay * 100)}%. Adult Background Mode {visual.adultMode ? "on" : "off"}.</p>
          <p className="la-preset-label mb-2">Background Presets</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {NATURE_ASSETS.map((a) => (
              <button key={a.id} type="button" className="la-btn la-btn-ghost" onClick={() => onVisual({ op: "background", scene: a.id })}>{a.label}</button>
            ))}
          </div>
          <p className="la-preset-label mb-2">AI image generation</p>
          <p className="mb-2 text-sm text-muted">
            {imageConfigured ? `xAI Imagine is ready. ${imageUsed} of ${imageCap} used today.` : "Image generation isn’t configured in this environment."}
          </p>
          <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
            Daily AI image cap
            <input
              className="la-field w-20"
              type="number"
              min={1}
              max={40}
              value={imageCap}
              onChange={(e) => {
                const n = Number(e.target.value) || 12;
                setImageCap(n);
                void saveImageGenerationCapFn({ data: { cap: n } }).then((r) => {
                  if (r.ok) {
                    setImageCap(r.cap);
                    setImageUsed(r.used);
                  }
                });
              }}
            />
          </label>
          <label className="mb-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={visual.adultMode}
              onChange={(e) => onVisual({ op: "adult", enabled: e.target.checked })}
            />
            Adult Background Mode
          </label>
          <label className="mb-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={visual.hideAdultUntilUnlock}
              onChange={(e) => onVisual({ op: "privacy", hideAdultUntilUnlock: e.target.checked })}
            />
            Hide adult background on startup until unlocked
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="la-btn la-btn-primary" onClick={() => onPickUpload?.(visual.adultMode)}>Upload picture</button>
            <button type="button" className="la-btn la-btn-ghost" onClick={() => onGenerate?.("cinematic 16:9 scenery, sharp", false)}>Generate new scenery</button>
            {visual.adultMode ? (
              <button type="button" className="la-btn la-btn-ghost" onClick={() => onGenerate?.("tasteful adult pin-up", true)}>Generate adult background</button>
            ) : null}
            <button type="button" className="la-btn la-btn-ghost" onClick={() => onVisual({ op: "reset" })}>Reset look</button>
          </div>
        </section>
      ) : null}

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">ChatGPT Design Director</h3>
        <p className="mb-3 text-sm text-muted">
          ChatGPT decides how Home should look. Ara executes structured design operations on this same UI. The key stays on the server — never in the browser after save.
        </p>
        <p className="mb-3 text-sm">
          {openaiMeta?.envKey
            ? "A server OpenAI key is already connected."
            : openaiMeta?.hasKey
              ? `Connected · key ending ${openaiMeta.last4 || "saved"}.`
              : "Disconnected. Add an OpenAI API key to enable Design Director."}
        </p>
        {openaiMsg ? <p className="mb-3 text-sm">{openaiMsg}</p> : null}
        {openaiMeta?.envKey ? null : (
          <div className="flex flex-wrap gap-2">
            <input
              className="la-field min-h-11 flex-1"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              aria-label="OpenAI API key"
            />
            <button
              type="button"
              className="la-btn la-btn-primary"
              disabled={busy === "openai" || openaiKey.trim().length < 20}
              onClick={() => {
                setBusy("openai");
                setOpenaiMsg("");
                void saveOpenAiKeyFn({ data: { key: openaiKey.trim() } })
                  .then((r) => {
                    if (!r.ok) setOpenaiMsg(r.reason);
                    else {
                      setOpenaiKey("");
                      setOpenaiMeta({ hasKey: true, envKey: false, last4: r.last4, status: "connected" });
                      setOpenaiMsg(`Saved. ChatGPT Design Director is connected · ${r.last4}.`);
                    }
                    setBusy("");
                  })
                  .catch(() => {
                    setOpenaiMsg("Could not save the OpenAI key.");
                    setBusy("");
                  });
              }}
            >
              {busy === "openai" ? "Saving…" : "Save key"}
            </button>
            {openaiMeta?.hasKey ? (
              <button
                type="button"
                className="la-btn la-btn-ghost"
                onClick={() => {
                  void clearOpenAiKeyFn().then((r) => {
                    if (!r.ok) setOpenaiMsg(r.reason);
                    else {
                      setOpenaiMeta({ hasKey: false, envKey: false, last4: null, status: "disconnected" });
                      setOpenaiMsg("OpenAI key removed. Design Director is disconnected.");
                    }
                  });
                }}
              >
                Remove key
              </button>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-sm text-muted">Design Director cannot change auth, Gmail, Calendar, sending, Test Mode, or secrets.</p>
      </section>

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">Integrations</h3>
        <p className="mb-3 text-sm text-muted">Secrets are never shown. Ready means the value is set, not that it is correct.</p>
        {Object.entries(LABELS).map(([k, label]) => (
          <p key={k} className="text-sm">{mark(data.integrations[k] === "ready")} {label}</p>
        ))}
        <p className="text-sm">{(data.worker?.detail || "Worker not configured").replace(/^[🟢🟡🔴✅❌]\s*/, "")}</p>
        {data.gmailEmail ? <p className="mt-2 text-sm text-muted">Connected Gmail: {data.gmailEmail}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="la-btn la-btn-primary" disabled={Boolean(busy)} onClick={() => {
            setBusy("gmail");
            void googleStartFn({ data: { kind: "gmail", origin: window.location.origin } }).then((r) => {
              if (!r.ok) setErr(r.reason);
              else window.location.href = r.url;
              setBusy("");
            }).catch(() => { setErr("Could not start Gmail connect."); setBusy(""); });
          }}>Connect Gmail</button>
          <button className="la-btn la-btn-ghost" disabled={Boolean(busy)} onClick={() => {
            setBusy("cal");
            void googleStartFn({ data: { kind: "calendar", origin: window.location.origin } }).then((r) => {
              if (!r.ok) setErr(r.reason);
              else window.location.href = r.url;
              setBusy("");
            }).catch(() => { setErr("Could not start Calendar connect."); setBusy(""); });
          }}>Connect Google Calendar</button>
        </div>
        <button className="la-btn la-btn-primary mt-3" disabled={Boolean(busy)} onClick={() => {
          setBusy("probe");
          void connectionTestFn().then((r) => {
            setProbe({
              session: r.session,
              gmailToken: r.gmailToken,
              gmailIdentity: r.gmailIdentity,
              calendarToken: r.calendarToken,
              calendarFreeBusy: r.calendarFreeBusy,
              worker: r.worker,
            });
            setBusy("");
          }).catch(() => { setErr("Connection test did not finish. No email was sent."); setBusy(""); });
        }}>{busy === "probe" ? "Checking…" : "Run Connection Test"}</button>
        {probe ? (
          <div className="mt-3 space-y-1 text-sm">
            {Object.entries(probe).map(([k, v]) => (
              <p key={k}><span className={`la-dot la-dot-inline ${v.ok ? "la-dot-good" : "la-dot-bad"}`} />{v.detail}</p>
            ))}
            <p className="text-muted">This check does not send email.</p>
          </div>
        ) : null}
      </section>

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">Test allowlist</h3>
        <p className="mb-3 text-sm text-muted">Emails you add here are the only addresses Lamb Ascension may send to while Test Mode is on.</p>
        {data.allowlist.length ? data.allowlist.map((e) => (
          <div key={e} className="flex items-center justify-between border-b border-line py-2">
            <span>{e}</span>
            <button className="la-btn la-btn-ghost" onClick={() => void removeEmail(e)}>Remove</button>
          </div>
        )) : <p className="text-sm text-muted">Empty. Nothing can be sent until you add an address.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="la-field min-h-11 flex-1" placeholder="you@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <button className="la-btn la-btn-primary" disabled={busy === "allow"} onClick={() => void addEmail()}>Add</button>
        </div>
      </section>

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">Guided Test Sales Flow</h3>
        <p className="mb-3 text-sm text-muted">Step {Math.min(step, 11)} of 11. Each green check below requires real evidence.</p>

        <p className="text-sm font-semibold">STEP 1 — Choose an allowlisted test recipient</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {data.allowlist.map((e) => (
            <button key={e} className="la-btn la-btn-ghost" onClick={() => {
              setBusy("choose");
              void chooseTestRecipientFn({ data: { recipient: e } }).then((r) => {
                if (!r.ok) setErr(r.reason);
                else { setPreview(r.preview || null); setStep(2); setErr(""); }
                setBusy("");
              });
            }}>{e}</button>
          ))}
        </div>

        <p className="mt-4 text-sm font-semibold">STEP 2 — Preview test first email</p>
        {preview ? (
          <div className="mt-2 rounded-lg border border-line bg-surface2 p-3 text-sm">
            <p>Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.body}</pre>
          </div>
        ) : <p className="text-sm text-muted">Choose a recipient to see the preview.</p>}

        <p className="mt-4 text-sm font-semibold">STEP 3 — Confirm send</p>
        <button className="la-btn la-btn-primary mt-2" disabled={busy === "send" || !preview} onClick={() => {
          setBusy("send");
          void confirmTestSendFn().then((r) => {
            if (!r.ok) setErr(r.reason);
            else { setSendIds({ messageId: r.messageId, threadId: r.threadId }); setStep(4); setErr(""); }
            setBusy("");
            void refresh();
          });
        }}>{busy === "send" ? "Sending…" : "Confirm send"}</button>

        <p className="mt-4 text-sm font-semibold">STEP 4 — Verify Gmail IDs</p>
        {sendIds?.messageId ? (
          <p className="text-sm">Message ID: {sendIds.messageId}<br />Thread ID: {sendIds.threadId || "missing"}</p>
        ) : <p className="text-sm text-muted">Waiting for a confirmed send.</p>}

        <p className="mt-4 text-sm font-semibold">STEP 5 — Approve one test follow-up</p>
        <button className="la-btn la-btn-ghost mt-2" disabled={!sendIds?.messageId} onClick={() => {
          void approveTestFollowupFn().then((r) => {
            if (!r.ok) setErr(r.reason);
            else { setFollowMsg(`${r.pending} follow-up scheduled. It will only send to the allowlisted address.`); setStep(6); }
            void refresh();
          });
        }}>Approve test follow-up</button>
        {followMsg ? <p className="mt-2 text-sm">{followMsg}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 6 — Reply from the recipient inbox</p>
        <p className="text-sm text-muted">Open the test inbox, reply to the thread with any short message, then come back.</p>

        <p className="mt-4 text-sm font-semibold">STEP 7 — Sync replies</p>
        <button className="la-btn la-btn-ghost mt-2" onClick={() => {
          void syncTestRepliesFn().then((r) => {
            setReplyMsg(`${r.replies} new reply(ies). Follow-ups left: ${r.followupsLeft}.`);
            setStep(8);
            void refresh();
          });
        }}>Sync replies</button>
        {replyMsg ? <p className="mt-2 text-sm">{replyMsg}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 8 — Pending follow-up cancelled</p>
        <p className="text-sm text-muted">This turns green only if a follow-up existed and is gone after a real reply.</p>

        <p className="mt-4 text-sm font-semibold">STEP 9 — Generate a test booking link</p>
        <button className="la-btn la-btn-ghost mt-2" onClick={() => {
          void testBookingLinkFn({ data: { origin: window.location.origin } }).then((r) => {
            if (!r.ok) setErr(r.reason);
            else { setBookUrl(r.url); setSlots(r.slots); setStep(10); }
            void refresh();
          });
        }}>Create booking link</button>
        {bookUrl ? <p className="mt-2 break-all text-sm">{bookUrl}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 10 — Book one offered time</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {slots.map((s) => (
            <button key={s.start} className="la-btn la-btn-primary" onClick={() => {
              void testBookSlotFn({ data: { start: s.start, end: s.end } }).then((r) => {
                if (!r.ok) setErr(r.reason);
                else { setBooked(r.eventId); setStep(11); }
                void refresh();
              });
            }}>{s.label}</button>
          ))}
        </div>
        {booked ? <p className="mt-2 text-sm">Calendar event: {booked}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 11 — Verify calendar + pipeline</p>
        <p className="text-sm text-muted">Pipeline sync is green only when the test record is Call Booked and a real event id exists.</p>
      </section>

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">LIVE SALES SYSTEM TEST</h3>
        {data.checks.map((c) => (
          <p key={c.key} className="text-sm"><span className={`la-dot la-dot-inline ${c.ok ? "la-dot-good" : "la-dot-bad"}`} />{c.label}</p>
        ))}
        <p className="mt-3 text-sm text-muted">Checks stay red until the matching live evidence is stored. They are not guessed.</p>
      </section>

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">Turn Test Mode off</h3>
        <p className="mb-2 text-sm">It stays on until you type DISABLE and confirm. After that, normal send caps apply and the allowlist is no longer a gate.</p>
        <input className="la-field mb-2" placeholder="Type DISABLE" value={disableConfirm} onChange={(e) => setDisableConfirm(e.target.value)} />
        <button className="la-btn la-btn-ghost" onClick={() => {
          void saveTestModeFn({ data: { testMode: false, confirm: disableConfirm } }).then((r) => {
            if (!r.ok) setErr(r.reason);
            else void refresh();
          });
        }}>Disable Test Mode</button>
      </section>

      <button className="la-btn la-btn-ghost" onClick={onBack}>Back home</button>
    </div>
  );
}
