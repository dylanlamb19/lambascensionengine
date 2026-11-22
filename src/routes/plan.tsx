import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/plan")({
  component: PlanPage,
});

type Meter = { key: string; label: string; used: number; limit: number | null; level: "ok" | "warning" | "blocked" };
type Banner = { level: "warning" | "blocked"; text: string };
type PlanBody = {
  ok?: boolean;
  reason?: string;
  csrfToken?: string;
  direction?: string;
  plan?: {
    planName?: string | null;
    planId?: string | null;
    status?: string | null;
    trialEndsAt?: string | null;
    amountCents?: number;
    meters?: Meter[];
    banners?: Banner[];
    plans?: { id: string; name: string; summary: string }[];
  };
};

function PlanPage() {
  if (!FLAGS.PLAN_ENTITLEMENTS) {
    return (
      <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-plan="closed">
        <section className="la-card">
          <p className="la-kicker">Plan</p>
          <h1 className="font-display mt-2 text-3xl">Plan and usage are off</h1>
          <p className="mt-3 text-sm text-muted">Limits stay closed. Nothing here charges a card.</p>
        </section>
      </main>
    );
  }
  return <PlanDesk />;
}

function PlanDesk() {
  const [csrf, setCsrf] = useState("");
  const [body, setBody] = useState<PlanBody | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/account/plan", { credentials: "same-origin" });
    const next = (await response.json()) as PlanBody;
    if (!response.ok) {
      setMessage(next.reason || "Sign in is required.");
      return;
    }
    setBody(next);
    if (next.csrfToken) setCsrf(next.csrfToken);
  }

  async function change(planId: string) {
    const response = await fetch("/api/account/plan/change", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ planId, csrfToken: csrf }),
    });
    const next = (await response.json()) as PlanBody;
    if (!response.ok) {
      setMessage(next.reason || "That plan was not recorded.");
      return;
    }
    setMessage(`Recorded at $0. Nothing was charged.${next.direction ? ` ${next.direction}` : ""}`);
    await load();
  }

  const plan = body?.plan;

  return (
    <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-plan="open">
      <p className="la-kicker">Plan</p>
      <h1 className="font-display mt-2 text-3xl">Plan and usage</h1>
      <p className="mt-2 mb-6 text-sm text-muted">
        Test mode only. Upgrade and downgrade stay at $0. No card is stored and nothing is charged.
      </p>
      <p className="mb-4 text-sm"><a href="/onboarding">First-run wizard</a> · <a href="/billing">Test checkout</a></p>
      {(plan?.banners || []).map((banner) => (
        <section key={banner.text} className="la-card mb-4" data-banner={banner.level}>
          <p className="text-sm">{banner.text}</p>
        </section>
      ))}
      {!body ? (
        <button className="la-btn la-btn-primary" type="button" onClick={() => void load()}>Load plan</button>
      ) : (
        <>
          <section className="la-card mb-4">
            <h2 className="font-display text-xl">{plan?.planName || "No plan yet"}</h2>
            <p className="mt-2 text-sm">
              Status {plan?.status || "none"} · ${((plan?.amountCents || 0) / 100).toFixed(2)}
              {plan?.trialEndsAt ? ` · trial until ${plan.trialEndsAt}` : ""}
            </p>
            <ul className="mt-4 space-y-3">
              {(plan?.meters || []).map((meter) => {
                const width = meter.limit == null ? 12 : Math.min(100, Math.round((meter.used / Math.max(meter.limit, 1)) * 100));
                return (
                  <li key={meter.key}>
                    <p className="text-sm">{meter.label}: {meter.used}{meter.limit == null ? "" : ` of ${meter.limit}`}</p>
                    <div className="mt-1 h-2 rounded bg-black/10">
                      <div className="h-2 rounded" style={{ width: `${width}%`, background: meter.level === "blocked" ? "#9a3412" : meter.level === "warning" ? "#a16207" : "#1f6f5b" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="la-card">
            <h2 className="font-display text-xl">Change plan</h2>
            <p className="mt-2 text-sm text-muted">A downgrade keeps the clients you already have. New work stops at the new limit.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(plan?.plans || []).map((choice) => (
                <button key={choice.id} className="la-btn la-btn-primary" type="button" onClick={() => void change(choice.id)}>
                  {choice.name}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
    </main>
  );
}
