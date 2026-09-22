/**
 * Owner Desk — Email Campaigns card.
 * Create → members → Arm (authorize) → Pause / results.
 * Test Mode ribbon when campaign.testModeOnly.
 */
import { useCallback, useEffect, useState } from "react";
import {
  armEmailCampaignFn,
  cancelEmailCampaignFn,
  createEmailCampaignFn,
  enableLiveEmailCampaignFn,
  getEmailCampaignFn,
  listEmailCampaignsFn,
  pauseEmailCampaignFn,
  resumeEmailCampaignFn,
} from "@/lib/campaigns/actions";
import type { CampaignMember, CampaignReport, EmailCampaign } from "@/lib/campaigns/types";

type Props = {
  onBack: () => void;
  globalTestMode: boolean;
};

export function EmailCampaignsPanel({ onBack, globalTestMode }: Props) {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<CampaignMember[]>([]);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [verticals, setVerticals] = useState("");
  const [locations, setLocations] = useState("");
  const [liveConfirm, setLiveConfirm] = useState("");

  const refreshList = useCallback(async () => {
    const r = await listEmailCampaignsFn();
    if (r.ok) setCampaigns(r.campaigns);
  }, []);

  const openCampaign = useCallback(async (id: string) => {
    setSelectedId(id);
    setBusy(true);
    setMsg("");
    try {
      const r = await getEmailCampaignFn({ data: { id } });
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      setMembers(r.members);
      setReport(r.report);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const selected = campaigns.find((c) => c.id === selectedId) || null;
  const showTestRibbon = Boolean(
    globalTestMode || selected?.testModeOnly || (selected && !selected.liveEnabled),
  );

  async function onCreate() {
    setBusy(true);
    setMsg("");
    try {
      const r = await createEmailCampaignFn({
        data: {
          name: name.trim() || "Untitled campaign",
          verticals: verticals.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          locations: locations.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        },
      });
      if (!r.ok) return;
      setName("");
      await refreshList();
      await openCampaign(r.campaign.id);
      const m = r.membership;
      if (m && m.ok) {
        setMsg(`Draft created. Eligible ${m.eligible}, skipped ${m.skipped}. Nothing sent.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onArm() {
    if (!selectedId) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await armEmailCampaignFn({ data: { id: selectedId } });
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      setMsg(
        `Armed: ${r.authorized} authorized, ${r.skipped} skipped. ` +
          `Worker sends under caps` +
          (r.testModeOnly || !r.liveEnabled ? " + Test Mode allowlist" : "") +
          ". Arm does not send by itself.",
      );
      await refreshList();
      await openCampaign(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function onPause() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const r = await pauseEmailCampaignFn({ data: { id: selectedId } });
      setMsg(r.ok ? "Paused. New first contacts stop; reply sync continues." : r.reason);
      await refreshList();
      await openCampaign(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function onResume() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const r = await resumeEmailCampaignFn({ data: { id: selectedId } });
      setMsg(r.ok ? `Resumed (${r.status}).` : r.reason);
      await refreshList();
      await openCampaign(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const r = await cancelEmailCampaignFn({ data: { id: selectedId } });
      setMsg(r.ok ? "Cancelled." : r.reason);
      await refreshList();
      setSelectedId(null);
      setMembers([]);
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  async function onEnableLive() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const r = await enableLiveEmailCampaignFn({ data: { id: selectedId, confirm: liveConfirm } });
      setMsg(r.ok ? "Live enabled for this campaign. Global Test Mode may still apply." : r.reason);
      setLiveConfirm("");
      await refreshList();
      await openCampaign(selectedId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="la-card la-campaigns" data-testid="email-campaigns-panel">
      <header className="la-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Campaigns</h2>
          <p className="la-muted" style={{ margin: "4px 0 0" }}>
            Create → select eligible (email-only) → Arm once → worker sends under caps. Not per-lead Confirm forever.
          </p>
        </div>
        <button className="la-btn la-btn-ghost" type="button" onClick={onBack}>Back</button>
      </header>

      {showTestRibbon ? (
        <div className="la-chip" data-testid="campaign-test-mode-ribbon" style={{ marginTop: 12 }}>
          TEST MODE — allowlist required until you enable live for this campaign
        </div>
      ) : null}

      {msg ? <p className="la-muted" style={{ marginTop: 12 }}>{msg}</p> : null}

      <div className="la-card" style={{ marginTop: 16, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>New campaign</h3>
        <label className="la-field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dallas dental — week 1" />
        </label>
        <label className="la-field">
          Verticals (comma-separated)
          <input value={verticals} onChange={(e) => setVerticals(e.target.value)} placeholder="dental, med spa" />
        </label>
        <label className="la-field">
          Locations (comma-separated)
          <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Dallas, Fort Worth" />
        </label>
        <button className="la-btn" type="button" disabled={busy} onClick={() => void onCreate()}>
          Create (Test Mode)
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>Your campaigns</h3>
        {!campaigns.length ? <p className="la-muted">No campaigns yet.</p> : null}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {campaigns.map((c) => (
            <li key={c.id} style={{ marginBottom: 8 }}>
              <button
                className="la-btn la-btn-quiet"
                type="button"
                data-on={selectedId === c.id ? "1" : "0"}
                onClick={() => void openCampaign(c.id)}
              >
                {c.name} · {c.status}
                {c.testModeOnly || !c.liveEnabled ? " · TEST" : " · LIVE"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && report ? (
        <div className="la-card" style={{ marginTop: 16, padding: 12 }} data-testid="campaign-results-strip">
          <h3 style={{ marginTop: 0 }}>{selected.name}</h3>
          <p className="la-muted">
            Status <strong>{report.status}</strong>
            {" · "}
            eligible/authorized {report.counts.eligible + report.counts.authorized}
            {" · "}
            sent {report.counts.sent}
            {" · "}
            skipped {report.counts.skipped}
            {" · "}
            replied {report.counts.replied}
            {" · "}
            failed {report.counts.failed}
          </p>
          <div className="la-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="la-btn" type="button" disabled={busy || selected.status === "cancelled"} onClick={() => void onArm()}>
              Arm (authorize)
            </button>
            <button className="la-btn la-btn-quiet" type="button" disabled={busy} onClick={() => void onPause()}>
              Pause
            </button>
            <button className="la-btn la-btn-quiet" type="button" disabled={busy} onClick={() => void onResume()}>
              Resume
            </button>
            <button className="la-btn la-btn-ghost" type="button" disabled={busy} onClick={() => void onCancel()}>
              Cancel
            </button>
          </div>
          {!selected.liveEnabled ? (
            <div style={{ marginTop: 12 }}>
              <label className="la-field">
                Enable live (type ENABLE LIVE)
                <input value={liveConfirm} onChange={(e) => setLiveConfirm(e.target.value)} placeholder="ENABLE LIVE" />
              </label>
              <button className="la-btn la-btn-quiet" type="button" disabled={busy} onClick={() => void onEnableLive()}>
                Enable live for this campaign
              </button>
            </div>
          ) : null}
          <h4>Members</h4>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            <table className="la-table" style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Prospect</th>
                  <th>Status</th>
                  <th>Recipient</th>
                  <th>Skip / error</th>
                </tr>
              </thead>
              <tbody>
                {members.slice(0, 200).map((m) => (
                  <tr key={m.prospectUid}>
                    <td>{m.prospectUid}</td>
                    <td>{m.status}</td>
                    <td>{m.recipient || "—"}</td>
                    <td>{m.skipReason || m.lastError || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
