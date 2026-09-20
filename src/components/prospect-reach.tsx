"use client";

import type { Prospect } from "@/lib/review-brief";
import { ownerQualify } from "@/lib/prospects/qualify";
import {
  araRecommend,
  contactFields,
  prospectActions,
  reachKind,
  reachLabel,
  reachTone,
  whatWeKnow,
  type ProspectActionId,
} from "@/lib/prospects/reach";

export function ProspectReachCard({
  company,
  gmailConnected,
  busy,
  heading,
  onAction,
}: {
  company: Prospect;
  gmailConnected?: boolean;
  busy?: boolean;
  heading?: string;
  onAction: (id: ProspectActionId) => void;
}) {
  const kind = reachKind(company);
  const tone = reachTone(kind);
  const fields = contactFields(company);
  const actions = prospectActions(company, { gmailConnected });
  const q = ownerQualify(company);
  return (
    <div className="la-reach">
      {heading ? <p className="la-kicker">{heading}</p> : null}
      <h2 className="font-display mt-2 text-2xl leading-tight">{company.name}</h2>
      <p className={`la-reach-state la-reach-${tone}`}>
        <span className={`la-dot la-dot-inline ${tone === "good" ? "la-dot-good" : tone === "bad" ? "la-dot-bad" : "la-dot-warn"}`} />
        {q.headline} · {reachLabel(kind)}
      </p>
      <p className="mt-3 text-sm"><b>Who are they?</b> {q.who}</p>
      <p className="mt-1 text-sm"><b>What they sell:</b> {q.sells}</p>
      <p className="mt-2 text-sm"><b>Why they might be a good client</b></p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {q.why.slice(0, 6).map((w) => <li key={w}>{w}</li>)}
      </ul>
      <p className="mt-2 text-sm"><b>What lascengine found:</b> {q.found.join(" · ")}</p>
      {q.websiteResearch === "unavailable" ? (
        <p className="mt-2 text-sm text-muted">Website research unavailable. The Google listing is still kept.</p>
      ) : null}
      <p className="mt-2 text-sm text-muted"><b>Unknown:</b> {q.unknown.slice(0, 4).join(" · ")}</p>
      <p className="mt-2 text-sm"><b>Next:</b> {q.next}</p>
      <p className="mt-2 text-sm text-muted"><b>Ara recommends:</b> {araRecommend(company)}</p>
      <p className="mt-1 text-xs text-muted">{whatWeKnow(company).join(" · ")}</p>
      {gmailConnected === false && actions.some((a) => a.id === "draft_email" || a.id === "draft_outreach") ? (
        <p className="mt-2 text-sm text-muted">Connect Gmail to send from Lamb Ascension. You can still prepare a draft. Nothing sends until you confirm.</p>
      ) : null}
      <div className="la-contact-grid mt-4">
        {fields.map((f) => (
          <div key={f.label} className="la-contact-row">
            <span className="la-contact-label">{f.label}</span>
            <span className="la-contact-value">{f.value}</span>
            <span className="la-contact-src">{f.status}{f.source && f.status !== "UNKNOWN" ? ` · ${f.source}` : ""}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`la-btn ${a.primary ? "la-btn-primary" : "la-btn-ghost"}`}
            disabled={Boolean(busy) && (a.id === "find_contact" || a.id === "try_research")}
            onClick={() => onAction(a.id)}
          >
            {busy && (a.id === "find_contact" || a.id === "try_research") ? "Looking…" : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
