import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/operator")({
  component: OperatorPage,
});

type TenantRow = {
  tenantId: string;
  name: string;
  planName?: string | null;
  scaffoldStatus?: string | null;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  suspended?: boolean;
  usage?: { label: string; used: number; limit: number | null }[];
  health?: { packageId: string; running: number; failed: number; needsHuman: number; killed: number }[];
};

type OperatorBody = {
  ok?: boolean;
  reason?: string;
  impersonation?: boolean;
  mode?: string;
  tenants?: TenantRow[];
  tenant?: TenantRow | null;
};

function OperatorPage() {
  if (!FLAGS.OPERATOR_CONSOLE) {
    return (
      <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-operator="closed">
        <section className="la-card">
          <p className="la-kicker">Operator</p>
          <h1 className="font-display mt-2 text-3xl">The operator console is off</h1>
          <p className="mt-3 text-sm text-muted">Workspace owners cannot open this. Nothing here signs you in as another workspace.</p>
        </section>
      </main>
    );
  }
  return <OperatorDesk />;
}

function OperatorDesk() {
  const [csrf, setCsrf] = useState("");
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [message, setMessage] = useState("");

  async function token() {
    if (csrf) return csrf;
    const response = await fetch("/api/account/csrf", { credentials: "same-origin" });
    const next = (await response.json()) as { csrfToken?: string; reason?: string };
    if (!response.ok || !next.csrfToken) {
      setMessage(next.reason || "Sign in is required.");
      return "";
    }
    setCsrf(next.csrfToken);
    return next.csrfToken;
  }

  async function load() {
    const response = await fetch("/api/account/operator", { credentials: "same-origin" });
    const next = (await response.json()) as OperatorBody;
    if (!response.ok) {
      setMessage(next.reason || "This console is for the Lasengine owner.");
      return;
    }
    setTenants(next.tenants || []);
    setMessage(next.impersonation === false ? "Read only. You are not signed in as these workspaces." : "");
  }

  async function view(tenantId: string) {
    const response = await fetch(`/api/account/operator/tenant?tenantId=${encodeURIComponent(tenantId)}`, { credentials: "same-origin" });
    const next = (await response.json()) as OperatorBody;
    if (!response.ok || !next.tenant) {
      setMessage(next.reason || "That workspace is not open.");
      return;
    }
    setTenant(next.tenant);
  }

  async function act(path: string, tenantId: string) {
    const csrfToken = await token();
    if (!csrfToken) return;
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ tenantId, csrfToken }),
    });
    const next = (await response.json()) as OperatorBody;
    if (!response.ok) {
      setMessage(next.reason || "That was not recorded.");
      return;
    }
    if (next.tenant) setTenant(next.tenant);
    setMessage("Recorded. The workspace session was not changed.");
    await load();
  }

  return (
    <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-operator="open">
      <p className="la-kicker">Operator</p>
      <h1 className="font-display mt-2 text-3xl">Lasengine workspaces</h1>
      <p className="mt-2 mb-6 text-sm text-muted">Read only. Suspend and kill stay on that workspace. This does not sign you in as the marketer.</p>
      <button className="la-btn la-btn-primary" type="button" onClick={() => void load()}>Load workspaces</button>
      <ul className="mt-4 space-y-3">
        {tenants.map((row) => (
          <li key={row.tenantId} className="la-card">
            <h2 className="font-display text-xl">{row.name}</h2>
            <p className="mt-1 text-sm">{row.planName || "No plan"} · {row.scaffoldStatus || row.subscriptionStatus}{row.suspended ? " · suspended" : ""}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="la-btn" type="button" onClick={() => void view(row.tenantId)}>View</button>
              <button className="la-btn" type="button" onClick={() => void act("/api/account/operator/suspend", row.tenantId)}>Suspend</button>
              <button className="la-btn" type="button" onClick={() => void act("/api/account/operator/resume", row.tenantId)}>Resume</button>
              <button className="la-btn" type="button" onClick={() => void act("/api/account/operator/kill", row.tenantId)}>Stop pipelines</button>
            </div>
          </li>
        ))}
      </ul>
      {tenant ? (
        <section className="la-card mt-4" data-operator-view="read-only">
          <h2 className="font-display text-xl">{tenant.name}</h2>
          <p className="mt-2 text-sm">Trial {tenant.trialEndsAt || "—"} · {tenant.suspended ? "Suspended" : "Open"}</p>
          <ul className="mt-3 text-sm">
            {(tenant.usage || []).map((meter) => (
              <li key={meter.label}>{meter.label}: {meter.used}{meter.limit == null ? "" : ` of ${meter.limit}`}</li>
            ))}
          </ul>
          <ul className="mt-3 text-sm">
            {(tenant.health || []).filter((row) => row.running || row.failed || row.needsHuman || row.killed).map((row) => (
              <li key={row.packageId}>{row.packageId}: running {row.running}, failed {row.failed}, needs a person {row.needsHuman}, stopped {row.killed}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
    </main>
  );
}
