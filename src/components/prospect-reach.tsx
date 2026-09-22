"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
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
import {
  formatHistory,
  provenanceLabel,
  type ProspectInfoChanges,
  type ProspectInfoField,
} from "@/lib/prospects/owner-edit";

export type ProspectEditDraft = {
  decisionMakerName: string;
  decisionMakerRole: string;
  businessEmail: string;
  businessPhone: string;
  website: string;
  profileUrl: string;
  contactPage: string;
  linkedin: string;
  industry: string;
  city: string;
  notes: string;
};

function blank(v?: string | null): string {
  const s = (v || "").trim();
  if (!s || s.toUpperCase() === "UNKNOWN") return "";
  return s;
}

function draftFromProspect(p: Prospect): ProspectEditDraft {
  const people = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const primary = people[0] || (p.contacts || [])[0];
  const li = (p.socials || []).find((s) => s.network === "linkedin");
  const email = (p.contacts || []).find((c) => c.email && c.email.includes("@"))?.email || "";
  return {
    decisionMakerName: blank(primary?.name),
    decisionMakerRole: blank(primary?.title),
    businessEmail: blank(email),
    businessPhone: blank(p.phone),
    website: blank(p.website),
    profileUrl: blank(primary?.profile_url),
    contactPage: blank(p.contact_page),
    linkedin: blank(li?.url),
    industry: blank(p.vertical),
    city: blank(p.city),
    notes: blank(p.owner_notes),
  };
}

function diffChanges(from: ProspectEditDraft, to: ProspectEditDraft): ProspectInfoChanges {
  const changes: ProspectInfoChanges = {};
  (Object.keys(from) as (keyof ProspectEditDraft)[]).forEach((key) => {
    if ((from[key] || "") === (to[key] || "")) return;
    changes[key as ProspectInfoField] = to[key] ? to[key] : null;
  });
  return changes;
}

const EDIT_FIELDS: { key: keyof ProspectEditDraft; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: "decisionMakerName", label: "Decision maker", placeholder: "Add name" },
  { key: "decisionMakerRole", label: "Role", placeholder: "Add role" },
  { key: "businessEmail", label: "Business email", placeholder: "Add email" },
  { key: "businessPhone", label: "Business phone", placeholder: "Add phone" },
  { key: "website", label: "Website", placeholder: "https://" },
  { key: "profileUrl", label: "Profile", placeholder: "Add profile URL" },
  { key: "contactPage", label: "Contact page", placeholder: "Add contact page URL" },
  { key: "linkedin", label: "Company LinkedIn", placeholder: "Add LinkedIn URL" },
  { key: "industry", label: "Industry", placeholder: "What they sell" },
  { key: "city", label: "Location", placeholder: "City" },
  { key: "notes", label: "Owner note", placeholder: "Met them at… follow up in…", multiline: true },
];

export function ProspectReachCard({
  company,
  gmailConnected,
  busy,
  heading,
  saving,
  saveMsg,
  saveErr,
  onAction,
  onPersist,
  onDirtyChange,
  editApiRef,
}: {
  company: Prospect;
  gmailConnected?: boolean;
  busy?: boolean;
  heading?: string;
  saving?: boolean;
  saveMsg?: string;
  saveErr?: string;
  onAction: (id: ProspectActionId) => void;
  onPersist?: (changes: ProspectInfoChanges) => Promise<boolean> | boolean;
  onDirtyChange?: (dirty: boolean) => void;
  editApiRef?: MutableRefObject<{ save: () => Promise<boolean>; discard: () => void } | null>;
}) {
  const kind = reachKind(company);
  const tone = reachTone(kind);
  const fields = contactFields(company);
  const actions = prospectActions(company, { gmailConnected });
  const q = ownerQualify(company);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProspectEditDraft>(() => draftFromProspect(company));
  const [baseline, setBaseline] = useState<ProspectEditDraft>(() => draftFromProspect(company));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localErr, setLocalErr] = useState("");
  const history = useMemo(() => formatHistory((company.history || []) as Parameters<typeof formatHistory>[0]), [company.history]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const mostlyUnknown = fields.filter((f) => f.status === "UNKNOWN" && f.label !== "Owner note").length >= 5;
  const missingContact = !fields.some((f) => /email|phone|decision maker/i.test(f.label) && f.status !== "UNKNOWN");

  useEffect(() => {
    if (editing) return;
    const next = draftFromProspect(company);
    setDraft(next);
    setBaseline(next);
  }, [company, editing]);

  useEffect(() => {
    onDirtyChange?.(editing && dirty);
  }, [editing, dirty, onDirtyChange]);

  function enterEdit() {
    const next = draftFromProspect(company);
    setDraft(next);
    setBaseline(next);
    setLocalErr("");
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(baseline);
    setLocalErr("");
    setEditing(false);
    onDirtyChange?.(false);
  }

  async function saveEdit() {
    const changes = diffChanges(baseline, draft);
    if (!Object.keys(changes).length) {
      setEditing(false);
      onDirtyChange?.(false);
      return true;
    }
    const ok = onPersist ? await onPersist(changes) : true;
    if (ok) {
      setBaseline(draft);
      setEditing(false);
      setLocalErr("");
      onDirtyChange?.(false);
      return true;
    }
    setLocalErr(saveErr || "I couldn’t save that. Check the fields and try again.");
    return false;
  }

  if (editApiRef) {
    editApiRef.current = { save: saveEdit, discard: cancelEdit };
  }

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

      <div className="la-contact-head mt-4">
        <p className="la-kicker">Contact information</p>
        {!editing ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="la-btn la-btn-ghost" onClick={enterEdit}>
              {mostlyUnknown || missingContact ? "+ Add information" : "Edit information"}
            </button>
            {history.length ? (
              <button type="button" className="la-btn la-btn-quiet" onClick={() => setHistoryOpen((v) => !v)}>
                {historyOpen ? "Hide history" : "View history"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="la-contact-grid mt-3">
          {EDIT_FIELDS.map((f) => (
            <label key={f.key} className="la-contact-row">
              <span className="la-contact-label">{f.label}</span>
              {f.multiline ? (
                <textarea
                  className="la-field"
                  value={draft[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  className="la-field"
                  value={draft[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
          {localErr || saveErr ? <p className="text-sm text-bad">{localErr || saveErr}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="la-btn la-btn-primary" disabled={Boolean(saving)} onClick={() => void saveEdit()}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="la-btn la-btn-ghost" disabled={Boolean(saving)} onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="la-contact-grid mt-3">
          {fields.map((f) => (
            <div key={f.label} className="la-contact-row">
              <span className="la-contact-label">{f.label}</span>
              <span className="la-contact-value">{f.value}</span>
              {f.status !== "UNKNOWN" ? (
                <span className="la-contact-src">{provenanceLabel(f.status)}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {historyOpen && history.length ? (
        <div className="la-history mt-3">
          {history.map((h, i) => (
            <p key={`${h.at}-${i}`} className="text-xs text-muted">
              <b>{h.at}</b> {h.line} · {h.source}
            </p>
          ))}
        </div>
      ) : null}

      {saveMsg && !editing ? <p className="mt-2 text-sm">{saveMsg}</p> : null}

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
