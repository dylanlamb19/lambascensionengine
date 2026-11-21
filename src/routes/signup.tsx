import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  if (!FLAGS.SELF_SERVE_SIGNUP) {
    return (
      <main className="la-login la-shell" data-self-serve="closed">
        <section className="la-card">
          <p className="la-kicker">Lamb Ascension</p>
          <h1 className="font-display mt-2 text-3xl">Signup is closed</h1>
          <p className="mt-3 text-sm text-muted">
            Public registration is off. An owner turns it on only after verification mail is ready. Nothing here creates a workspace.
          </p>
        </section>
      </main>
    );
  }
  return <SignupForm />;
}

function SignupForm() {
  const [step, setStep] = useState<"form" | "verify" | "plan" | "done">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [code, setCode] = useState("");
  const [planId, setPlanId] = useState("test_operator");
  const [message, setMessage] = useState("");
  const [csrf, setCsrf] = useState("");
  const [sessionCsrf, setSessionCsrf] = useState("");

  async function token(): Promise<string> {
    const response = await fetch("/api/account/csrf");
    const body = (await response.json()) as { csrfToken?: string; reason?: string };
    if (!response.ok || !body.csrfToken) throw new Error(body.reason || "The form could not be started.");
    setCsrf(body.csrfToken);
    return body.csrfToken;
  }

  async function onSignup(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const csrfToken = await token();
      const response = await fetch("/api/account/signup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ email, password, name, workspaceName, csrfToken }),
      });
      const body = (await response.json()) as { reason?: string };
      if (!response.ok) {
        setMessage(body.reason || "Signup could not be recorded.");
        return;
      }
      setMessage(body.reason || "Verification recorded. Nothing was sent.");
      setStep("verify");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Signup could not be recorded.");
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const csrfToken = await token();
      const response = await fetch("/api/account/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ email, token: code, csrfToken }),
      });
      const body = (await response.json()) as { reason?: string; csrfToken?: string };
      if (!response.ok || !body.csrfToken) {
        setMessage(body.reason || "That verification code is not valid.");
        return;
      }
      setSessionCsrf(body.csrfToken);
      setStep("plan");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That verification code is not valid.");
    }
  }

  async function onPlan(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/account/billing/plan", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": sessionCsrf },
      body: JSON.stringify({ planId, csrfToken: sessionCsrf }),
    });
    const body = (await response.json()) as { reason?: string };
    if (!response.ok) {
      setMessage(body.reason || "That test plan was not recorded.");
      return;
    }
    setStep("done");
  }

  return (
    <main className="la-login la-shell" data-self-serve="open">
      <section className="la-card">
        <p className="la-kicker">Lamb Ascension</p>
        <h1 className="font-display mt-2 text-3xl">Open a workspace</h1>
        <p className="mt-3 mb-5 text-sm text-muted">
          Test mode only. The plan is recorded at $0. Verification is recorded by the transactional dry-run sender. Nothing is sent, and sales outreach is not used.
        </p>
        {step === "form" ? (
          <form onSubmit={onSignup}>
            <label className="la-label" htmlFor="su-name">Your name</label>
            <input id="su-name" className="la-field mb-3" value={name} onChange={(event) => setName(event.target.value)} />
            <label className="la-label" htmlFor="su-email">Email</label>
            <input id="su-email" className="la-field mb-3" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            <label className="la-label" htmlFor="su-password">Password</label>
            <input id="su-password" type="password" className="la-field mb-3" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            <label className="la-label" htmlFor="su-workspace">Workspace name</label>
            <input id="su-workspace" className="la-field mb-5" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
            <button className="la-btn la-btn-primary" type="submit">Send verification</button>
          </form>
        ) : null}
        {step === "verify" ? (
          <form onSubmit={onVerify}>
            <label className="la-label" htmlFor="su-code">Verification code</label>
            <input id="su-code" className="la-field mb-5" value={code} onChange={(event) => setCode(event.target.value)} />
            <button className="la-btn la-btn-primary" type="submit">Verify email</button>
          </form>
        ) : null}
        {step === "plan" ? (
          <form onSubmit={onPlan}>
            <label className="la-label" htmlFor="su-plan">Test plan</label>
            <select id="su-plan" className="la-field mb-5" value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="test_trial">Test trial</option>
              <option value="test_operator">Test operator</option>
              <option value="test_agency">Test agency</option>
            </select>
            <button className="la-btn la-btn-primary" type="submit">Record test plan</button>
          </form>
        ) : null}
        {step === "done" ? (
          <div>
            <p>The test plan is recorded at $0. No card was charged.</p>
            <a className="la-btn la-btn-primary mt-4 inline-flex" href="/workspace">Continue the checklist</a>
          </div>
        ) : null}
        {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
        {csrf ? <p className="sr-only">Form ready</p> : null}
      </section>
    </main>
  );
}
