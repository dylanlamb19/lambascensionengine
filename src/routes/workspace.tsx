import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/workspace")({
  component: WorkspacePage,
});

type SettingsBody = {
  ok?: boolean;
  reason?: string;
  role?: string;
  brand?: {
    name?: string;
    logoUrl?: string;
    primary?: string;
    accent?: string;
    senderDisplayName?: string;
    timezone?: string;
  };
  checklist?: { plan?: boolean; brand?: boolean; firstClient?: boolean; firstPackage?: boolean; complete?: boolean };
  billing?: { planName?: string; subscriptionStatus?: string; amountCents?: number; clients?: number; enrollments?: number };
  members?: { userId: string; email: string; role: string }[];
  csrfToken?: string;
};

function WorkspacePage() {
  if (!FLAGS.SELF_SERVE_SIGNUP) {
    return (
      <main className="la-login la-shell" data-workspace-settings="closed">
        <section className="la-card">
          <p className="la-kicker">Workspace</p>
          <h1 className="font-display mt-2 text-3xl">Workspace settings are off</h1>
          <p className="mt-3 text-sm text-muted">Branding and member changes stay closed while self-serve signup is off.</p>
        </section>
      </main>
    );
  }
  return <WorkspaceSettings />;
}

function WorkspaceSettings() {
  const [csrf, setCsrf] = useState("");
  const [settings, setSettings] = useState<SettingsBody | null>(null);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [sender, setSender] = useState("");
  const [primary, setPrimary] = useState("#1f6f5b");
  const [accent, setAccent] = useState("#d97706");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [clientName, setClientName] = useState("");

  async function load(token: string) {
    const response = await fetch("/api/account/settings", { credentials: "same-origin", headers: { "x-csrf-token": token } });
    const body = (await response.json()) as SettingsBody;
    if (!response.ok) {
      setMessage(body.reason || "Sign in is required.");
      return;
    }
    setSettings(body);
    if (body.csrfToken) setCsrf(body.csrfToken);
    setName(body.brand?.name || "");
    setSender(body.brand?.senderDisplayName || "");
    setPrimary(body.brand?.primary || "#1f6f5b");
    setAccent(body.brand?.accent || "#d97706");
    setLogoUrl(body.brand?.logoUrl || "");
    setTimezone(body.brand?.timezone || "America/Chicago");
  }

  async function start() {
    const response = await fetch("/api/account/csrf");
    const body = (await response.json()) as { csrfToken?: string; reason?: string };
    if (!body.csrfToken) {
      setMessage(body.reason || "Sign in is required.");
      return;
    }
    setCsrf(body.csrfToken);
    await load(body.csrfToken);
  }

  async function saveBrand(event: FormEvent) {
    event.preventDefault();
    const headers = { "content-type": "application/json", "x-csrf-token": csrf };
    const named = await fetch("/api/account/settings", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ name, timezone, csrfToken: csrf }),
    });
    const brand = await fetch("/api/account/branding", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ senderDisplayName: sender, primary, accent, logoUrl, timezone, csrfToken: csrf }),
    });
    const body = (await brand.json()) as { reason?: string };
    if (!named.ok || !brand.ok) {
      setMessage(body.reason || "Those settings were not saved.");
      return;
    }
    setMessage("Branding saved for this workspace.");
    await load(csrf);
  }

  async function addClient(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/account/onboarding/client", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ name: clientName, csrfToken: csrf }),
    });
    const body = (await response.json()) as { reason?: string };
    setMessage(response.ok ? "Client recorded." : body.reason || "The client was not recorded.");
    if (response.ok) await load(csrf);
  }

  const checklist = settings?.checklist;

  return (
    <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-workspace-settings="open">
      <p className="la-kicker">Workspace</p>
      <h1 className="font-display mt-2 text-3xl">Settings and brand</h1>
      <p className="mt-2 mb-6 text-sm text-muted">
        These colors and the sender name apply to this workspace only. The plan view is test mode and stays at $0.
      </p>
      {!settings ? (
        <button className="la-btn la-btn-primary" type="button" onClick={() => void start()}>Load this workspace</button>
      ) : (
        <>
          <section className="la-card mb-4" data-onboarding-checklist="1">
            <h2 className="font-display text-xl">Checklist</h2>
            <ul className="mt-3 text-sm">
              <li>Test plan {checklist?.plan ? "recorded" : "still open"}</li>
              <li>Brand {checklist?.brand ? "saved" : "needs a color and a sender name"}</li>
              <li>First client {checklist?.firstClient ? "added" : "not added"}</li>
              <li>First package {checklist?.firstPackage ? "recorded" : "not recorded"}</li>
            </ul>
            <p className="mt-3 text-sm text-muted">
              {settings.billing?.planName || "Test plan"} · {settings.billing?.subscriptionStatus || "trial"} · ${((settings.billing?.amountCents || 0) / 100).toFixed(2)} · {settings.role}
            </p>
          </section>
          <form className="la-card mb-4" onSubmit={saveBrand}>
            <h2 className="font-display text-xl">Brand</h2>
            <label className="la-label mt-3" htmlFor="ws-name">Workspace name</label>
            <input id="ws-name" className="la-field mb-3" value={name} onChange={(event) => setName(event.target.value)} />
            <label className="la-label" htmlFor="ws-sender">Sender name</label>
            <input id="ws-sender" className="la-field mb-3" value={sender} onChange={(event) => setSender(event.target.value)} />
            <label className="la-label" htmlFor="ws-primary">Primary color</label>
            <input id="ws-primary" className="la-field mb-3" value={primary} onChange={(event) => setPrimary(event.target.value)} />
            <label className="la-label" htmlFor="ws-accent">Accent color</label>
            <input id="ws-accent" className="la-field mb-3" value={accent} onChange={(event) => setAccent(event.target.value)} />
            <label className="la-label" htmlFor="ws-logo">Logo address</label>
            <input id="ws-logo" className="la-field mb-3" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://" />
            <label className="la-label" htmlFor="ws-tz">Timezone</label>
            <input id="ws-tz" className="la-field mb-5" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            <button className="la-btn la-btn-primary" type="submit">Save brand</button>
          </form>
          <form className="la-card mb-4" onSubmit={addClient}>
            <h2 className="font-display text-xl">First client</h2>
            <label className="la-label mt-3" htmlFor="ws-client">Client name</label>
            <input id="ws-client" className="la-field mb-4" value={clientName} onChange={(event) => setClientName(event.target.value)} />
            <button className="la-btn la-btn-primary" type="submit">Add client</button>
          </form>
          <section className="la-card">
            <h2 className="font-display text-xl">Members</h2>
            <ul className="mt-3 text-sm">
              {(settings.members || []).map((member) => (
                <li key={member.userId}>{member.email} · {member.role}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm"><a href="/team">Team page</a> · <a href="/billing">Billing page</a></p>
          </section>
          <DangerZone csrf={csrf} onMessage={setMessage} />
        </>
      )}
      {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
    </main>
  );
}

function DangerZone({ csrf, onMessage }: { csrf: string; onMessage: (value: string) => void }) {
  const [confirm, setConfirm] = useState("");
  if (!FLAGS.WORKSPACE_LIFECYCLE) {
    return (
      <section className="la-card mt-4" data-danger-zone="closed">
        <h2 className="font-display text-xl">Danger zone</h2>
        <p className="mt-3 text-sm text-muted">Export and closing this workspace stay off.</p>
      </section>
    );
  }

  async function post(path: string, extra: Record<string, string> = {}) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ ...extra, csrfToken: csrf }),
    });
    const body = (await response.json()) as { reason?: string; restoreUntil?: string };
    return { response, body };
  }

  async function onExport() {
    const { response, body } = await post("/api/account/workspace/export");
    if (!response.ok) {
      onMessage(body.reason || "The export was not created.");
      return;
    }
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workspace.json";
    link.click();
    URL.revokeObjectURL(url);
    onMessage("Export downloaded for this workspace.");
  }

  async function onClose(event: FormEvent) {
    event.preventDefault();
    if (confirm.trim().toLowerCase() !== "close") {
      onMessage("Type close to confirm.");
      return;
    }
    const { response, body } = await post("/api/account/workspace/close");
    onMessage(response.ok ? `Workspace closed. It can be restored until ${body.restoreUntil}.` : body.reason || "The workspace was not closed.");
  }

  async function onRestore() {
    const { response, body } = await post("/api/account/workspace/restore");
    onMessage(response.ok ? "Workspace restored." : body.reason || "The workspace was not restored.");
  }

  return (
    <section className="la-card mt-4" data-danger-zone="open">
      <h2 className="font-display text-xl">Danger zone</h2>
      <p className="mt-2 text-sm text-muted">Export is this workspace only. Closing signs everyone out and stops pipelines. You can restore it for 30 days.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="la-btn" type="button" onClick={() => void onExport()}>Download export</button>
        <button className="la-btn" type="button" onClick={() => void onRestore()}>Restore</button>
      </div>
      <form className="mt-4" onSubmit={onClose}>
        <label className="la-label" htmlFor="ws-close">Type close to confirm</label>
        <input id="ws-close" className="la-field mb-3" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        <button className="la-btn" type="submit">Close workspace</button>
      </form>
    </section>
  );
}
