import { useState } from "react";
import { recordOutcomeFn, saveCallSupportFn } from "@/lib/autonomy/actions";
import { lifecycle } from "@/lib/autonomy/outcomes";
import { callGuide, discoveryQuestions, type CallNotes } from "@/lib/autonomy/sales";
import { opportunities, type Prospect } from "@/lib/review-brief";

const FIELDS: { key: keyof CallNotes; label: string }[] = [
  { key: "problem", label: "Main problem" },
  { key: "leadSource", label: "Current lead source" },
  { key: "leadVolume", label: "Qualified lead volume" },
  { key: "customerValue", label: "Customer value" },
  { key: "tried", label: "What they have tried" },
  { key: "frustration", label: "Biggest frustration" },
  { key: "desired", label: "Desired outcome" },
  { key: "timeline", label: "Timeline" },
  { key: "budget", label: "Budget discussed" },
  { key: "decisionMaker", label: "Decision maker" },
  { key: "objections", label: "Objections" },
  { key: "nextStep", label: "Next step" },
  { key: "notes", label: "Additional notes" },
];

export function CallSupport({ rows, onUpdated }: { rows: Prospect[]; onUpdated?: (row: Prospect) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<CallNotes>({});
  const [price, setPrice] = useState("");
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const calls = rows.filter((r) => lifecycle(r) === "BOOKED" || lifecycle(r) === "SHOWED");
  const due = rows.filter((r) => lifecycle(r) === "FOLLOW_UP_NEEDED" && (!r.follow_up_at || r.follow_up_at.slice(0, 10) <= today));
  const proposals = rows.filter((r) => r.proposal_draft && lifecycle(r) !== "WON" && lifecycle(r) !== "LOST");
  const clients = rows.filter((r) => r.client_record?.company);
  const active = rows.find((r) => r.uid === open);

  async function save(kind: "notes" | "draft" | "proposal") {
    if (!active?.uid) return;
    const result = await saveCallSupportFn({
      data: {
        uid: active.uid,
        notes,
        makeDraft: kind === "draft",
        makeProposal: kind === "proposal",
        price: price.trim() ? Number(price) : null,
        billing: "monthly",
      },
    });
    if (!result.ok) {
      setMsg(result.reason);
      return;
    }
    setMsg(kind === "draft" ? "Follow-up draft is ready. It was not sent." : kind === "proposal" ? "Proposal draft is ready. It was not sent." : "Notes saved.");
    onUpdated?.(result.prospect as Prospect);
  }

  return (
    <section className="la-card mb-5" data-call-support="1">
      <p className="la-kicker">Sales</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <p><b>{calls.length}</b> calls to prep</p>
        <p><b>{due.length}</b> need follow-up</p>
        <p><b>{proposals.length}</b> proposals to review</p>
        <p><b>{clients.length}</b> new clients</p>
      </div>
      {due.slice(0, 3).map((row) => (
        <p key={row.uid} className="mt-2 text-sm">{row.name} — follow up {row.follow_up_at || "when you can"}. {row.follow_up_reason || "No cold email."}</p>
      ))}
      {calls.slice(0, 3).map((row) => (
        <button key={row.uid} type="button" className="la-btn la-btn-quiet mt-2" onClick={() => { setOpen(row.uid || null); setNotes(row.call_notes || {}); setMsg(""); }}>
          {row.name} brief
        </button>
      ))}
      {active ? (
        <div className="mt-3 text-sm">
          <p className="font-display text-xl">{active.name}</p>
          <p className="mt-2">{active.vertical || "Category unknown"}{active.city ? ` in ${active.city}` : ""}. {active.website && active.website !== "UNKNOWN" ? active.website : "Website unknown."}</p>
          <p className="mt-2">Questions</p>
          <ul className="mt-1 list-disc pl-4">
            {discoveryQuestions({
              company: active.name || "",
              gaps: opportunities(active).map((o) => o.code),
              vertical: active.vertical,
            }).map((q) => <li key={q}>{q}</li>)}
          </ul>
          <p className="mt-2">Call shape</p>
          {callGuide({ company: active.name || "", gaps: opportunities(active).map((o) => o.code) }).slice(0, 4).map((line) => <p key={line} className="mt-1">{line}</p>)}
          <div className="mt-3 grid gap-2">
            {FIELDS.slice(0, 6).map((field) => (
              <label key={field.key} className="text-sm">{field.label}
                <input className="la-field mt-1" value={notes[field.key] || ""} onChange={(e) => setNotes({ ...notes, [field.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="la-btn la-btn-primary" onClick={() => void save("notes")}>Save notes</button>
            <button type="button" className="la-btn la-btn-quiet" onClick={() => void save("draft")}>Draft follow-up</button>
            <input className="la-field w-28" placeholder="Your price" value={price} onChange={(e) => setPrice(e.target.value)} />
            <button type="button" className="la-btn la-btn-quiet" onClick={() => void save("proposal")}>Create proposal</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="la-field" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button type="button" className="la-btn la-btn-quiet" onClick={() => {
              if (!active.uid) return;
              void recordOutcomeFn({ data: { uid: active.uid, kind: "FOLLOW_UP_NEEDED", followUpAt: when, followUpReason: notes.nextStep || notes.problem || "" } }).then((r) => {
                if (r.ok) onUpdated?.(r.prospect as Prospect);
                else setMsg(r.reason);
              });
            }}>Follow up later</button>
          </div>
          {active.followup_draft ? <pre className="mt-3 whitespace-pre-wrap text-sm">{active.followup_draft}</pre> : null}
          {active.proposal_draft ? <pre className="mt-3 whitespace-pre-wrap text-sm">{active.proposal_draft}</pre> : null}
          {msg ? <p className="mt-2">{msg}</p> : null}
          <p className="mt-2 text-muted">Nothing here is sent. You still decide the price and whether it goes out.</p>
        </div>
      ) : null}
    </section>
  );
}
