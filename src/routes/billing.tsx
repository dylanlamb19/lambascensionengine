import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/billing")({
  component: BillingPage,
});

type BillingBody = {
  ok?: boolean;
  reason?: string;
  csrfToken?: string;
  billing?: {
    planName?: string | null;
    planId?: string | null;
    status?: string | null;
    seatLimit?: number | null;
    seatsUsed?: number;
    clientLimit?: number | null;
    clients?: number;
    graceUntil?: string | null;
    amountCents?: number;
  };
  plans?: { id: string; name: string; summary: string; seatLimit: number; clientLimit: number | null }[];
  sessionId?: string;
  url?: string;
};

function BillingPage() {
  if (!FLAGS.BILLING_SCAFFOLD) {
    return (
      <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-billing="closed">
        <section className="la-card">
          <p className="la-kicker">Billing</p>
          <h1 className="font-display mt-2 text-3xl">Billing is off</h1>
          <p className="mt-3 text-sm text-muted">Test checkout stays closed. Nothing here charges a card.</p>
        </section>
      </main>
    );
  }
  return <BillingDesk />;
}

function BillingDesk() {
  const [csrf, setCsrf] = useState("");
  const [body, setBody] = useState<BillingBody | null>(null);
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [portalUrl, setPortalUrl] = useState("");

  async function load() {
    const response = await fetch("/api/account/billing/scaffold", { credentials: "same-origin" });
    const next = (await response.json()) as BillingBody;
    if (!response.ok) {
      setMessage(next.reason || "Sign in is required.");
      return;
    }
    setBody(next);
    if (next.csrfToken) setCsrf(next.csrfToken);
  }

  async function post(path: string, payload: Record<string, string>) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ ...payload, csrfToken: csrf }),
    });
    const next = (await response.json()) as BillingBody;
    if (!response.ok) {
      setMessage(next.reason || "That was not recorded.");
      return;
    }
    if (next.sessionId) setSessionId(next.sessionId);
    if (next.url) setPortalUrl(next.url);
    setMessage("Recorded at $0. Nothing was charged.");
    await load();
  }

  const billing = body?.billing;

  return (
    <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-billing="open">
      <p className="la-kicker">Billing</p>
      <h1 className="font-display mt-2 text-3xl">Plan and test checkout</h1>
      <p className="mt-2 mb-6 text-sm text-muted">
        This is a local test checkout. The amount stays at $0. No card is stored and nothing is charged.
      </p>
      <p className="mb-4 text-sm"><a href="/workspace">Workspace settings</a> · <a href="/team">Team</a></p>
      {!body ? (
        <button className="la-btn la-btn-primary" type="button" onClick={() => void load()}>Load billing</button>
      ) : (
        <>
          <section className="la-card mb-4">
            <h2 className="font-display text-xl">{billing?.planName || "No plan yet"}</h2>
            <p className="mt-2 text-sm">
              Status {billing?.status || "none"} · ${((billing?.amountCents || 0) / 100).toFixed(2)} · {billing?.seatsUsed || 0} of {billing?.seatLimit ?? "—"} seats · {billing?.clients || 0} clients
              {billing?.clientLimit != null ? ` of ${billing.clientLimit}` : ""}
            </p>
            {billing?.graceUntil ? <p className="mt-2 text-sm text-muted">Grace until {billing.graceUntil}</p> : null}
          </section>
          <section className="la-card mb-4">
            <h2 className="font-display text-xl">Test checkout</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(body.plans || []).map((plan) => (
                <button key={plan.id} className="la-btn la-btn-primary" type="button" onClick={() => void post("/api/account/billing/checkout", { planId: plan.id })}>
                  {plan.name}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">{(body.plans || []).map((plan) => plan.summary).join(" ")}</p>
            {sessionId ? (
              <button className="la-btn mt-4" type="button" onClick={() => void post("/api/account/billing/checkout/complete", { sessionId })}>
                Record this test checkout
              </button>
            ) : null}
          </section>
          <section className="la-card">
            <h2 className="font-display text-xl">Customer portal</h2>
            <p className="mt-2 text-sm text-muted">The portal is a stub on this workspace. It does not open a payment site.</p>
            <button className="la-btn mt-4" type="button" onClick={() => void post("/api/account/billing/portal", {})}>Open portal stub</button>
            {portalUrl ? <p className="mt-3 text-sm">{portalUrl}</p> : null}
          </section>
        </>
      )}
      {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
    </main>
  );
}
