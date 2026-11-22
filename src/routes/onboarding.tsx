import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

type Wizard = {
  step: string;
  completed: string[];
  skipped: string[];
  steps: string[];
  tab?: string;
  workspace?: { name: string; senderDisplayName: string; primary: string; accent: string; timezone: string } | null;
  clients?: { id: string; name: string }[];
  queued?: { clientName: string; packageName: string; stepTitles: string[] }[];
  banners?: { level: string; text: string }[];
};

type WizardBody = { ok?: boolean; reason?: string; csrfToken?: string; wizard?: Wizard };

function OnboardingPage() {
  if (!FLAGS.ONBOARDING_WIZARD) {
    return (
      <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-onboarding="closed">
        <section className="la-card">
          <p className="la-kicker">Onboarding</p>
          <h1 className="font-display mt-2 text-3xl">The first-run wizard is off</h1>
          <p className="mt-3 text-sm text-muted">A new workspace is not walked through setup. Nothing here charges a card or sends mail.</p>
        </section>
      </main>
    );
  }
  return <WizardDesk />;
}

function WizardDesk() {
  const [csrf, setCsrf] = useState("");
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("My workspace");
  const [sender, setSender] = useState("Studio");
  const [primary, setPrimary] = useState("#1f6f5b");
  const [accent, setAccent] = useState("#c4a574");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [planId, setPlanId] = useState("starter");
  const [clientName, setClientName] = useState("");
  const [clientId, setClientId] = useState("");
  const [packages, setPackages] = useState<string[]>(["lead-follow-up"]);
  const [csv, setCsv] = useState("name,email,phone,source\nAvery Cole,avery@example.com,555-0100,website");

  async function load() {
    const response = await fetch("/api/account/onboarding/wizard", { credentials: "same-origin" });
    const next = (await response.json()) as WizardBody;
    if (!response.ok || !next.wizard) {
      setMessage(next.reason || "Sign in is required.");
      return;
    }
    setWizard(next.wizard);
    if (next.csrfToken) setCsrf(next.csrfToken);
    if (next.wizard.workspace?.name) setName(next.wizard.workspace.name);
    if (next.wizard.clients?.[0]) setClientId(next.wizard.clients[0].id);
  }

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/account/onboarding/wizard", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ ...payload, csrfToken: csrf }),
    });
    const next = (await response.json()) as WizardBody;
    if (!response.ok || !next.wizard) {
      setMessage(next.reason || "That step was not saved.");
      return;
    }
    setWizard(next.wizard);
    setMessage("Saved. You can leave and come back to this step.");
    if (next.wizard.clients?.[0]) setClientId(next.wizard.clients[0].id);
  }

  const step = wizard?.step || "branding";

  return (
    <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-onboarding="open">
      <p className="la-kicker">Onboarding</p>
      <h1 className="font-display mt-2 text-3xl">Set up your first client</h1>
      <p className="mt-2 mb-4 text-sm text-muted">Each step can be skipped. Progress stays with this workspace. Plan choice is a $0 test checkout.</p>
      <p className="mb-4 text-sm"><a href="/plan">Plan and usage</a></p>
      {(wizard?.banners || []).map((banner) => (
        <section key={banner.text} className="la-card mb-4" data-banner={banner.level}>
          <p className="text-sm">{banner.text}</p>
        </section>
      ))}
      {!wizard ? (
        <button className="la-btn la-btn-primary" type="button" onClick={() => void load()}>Continue setup</button>
      ) : (
        <section className="la-card">
          <p className="text-sm text-muted">Step {wizard.steps.indexOf(step) + 1} of {wizard.steps.length}</p>
          {step === "branding" ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void post({ step, name, senderDisplayName: sender, primary, accent, timezone }); }}>
              <label className="block text-sm">Workspace name<input className="mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="block text-sm">Sender name<input className="mt-1 w-full" value={sender} onChange={(event) => setSender(event.target.value)} /></label>
              <label className="block text-sm">Primary<input className="mt-1 w-full" value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
              <label className="block text-sm">Accent<input className="mt-1 w-full" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
              <label className="block text-sm">Timezone<input className="mt-1 w-full" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
              <button className="la-btn la-btn-primary" type="submit">Save branding</button>
            </form>
          ) : null}
          {step === "plan" ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void post({ step, planId }); }}>
              <label className="block text-sm">Test plan
                <select className="mt-1 w-full" value={planId} onChange={(event) => setPlanId(event.target.value)}>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="agency">Agency</option>
                </select>
              </label>
              <p className="text-sm text-muted">Recorded at $0. Nothing is charged.</p>
              <button className="la-btn la-btn-primary" type="submit">Choose plan</button>
            </form>
          ) : null}
          {step === "client" ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void post({ step, name: clientName }); }}>
              <label className="block text-sm">First client<input className="mt-1 w-full" value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
              <button className="la-btn la-btn-primary" type="submit">Add client</button>
            </form>
          ) : null}
          {step === "packages" ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void post({ step, clientId, packageIds: packages }); }}>
              <label className="block text-sm">Client
                <select className="mt-1 w-full" value={clientId} onChange={(event) => setClientId(event.target.value)}>
                  {(wizard.clients || []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </label>
              <label className="block text-sm"><input type="checkbox" checked={packages.includes("lead-follow-up")} onChange={() => setPackages(["lead-follow-up"])} /> Lead Follow-Up</label>
              <button className="la-btn la-btn-primary" type="submit">Queue packages</button>
            </form>
          ) : null}
          {step === "leads" ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void post({ step, clientId, csv }); }}>
              <label className="block text-sm">CSV import, dry-run
                <textarea className="mt-1 w-full" rows={5} value={csv} onChange={(event) => setCsv(event.target.value)} />
              </label>
              <p className="text-sm text-muted">Rows stay in this workspace. Nothing is sent.</p>
              <button className="la-btn la-btn-primary" type="submit">Import leads</button>
            </form>
          ) : null}
          {step === "next" ? (
            <div className="mt-4">
              <h2 className="font-display text-xl">What happens next</h2>
              <p className="mt-2 text-sm">These pipelines are queued in {wizard.tab || "Client Package Fulfillment"}.</p>
              <ul className="mt-3 space-y-2 text-sm">
                {(wizard.queued || []).map((row) => (
                  <li key={`${row.clientName}-${row.packageName}`}>{row.clientName} · {row.packageName} · {row.stepTitles.length} steps</li>
                ))}
              </ul>
              <button className="la-btn la-btn-primary mt-4" type="button" onClick={() => void post({ step })}>Finish</button>
            </div>
          ) : null}
          <button className="la-btn mt-4" type="button" onClick={() => void post({ step, skip: true })}>Skip this step</button>
        </section>
      )}
      {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
    </main>
  );
}
