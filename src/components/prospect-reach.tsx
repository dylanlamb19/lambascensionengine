"use client";

import type { Prospect } from "@/lib/review-brief";
import {
  araRecommend,
  contactFields,
  prospectActions,
  reachKind,
  reachLabel,
  reachTone,
  whatWeKnow,
  whySurfaced,
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
  return (
    <div className="la-reach">
      {heading ? <p className="la-kicker">{heading}</p> : null}
      <h2 className="font-display mt-2 text-2xl leading-tight">{company.name}</h2>
      <p className={`la-reach-state la-reach-${tone}`}>
        <span className={`la-dot la-dot-inline ${tone === "good" ? "la-dot-good" : tone === "bad" ? "la-dot-bad" : "la-dot-warn"}`} />
        {reachLabel(kind)}
      </p>
      <p className="mt-3 text-sm">{whySurfaced(company)}</p>
      <p className="mt-2 text-sm"><b>What we know:</b> {whatWeKnow(company).join(" · ")}</p>
      <p className="mt-2 text-sm text-muted"><b>Ara recommends:</b> {araRecommend(company)}</p>
      {gmailConnected === false && actions.some((a) => a.id === "draft_email" || a.id === "draft_outreach") ? (
        <p className="mt-2 text-sm text-muted">Connect Gmail to send from Lamb Ascension. You can still prepare a draft.</p>
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
