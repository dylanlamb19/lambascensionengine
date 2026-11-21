import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FLAGS } from "@/lib/flags";

export const Route = createFileRoute("/team")({
  component: TeamPage,
});

type Member = { userId: string; email: string; role: string };
type Invite = { id: string; email: string; role: string; expiresAt: string; used: boolean };
type TeamBody = {
  ok?: boolean;
  reason?: string;
  csrfToken?: string;
  role?: string;
  members?: Member[];
  invites?: Invite[];
  seats?: { used?: number; limit?: number | null };
  tenantId?: string;
};

function TeamPage() {
  if (!FLAGS.TEAM_SEATS) {
    return (
      <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-team="closed">
        <section className="la-card">
          <p className="la-kicker">Team</p>
          <h1 className="font-display mt-2 text-3xl">Team seats are off</h1>
          <p className="mt-3 text-sm text-muted">Invites stay closed. Nothing here sends mail.</p>
        </section>
      </main>
    );
  }
  return <TeamDesk />;
}

function TeamDesk() {
  const [csrf, setCsrf] = useState("");
  const [body, setBody] = useState<TeamBody | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [code, setCode] = useState("");

  async function load() {
    const response = await fetch("/api/account/team", { credentials: "same-origin" });
    const next = (await response.json()) as TeamBody;
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
    const next = (await response.json()) as TeamBody;
    if (!response.ok) {
      setMessage(next.reason || "That was not recorded.");
      return null;
    }
    if (next.csrfToken) setCsrf(next.csrfToken);
    return next;
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    const result = await post("/api/account/team/invite", { email, role });
    if (!result) return;
    setMessage("Invite recorded. Nothing was sent.");
    setEmail("");
    await load();
  }

  async function onAccept(event: FormEvent) {
    event.preventDefault();
    const result = await post("/api/account/team/accept", { token: code });
    if (!result) return;
    setMessage("Invite accepted.");
    if (result.tenantId) await post("/api/account/team/switch", { targetTenantId: result.tenantId });
    await load();
  }

  return (
    <main className="la-shell mx-auto max-w-3xl px-4 py-8" data-team="open">
      <p className="la-kicker">Team</p>
      <h1 className="font-display mt-2 text-3xl">People in this workspace</h1>
      <p className="mt-2 mb-6 text-sm text-muted">
        Invites are recorded by the transactional dry-run sender. Nothing is sent. Seats follow the test plan.
      </p>
      <p className="mb-4 text-sm"><a href="/workspace">Workspace settings</a> · <a href="/billing">Billing</a></p>
      {!body ? (
        <button className="la-btn la-btn-primary" type="button" onClick={() => void load()}>Load team</button>
      ) : (
        <>
          <section className="la-card mb-4">
            <h2 className="font-display text-xl">Members</h2>
            <p className="mt-2 text-sm text-muted">
              {body.seats?.used || 0} of {body.seats?.limit ?? "—"} seats · you are {body.role}
            </p>
            <ul className="mt-3 text-sm">
              {(body.members || []).map((member) => (
                <li key={member.userId} className="mt-2 flex flex-wrap items-center gap-2">
                  <span>{member.email} · {member.role}</span>
                  {body.role === "owner" && member.role !== "owner" ? (
                    <>
                      <button className="la-btn" type="button" onClick={() => void post("/api/account/team/role", { userId: member.userId, role: member.role === "admin" ? "member" : "admin" }).then(() => load())}>
                        Make {member.role === "admin" ? "member" : "admin"}
                      </button>
                      <button className="la-btn" type="button" onClick={() => void post("/api/account/team/remove", { userId: member.userId }).then(() => load())}>Remove</button>
                      <button className="la-btn" type="button" onClick={() => void post("/api/account/team/transfer", { userId: member.userId }).then(() => load())}>Make owner</button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <form className="la-card mb-4" onSubmit={onInvite}>
            <h2 className="font-display text-xl">Invite</h2>
            <label className="la-label mt-3" htmlFor="team-email">Email</label>
            <input id="team-email" className="la-field mb-3" value={email} onChange={(event) => setEmail(event.target.value)} />
            <label className="la-label" htmlFor="team-role">Role</label>
            <select id="team-role" className="la-field mb-4" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="la-btn la-btn-primary" type="submit">Record invite</button>
            <ul className="mt-4 text-sm">
              {(body.invites || []).filter((invite) => !invite.used).map((invite) => (
                <li key={invite.id}>{invite.email} · {invite.role} · expires {invite.expiresAt}</li>
              ))}
            </ul>
          </form>
          <form className="la-card" onSubmit={onAccept}>
            <h2 className="font-display text-xl">Accept an invite</h2>
            <label className="la-label mt-3" htmlFor="team-code">Invite code</label>
            <input id="team-code" className="la-field mb-4" value={code} onChange={(event) => setCode(event.target.value)} />
            <button className="la-btn la-btn-primary" type="submit">Accept</button>
          </form>
        </>
      )}
      {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
    </main>
  );
}
