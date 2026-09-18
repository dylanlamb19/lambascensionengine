"use client";

import { useState } from "react";
import { approveSequenceFn } from "@/lib/mail/actions";
import type { Prospect } from "@/lib/review-brief";
import { classifyReply, draftReply } from "@/lib/outreach/reply";
import { DISCOVERY_QUESTIONS, qualifyValueOffer } from "@/lib/outreach/discovery";
import { GMAIL_NOT_CONNECTED } from "@/lib/outreach/gmail";
import type { DiscoveryAnswers, OutreachMessage } from "@/lib/outreach/types";

export function OutreachDesk({
  company,
  onSave,
  onExplain,
  onBack,
  onCall,
  onPrep,
  onSend,
  gmailConnected,
}: {
  company: Prospect;
  onSave: (next: Prospect) => void;
  onExplain: () => void;
  onBack: () => void;
  onCall: () => void;
  onPrep: () => void;
  onSend?: () => void;
  gmailConnected?: boolean;
}) {
  const pack = company.outreach;
  const email = pack?.messages.find((m) => m.kind === "email");
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(email?.body || "");
  const [tab, setTab] = useState<"email" | "follow" | "linkedin" | "history">("email");
  if (!pack || !email) {
    return (
      <section className="la-card">
        <p>No message yet. Go back and approve this prospect first.</p>
        <button className="la-btn la-btn-ghost mt-3" onClick={onBack}>Back</button>
      </section>
    );
  }

  function patchMessage(kind: OutreachMessage["kind"], patch: Partial<OutreachMessage>) {
    onSave({
      ...company,
      outreach: {
        ...pack!,
        messages: pack!.messages.map((m) => m.kind === kind ? { ...m, ...patch } : m),
      },
    });
  }

  const stopped = company.suppressed || company.stage === "Do Not Contact";

  return (
    <div className="space-y-4">
      {company.is_demo ? <p className="la-note">DEMO record — for testing different business types. Not a real company.</p> : null}
      <section className="la-card la-card-accent">
        <p className="la-kicker">Your message for {company.name} is ready.</p>
        <h2 className="font-display mt-2 text-2xl">{company.name}</h2>
        <p className="mt-1 text-sm text-muted">{email.state} · first contact still needs your approval before Gmail sends</p>
      </section>

      <section className="la-card">
        <h3 className="font-display mb-3 text-lg">Outreach brief</h3>
        <p><b>Who:</b> {pack.brief.who}</p>
        <p className="mt-2"><b>Why contact:</b> {pack.brief.why}</p>
        <p className="mt-2"><b>Who to contact:</b> {pack.brief.decision_maker}</p>
        <p className="mt-2"><b>How we may help:</b> {pack.brief.help}</p>
        <p className="mt-2"><b>Angle:</b> {pack.brief.angle}</p>
        <p className="mt-2 text-sm text-muted"><b>Still unknown:</b> {pack.brief.unknown.join("; ")}</p>
      </section>

      <div className="la-tabs">
        {(["email", "follow", "linkedin", "history"] as const).map((t) => (
          <button key={t} className="la-tab" data-on={tab === t ? "1" : "0"} onClick={() => setTab(t)}>
            {t === "email" ? "Email" : t === "follow" ? "Follow-ups" : t === "linkedin" ? "LinkedIn" : "History"}
          </button>
        ))}
      </div>

      {tab === "email" ? (
        <section className="la-card">
          <p className="text-sm text-muted">Subject: {email.subject}</p>
          {edit ? (
            <textarea className="la-field mt-2 min-h-40" value={body} onChange={(e) => setBody(e.target.value)} />
          ) : (
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{email.body}</pre>
          )}
          <p className="mt-3 text-sm text-muted">
            {gmailConnected
              ? <><span className="la-dot la-dot-inline la-dot-good" />Gmail connected</>
              : GMAIL_NOT_CONNECTED}
          </p>
          {stopped ? <p className="mt-2 text-sm">This person is on Do Not Contact. Sequence is stopped.</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {edit ? (
              <button className="la-btn la-btn-primary" onClick={() => { patchMessage("email", { body, state: "READY FOR REVIEW" }); setEdit(false); }}>Save edit</button>
            ) : (
              <button className="la-btn la-btn-ghost" onClick={() => { setBody(email.body); setEdit(true); }}>Edit</button>
            )}
            <button className="la-btn la-btn-primary" disabled={stopped || email.state === "SENT" || email.state === "SENDING"} onClick={() => {
              patchMessage("email", { state: "APPROVED" });
              onSend?.();
            }}>Approve & send</button>
            <button className="la-btn la-btn-ghost" onClick={() => {
              void navigator.clipboard?.writeText(`Subject: ${email.subject}\n\n${email.body}`);
            }}>Copy draft</button>
            <button className="la-btn la-btn-ghost" onClick={onCall}>Call</button>
            <button className="la-btn la-btn-ghost" onClick={onPrep}>Call prep</button>
            <button className="la-btn la-btn-ghost" onClick={onExplain}>Explain this</button>
            <button className="la-btn la-btn-ghost" onClick={() => onSave({
              ...company, suppressed: true, stage: "Do Not Contact", stage_plain: "Skipped — do not contact",
              history: [...(company.history || []), { at: new Date().toISOString(), action: "stop", detail: "Manual stop / Do Not Contact" }],
            })}>Stop / Do not contact</button>
            <button className="la-btn la-btn-ghost" onClick={onBack}>Back</button>
          </div>
        </section>
      ) : null}

      {tab === "follow" ? (
        <section className="la-card">
          {pack.messages.filter((m) => m.kind.startsWith("follow")).map((m) => (
            <div key={m.kind} className="mb-4 border-b border-line pb-3">
              <b>{m.kind}</b>
              <pre className="whitespace-pre-wrap font-sans text-sm">{m.body}</pre>
            </div>
          ))}
          <p className="text-sm text-muted">This prospect has 3 follow-ups scheduled over 12 days. Approve this sequence?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="la-btn la-btn-primary" disabled={stopped || !company.uid} onClick={() => {
              if (!company.uid) return;
              void approveSequenceFn({ data: { uid: company.uid } });
              onSave({
                ...company,
                history: [...(company.history || []), { at: new Date().toISOString(), action: "approve_sequence", detail: "Approved 3 follow-ups over 12 days" }],
              });
            }}>Approve sequence</button>
          </div>
          <p className="mt-3 text-sm text-muted">Follow-ups stop if they reply, unsubscribe, bounce, Gmail disconnects, or you press Stop.</p>
        </section>
      ) : null}

      {tab === "linkedin" ? (
        <section className="la-card">
          {pack.messages.find((m) => m.kind === "linkedin") ? (
            <pre className="whitespace-pre-wrap font-sans text-sm">{pack.messages.find((m) => m.kind === "linkedin")!.body}</pre>
          ) : <p>No LinkedIn draft — we don’t have a verified person/profile. We will not guess one.</p>}
          <p className="mt-3 text-sm text-muted">Draft only. This app does not automate LinkedIn.</p>
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="la-card">
          {(company.history || []).length ? company.history!.map((h, i) => (
            <div key={i} className="la-list-row text-sm"><div><b>{h.action}</b> · {h.detail}<div className="text-muted">{h.at}</div></div></div>
          )) : <p className="text-sm">No contact history yet.</p>}
          <p className="mt-3 text-xs text-muted">Advanced: generator {pack.generator} · est. {pack.estimated_cents}¢ · fingerprint {pack.fingerprint.slice(0, 80)}</p>
        </section>
      ) : null}
    </div>
  );
}

export function CallCard({ company, onBack }: { company: Prospect; onBack: () => void }) {
  const call = company.outreach?.call;
  return (
    <section className="la-card la-card-accent">
      <p className="la-kicker">Here’s what to say</p>
      <h2 className="font-display mt-2 text-2xl">Call {company.name}</h2>
      {call ? (
        <>
          <p className="mt-3"><b>Who:</b> {call.who}</p>
          <p className="mt-2"><b>Why:</b> {call.why}</p>
          <p className="mt-2"><b>One verified point:</b> {call.point}</p>
          <p className="mt-3 whitespace-pre-wrap">{call.opener}</p>
          <p className="mt-3 text-sm">Next question: {call.next_question}</p>
        </>
      ) : <p>Generate outreach first.</p>}
      {company.phone && company.phone !== "UNKNOWN" ? <p className="mt-3">Public phone on file: {company.phone}</p> : <p className="mt-3">Phone: UNKNOWN</p>}
      <button className="la-btn la-btn-ghost mt-4" onClick={onBack}>Back</button>
    </section>
  );
}

export function PrepCard({
  company, onSave, onBack,
}: {
  company: Prospect;
  onSave: (next: Prospect) => void;
  onBack: () => void;
}) {
  const pack = company.outreach;
  const answers = company.discovery || {};
  const fit = qualifyValueOffer(answers);
  const [draft, setDraft] = useState("");
  const named = (company.contacts || []).find((c) => c.name && c.name !== "UNKNOWN");

  function setField(key: keyof DiscoveryAnswers, value: string) {
    onSave({ ...company, discovery: { ...answers, [key]: value } });
  }

  return (
    <div className="space-y-4">
      <section className="la-card la-card-accent">
        <p className="la-kicker">Call prep</p>
        <h2 className="font-display mt-2 text-2xl">{company.name}</h2>
        <p className="mt-3"><b>Who they are:</b> {pack?.brief.who || company.vertical}</p>
        <p className="mt-2"><b>Why we contacted:</b> {pack?.brief.angle || "UNKNOWN"}</p>
        <p className="mt-2"><b>What we know:</b> {(pack?.brief.why) || "See research."}</p>
        <p className="mt-2 text-sm text-muted"><b>What we do NOT know:</b> {pack?.brief.unknown.join("; ")}</p>
        <p className="mt-2"><b>Offer that might fit:</b> {pack?.brief.help}</p>
        <p className="mt-2 text-sm">Avoid claiming revenue, ad spend, ROAS, or that they can pay $10K.</p>
      </section>
      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">Questions to ask (do not assume answers)</h3>
        <ul className="list-disc pl-5 text-sm">{DISCOVERY_QUESTIONS.map((q) => <li key={q}>{q}</li>)}</ul>
      </section>
      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">$10K offer — client-provided only</h3>
        <p className="mb-2 font-semibold">{fit.fit}</p>
        <ul className="mb-3 list-disc pl-5 text-sm">{fit.why.map((w) => <li key={w}>{w}</li>)}</ul>
        <label className="la-label">Average customer/client value</label>
        <input className="la-field mb-3" value={answers.customer_value || ""} onChange={(e) => setField("customer_value", e.target.value)} />
        <label className="la-label">Monthly ad budget</label>
        <input className="la-field mb-3" value={answers.monthly_ad_budget || ""} onChange={(e) => setField("monthly_ad_budget", e.target.value)} />
        <label className="la-label">Capacity</label>
        <input className="la-field mb-3" value={answers.capacity || ""} onChange={(e) => setField("capacity", e.target.value)} />
        <label className="la-label">Current channels</label>
        <input className="la-field" value={answers.current_channels || ""} onChange={(e) => setField("current_channels", e.target.value)} />
      </section>
      <section className="la-card">
        <h3 className="font-display mb-2 text-lg">They replied (paste it)</h3>
        <textarea className="la-field min-h-24" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="la-btn la-btn-primary mt-3" onClick={() => {
          if (!draft.trim()) return;
          const cls = classifyReply(draft);
          if (cls === "UNSUBSCRIBE") {
            onSave({
              ...company, suppressed: true, stage: "Do Not Contact", stage_plain: "Skipped — do not contact",
              history: [...(company.history || []), { at: new Date().toISOString(), action: "unsub", detail: draft.slice(0, 200) }],
            });
            return;
          }
          const reply = draftReply(cls, named?.name || "UNKNOWN");
          onSave({
            ...company,
            stage: "Replied",
            stage_plain: "They wrote back",
            history: [...(company.history || []), { at: new Date().toISOString(), action: `reply:${cls}`, detail: reply.slice(0, 240) }],
          });
        }}>Classify + draft (do not send)</button>
      </section>
      <button className="la-btn la-btn-ghost" onClick={onBack}>Back</button>
    </div>
  );
}
