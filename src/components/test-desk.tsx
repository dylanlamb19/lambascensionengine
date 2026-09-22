"use client";

import { useEffect, useState } from "react";
import {
  approveTestFollowupFn,
  chooseTestRecipientFn,
  confirmTestSendFn,
  connectionTestFn,
  saveTestModeFn,
  syncTestRepliesFn,
  testBookingLinkFn,
  testBookSlotFn,
  testSettingsFn,
  calendarTestEventFn,
} from "@/lib/mail/actions";
import type { LiveCheck } from "@/lib/mail/test-mode";
import { startGoogleOAuth, isGoogleOauthMessage, type OauthMissing } from "@/lib/google/launch";
import { FLAGS } from "@/lib/flags";
import type { IntegrationStatus } from "@/lib/mail/integration-status";
import type { TestLoopState } from "@/lib/mail/test-loop";
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
  calendarEmail?: string;
  checks: LiveCheck[];
  integration?: IntegrationStatus;
  testLoop?: TestLoopState;
  trail?: { at: string; action: string; detail: string }[];
};

const LABELS: Record<string, string> = {
  googleOAuthClientId: "Google OAuth Client ID",
  googleOAuthClientSecret: "Google OAuth Client Secret",
  appSecret: "APP_SECRET",
  outreachJobSecret: "OUTREACH_JOB_SECRET",
  gmailConnection: "Gmail connection",
  calendarConnection: "Calendar connection",
};

const TRAIL_LABEL: Record<string, string> = {
  test_workflow_created: "test workflow created",
  test_draft_created: "draft created",
  initial_send_approved: "initial email approved",
  initial_send_result: "initial send result",
  sent: "initial send result",
  followup_approved: "follow-up approved",
  worker_claimed: "worker claimed follow-up",
  test_followup_sent: "follow-up sent",
  reply: "inbound reply detected",
  followups_cancelled: "remaining follow-ups cancelled",
  FOLLOWUP_CANCEL_FAILED: "FOLLOWUP_CANCEL_FAILED",
  UNKNOWN_DELIVERY: "UNKNOWN_DELIVERY",
};

function mark(ok: boolean) {
  return ok
    ? <><span className="la-dot la-dot-inline la-dot-good" />Ready</>
    : <><span className="la-dot la-dot-inline la-dot-bad" />Missing</>;
}

export function TestDesk({
  onBack,
  onTestModeChange,
  onIntegration,
  onTestLoop,
}: {
  onBack: () => void;
  onTestModeChange?: (on: boolean, allowlist: string[]) => void;
  onIntegration?: (status: IntegrationStatus) => void;
  onTestLoop?: (loop: TestLoopState) => void;
}) {
  const [data, setData] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [disableConfirm, setDisableConfirm] = useState("");
  const [disableErr, setDisableErr] = useState("");
  const [disableMsg, setDisableMsg] = useState("");
  const [probe, setProbe] = useState<Record<string, { ok: boolean; detail: string; email?: string }> | null>(null);
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState<{ recipient?: string; subject?: string; body?: string } | null>(null);
  const [followPreview, setFollowPreview] = useState<{ recipient?: string; subject?: string; body?: string } | null>(null);
  const [sendIds, setSendIds] = useState<{ messageId?: string; threadId?: string } | null>(null);
  const [followMsg, setFollowMsg] = useState("");
  const [followDue, setFollowDue] = useState("");
  const [stageErr, setStageErr] = useState("");
  const [replyMsg, setReplyMsg] = useState("");
  const [bookUrl, setBookUrl] = useState("");
  const [slots, setSlots] = useState<{ start: string; end: string; label: string }[]>([]);
  const [booked, setBooked] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiMeta, setOpenaiMeta] = useState<{ hasKey: boolean; envKey: boolean; last4: string | null; status: string } | null>(null);
  const [openaiMsg, setOpenaiMsg] = useState("");
  const [googleMsg, setGoogleMsg] = useState("");
  const [googleErr, setGoogleErr] = useState("");
  const [googleMissing, setGoogleMissing] = useState<OauthMissing[]>([]);
  const [googleNext, setGoogleNext] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [calTestMsg, setCalTestMsg] = useState("");
  const [calTestId, setCalTestId] = useState("");

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
        calendarEmail: r.calendarEmail,
        checks: r.checks,
        integration: r.integration,
        testLoop: r.testLoop,
        trail: r.trail,
      });
      setStep(r.state.step || 1);
      if (r.state.message_id) setSendIds({ messageId: r.state.message_id, threadId: r.state.thread_id || undefined });
      if (r.integration) onIntegration?.(r.integration);
      if (r.testLoop) onTestLoop?.(r.testLoop);
      if (r.testLoop?.followupDueAt) setFollowDue(r.testLoop.followupDueAt);
    }
  }

  useEffect(() => { void refresh().catch(() => setErr("Could not load Test Mode settings.")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!isGoogleOauthMessage(e.data)) return;
      if (e.data.status === "connected") {
        setGoogleErr("");
        setGoogleMsg("Google connected. Refreshing…");
        void refresh();
      } else {
        setGoogleErr("Google sign-in didn’t finish. Nothing was connected.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!FLAGS.DESIGN_DIRECTOR) return;
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
      else {
        setNewEmail("");
        setData({ ...data, allowlist: r.allowlist, testMode: r.testMode, caps: r.caps, checks: r.checks, integrations: r.integrations as View["integrations"], gmailEmail: r.gmailEmail });
        onTestModeChange?.(r.testMode, r.allowlist);
      }
    } catch { setErr("Could not save the allowlist."); }
    setBusy("");
  }

  async function removeEmail(email: string) {
    if (!data) return;
    const r = await saveTestModeFn({ data: { allowlist: data.allowlist.filter((e) => e !== email) } });
    if (r.ok) {
      setData({ ...data, allowlist: r.allowlist, checks: r.checks, integrations: r.integrations as View["integrations"], gmailEmail: r.gmailEmail, testMode: r.testMode, caps: r.caps });
      onTestModeChange?.(r.testMode, r.allowlist);
    }
  }

  async function disableTestMode() {
    if (!data) return;
    if (busy === "disable") return;
    const confirm = disableConfirm.trim();
    if (confirm !== "DISABLE") {
      setDisableErr("Type DISABLE exactly to continue.");
      setDisableMsg("");
      return;
    }
    setBusy("disable");
    setDisableErr("");
    setDisableMsg("");
    setErr("");
    try {
      const r = await saveTestModeFn({ data: { testMode: false, confirm } });
      if (!r.ok) {
        setDisableErr(r.reason || "Couldn’t disable Test Mode. Please try again.");
      } else if (r.testMode !== false) {
        setDisableErr("Server could not save the setting.");
      } else {
        setData({
          ...data,
          testMode: false,
          allowlist: r.allowlist,
          caps: r.caps,
          checks: r.checks,
          integrations: r.integrations as View["integrations"],
          gmailEmail: r.gmailEmail,
        });
        setDisableMsg("Test Mode is off. Live outreach rules now apply.");
        setDisableConfirm("");
        onTestModeChange?.(false, r.allowlist);
        await refresh();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDisableErr(/unauthor/i.test(msg) ? "Your session expired. Sign in again." : "Couldn’t disable Test Mode. Please try again.");
    }
    setBusy("");
  }

  async function connectGoogle(kind: "gmail" | "calendar") {
    if (busy) return;
    setBusy(kind);
    setGoogleErr("");
    setGoogleMsg("");
    setGoogleMissing([]);
    setGoogleNext("");
    setGoogleUrl("");
    try {
      const r = await startGoogleOAuth(kind, {
        allowPopup: data?.integrations.googleOAuthClientId === "ready" && data?.integrations.googleOAuthClientSecret === "ready",
      });
      setGoogleMissing(r.missing);
      setGoogleNext(r.next);
      if (r.url) setGoogleUrl(r.url);
      if (!r.ok) setGoogleErr(r.reason);
      else setGoogleMsg(r.reason);
    } catch {
      setGoogleErr("Could not start Google sign-in. Nothing was connected.");
    }
    setBusy("");
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

      {FLAGS.DESIGN_DIRECTOR ? (
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
      ) : null}

      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">Integrations</h3>
        <p className="mb-3 text-sm text-muted">Secrets are never shown. Ready means the value is set, not that it is correct.</p>
        {Object.entries(LABELS).map(([k, label]) => (
          <p key={k} className="text-sm">{mark(data.integrations[k] === "ready")} {label}</p>
        ))}
        <p className="text-sm">{(data.worker?.detail || "Worker not configured").replace(/^[🟢🟡🔴✅❌]\s*/u, "")}</p>
        {data.gmailEmail ? <p className="mt-2 text-sm text-muted">Connected Gmail: {data.gmailEmail}</p> : null}
        {data.calendarEmail ? <p className="text-sm text-muted">Connected Calendar: {data.calendarEmail}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="la-btn la-btn-primary" disabled={Boolean(busy)} onClick={() => void connectGoogle("gmail")}>
            {busy === "gmail" ? "Connecting…" : "Connect Gmail"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" disabled={Boolean(busy)} onClick={() => void connectGoogle("calendar")}>
            {busy === "calendar" ? "Connecting…" : "Connect Google Calendar"}
          </button>
        </div>
        {googleErr ? (
          <div className="la-ribbon la-ribbon-bad mt-3" data-testid="google-connect-err">
            <p>{googleErr}</p>
            {googleMissing.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {googleMissing.map((m) => (
                  <li key={m.name}>{m.name} — {m.ready ? "Ready" : "Missing"}</li>
                ))}
              </ul>
            ) : null}
            {googleNext ? <p className="mt-2 text-sm">{googleNext}</p> : null}
            {googleUrl ? (
              <p className="mt-2 text-sm">
                <a className="underline" href={googleUrl} target="_blank" rel="noreferrer">Continue with Google</a>
              </p>
            ) : null}
          </div>
        ) : null}
        {googleMsg ? <div className="la-ribbon la-ribbon-good mt-3">{googleMsg}</div> : null}
        <button className="la-btn la-btn-primary mt-3" disabled={Boolean(busy)} onClick={() => {
          setBusy("probe");
          void connectionTestFn().then((r) => {
            setProbe({
              session: r.session,
              gmailToken: r.gmailToken,
              gmailIdentity: r.gmailIdentity,
              calendarToken: r.calendarToken,
              calendarIdentity: r.calendarIdentity,
              calendarFreeBusy: r.calendarFreeBusy,
              worker: r.worker,
            });
            if (r.integration) onIntegration?.(r.integration);
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
        {data.testMode ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted">Internal Calendar test — no prospect is contacted, no guests are invited.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="la-btn la-btn-ghost"
                disabled={Boolean(busy)}
                onClick={() => {
                  setBusy("caltest");
                  setCalTestMsg("");
                  void calendarTestEventFn({ data: { action: "create" } })
                    .then((r) => {
                      if (!r.ok) setCalTestMsg(r.reason);
                      else if ("visibleInEngine" in r) {
                        setCalTestId(r.eventId);
                        setCalTestMsg(`Created “LambAscensionEngine Calendar Test”${r.visibleInEngine ? " and lascengine can see it." : "."} No prospect was contacted.`);
                      }
                      setBusy("");
                    })
                    .catch(() => { setCalTestMsg("Could not create the Calendar test event."); setBusy(""); });
                }}
              >
                {busy === "caltest" ? "Creating…" : "Create Calendar test event"}
              </button>
              {calTestId ? (
                <button
                  type="button"
                  className="la-btn la-btn-ghost"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setBusy("caldel");
                    void calendarTestEventFn({ data: { action: "delete", eventId: calTestId } })
                      .then((r) => {
                        if (!r.ok) setCalTestMsg(r.reason);
                        else {
                          setCalTestMsg("Test event deleted.");
                          setCalTestId("");
                        }
                        setBusy("");
                      })
                      .catch(() => { setCalTestMsg("Could not delete the test event."); setBusy(""); });
                  }}
                >
                  Delete test event
                </button>
              ) : null}
            </div>
            {calTestMsg ? <p className="text-sm">{calTestMsg}</p> : null}
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
                else {
                  setPreview(r.preview || null);
                  setFollowPreview("followupPreview" in r ? r.followupPreview || null : null);
                  setStep(2);
                  setErr("");
                }
                setBusy("");
              });
            }}>{e}</button>
          ))}
        </div>

        <p className="mt-4 text-sm font-semibold">STEP 2 — Preview test first email</p>
        {preview ? (
          <div className="mt-2 rounded-lg border border-line bg-surface2 p-3 text-sm">
            {preview.recipient ? <p>Recipient: {preview.recipient}</p> : null}
            <p>Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.body}</pre>
          </div>
        ) : <p className="text-sm text-muted">Choose a recipient to see the preview.</p>}

        <p className="mt-4 text-sm font-semibold">STEP 3 — Confirm send</p>
        <p className="text-sm text-muted">Review the exact recipient, subject, and body above. Only this button sends. “yes” / “okay” will not send.</p>
        <button className="la-btn la-btn-primary mt-2" disabled={busy === "send" || !preview} onClick={() => {
          setBusy("send");
          setStageErr("");
          void confirmTestSendFn().then((r) => {
            if (!r.ok) {
              setErr(r.reason);
              setStageErr("code" in r && r.code ? String(r.code) : "INITIAL_SEND_FAILED");
            } else { setSendIds({ messageId: r.messageId, threadId: r.threadId }); setStep(4); setErr(""); }
            setBusy("");
            void refresh();
          });
        }}>{busy === "send" ? "Sending…" : "Confirm send"}</button>

        <p className="mt-4 text-sm font-semibold">STEP 4 — Verify Gmail IDs</p>
        {sendIds?.messageId ? (
          <p className="text-sm">Message ID: {sendIds.messageId}<br />Thread ID: {sendIds.threadId || "missing"}</p>
        ) : <p className="text-sm text-muted">Waiting for a confirmed send.</p>}

        <p className="mt-4 text-sm font-semibold">STEP 5 — Approve the test follow-up schedule</p>
        <p className="text-sm text-muted">This freezes one short follow-up (~8 minutes) plus one later follow-up that must cancel if they reply. Real prospect timing is unchanged.</p>
        {followPreview ? (
          <div className="mt-2 rounded-lg border border-line bg-surface2 p-3 text-sm">
            {followPreview.recipient ? <p>Recipient: {followPreview.recipient}</p> : null}
            <p>Subject: {followPreview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{followPreview.body}</pre>
          </div>
        ) : null}
        <button className="la-btn la-btn-ghost mt-2" disabled={!sendIds?.messageId} onClick={() => {
          setStageErr("");
          void approveTestFollowupFn().then((r) => {
            if (!r.ok) {
              setErr(r.reason);
              setStageErr("code" in r && r.code ? String(r.code) : "FOLLOWUP_SCHEDULE_FAILED");
            } else {
              const due = "dueAt" in r ? r.dueAt : "";
              setFollowDue(due || "");
              setFollowMsg(`${r.pending} follow-up(s) scheduled. The short one sends only to the allowlisted address, even if you close this page.`);
              setStep(6);
            }
            void refresh();
          });
        }}>Approve test follow-up</button>
        {followMsg ? <p className="mt-2 text-sm">{followMsg}</p> : null}
        {followDue ? <p className="mt-1 text-sm">Short follow-up due: {new Date(followDue).toLocaleString()}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 6 — Close this page</p>
        <p className="text-sm text-muted">Leave LambAscensionEngine. Do not reply yet. The GitHub Actions worker should send the short follow-up automatically.</p>

        <p className="mt-4 text-sm font-semibold">STEP 7 — After the follow-up arrives, reply “Test reply.”</p>
        <p className="text-sm text-muted">Reply from the allowlisted inbox to the same thread, then you can close the browser again.</p>

        <p className="mt-4 text-sm font-semibold">STEP 8 — Worker detects the reply</p>
        <p className="text-sm text-muted">The next worker tick syncs Gmail first, stores the reply, and cancels remaining follow-ups. You can also press Sync replies after reopening.</p>
        <button className="la-btn la-btn-ghost mt-2" onClick={() => {
          setStageErr("");
          void syncTestRepliesFn().then((r) => {
            if (!r.ok) {
              setErr(r.reason);
              setStageErr("code" in r && r.code ? String(r.code) : "REPLY_SYNC_FAILED");
              if ("followupsLeft" in r) setReplyMsg(`Follow-ups left: ${r.followupsLeft}.`);
            } else {
              setReplyMsg(`${r.replies} new reply(ies). Follow-ups left: ${r.followupsLeft}.`);
              setStep(9);
            }
            void refresh();
          });
        }}>Sync replies</button>
        {replyMsg ? <p className="mt-2 text-sm">{replyMsg}</p> : null}
        {stageErr ? <p className="mt-2 text-sm">{stageErr}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 9 — Remaining follow-ups cancelled</p>
        <p className="text-sm text-muted">This turns green only if a follow-up existed and is gone after a real reply. Ask Ara: “Did they reply?” and “Are any more follow-ups scheduled?”</p>

        <p className="mt-4 text-sm font-semibold">STEP 10 — Optional: generate a test booking link</p>
        <button className="la-btn la-btn-ghost mt-2" onClick={() => {
          void testBookingLinkFn({ data: { origin: window.location.origin } }).then((r) => {
            if (!r.ok) setErr(r.reason);
            else { setBookUrl(r.url); setSlots(r.slots); setStep(10); }
            void refresh();
          });
        }}>Create booking link</button>
        {bookUrl ? <p className="mt-2 break-all text-sm">{bookUrl}</p> : null}

        <p className="mt-4 text-sm font-semibold">STEP 11 — Optional: book one offered time</p>
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
        <h3 className="font-display mb-2 text-lg">TEST activity log</h3>
        {data.trail?.length ? data.trail.map((row) => (
          <p key={`${row.at}-${row.action}`} className="text-sm">
            {TRAIL_LABEL[row.action] || row.action} — {row.detail}
          </p>
        )) : <p className="text-sm text-muted">No test activity yet.</p>}
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
        {data.testMode ? (
          <>
            <p className="mb-2 text-sm">It stays on until you type DISABLE and confirm. After that, the test allowlist is no longer a gate. First-contact approval and send safeguards stay on.</p>
            <input
              className="la-field mb-2"
              placeholder="Type DISABLE"
              value={disableConfirm}
              autoComplete="off"
              onChange={(e) => {
                setDisableConfirm(e.target.value);
                setDisableErr("");
                setDisableMsg("");
              }}
            />
            <button
              type="button"
              className="la-btn la-btn-ghost"
              disabled={disableConfirm.trim() !== "DISABLE" || busy === "disable"}
              onClick={() => void disableTestMode()}
            >
              {busy === "disable" ? "Disabling…" : "Disable Test Mode"}
            </button>
            {disableConfirm.trim() && disableConfirm.trim() !== "DISABLE" ? (
              <p className="mt-2 text-sm text-muted">Type DISABLE exactly to continue.</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm">Test Mode is off. Live outreach rules now apply. First-contact approval and send safeguards stay on.</p>
        )}
        {disableErr ? <div className="la-ribbon la-ribbon-bad mt-2">{disableErr}</div> : null}
        {disableMsg ? <div className="la-ribbon la-ribbon-good mt-2">{disableMsg}</div> : null}
      </section>

      <button className="la-btn la-btn-ghost" onClick={onBack}>Back home</button>
    </div>
  );
}
