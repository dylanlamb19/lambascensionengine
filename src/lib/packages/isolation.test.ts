import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { EMAIL_PASSWORD_SIGN_UP_DISABLED } from "../auth/email-password.ts";
import { fakeBilling } from "./billing.ts";
import { acceptInvite, beginMarketerSignup, inviteMarketer, publicSignupRemainsDisabled } from "./invites.ts";
import { readTenant, sessionCanAccess, tenantPredicate, writeTenant } from "./tenant-data.ts";
import { startMarketerOnboarding } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type ServiceClient } from "./types.ts";

const NOW = "2026-11-15T16:00:00.000Z";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function pair() {
  const first = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!first.ok) throw new Error("a");
  const second = startMarketerOnboarding(first.state, { userId: "marketer-b", workspaceName: "B", now: NOW });
  if (!second.ok) throw new Error("b");
  const clients: ServiceClient[] = [
    { id: "c-a", tenantId: first.workspace.id, name: "North", createdAt: NOW },
    { id: "c-b", tenantId: second.workspace.id, name: "South", createdAt: NOW },
  ];
  return { state: { ...second.state, clients }, tenantA: first.workspace.id, tenantB: second.workspace.id };
}

test("cross-tenant reads and writes fail in the data layer", () => {
  const { state, tenantA, tenantB } = pair();
  const sessionA = { userId: "marketer-a", tenantId: tenantA };
  const read = readTenant(state, sessionA, state.clients);
  assert.equal(read.ok, true);
  if (read.ok) assert.deepEqual(read.rows.map((row) => row.id), ["c-a"]);
  const outsider = readTenant(state, { userId: "marketer-a", tenantId: tenantB }, state.clients);
  assert.equal(outsider.ok, false);
  if (!outsider.ok) assert.equal(outsider.rows.length, 0);
  const write = writeTenant(state, sessionA, { id: "smuggle", tenantId: tenantB, name: "Hidden", createdAt: NOW }, (current, row) => ({
    ...current,
    clients: [...current.clients, row],
  }));
  assert.equal(write.ok, false);
  if (!write.ok) assert.equal(write.state.clients.length, state.clients.length);
  assert.match(tenantPredicate("workspace_id"), /app\.tenant_id/);
});

test("an accepted invite grants that workspace only", () => {
  const { state, tenantA, tenantB } = pair();
  assert.equal(publicSignupRemainsDisabled(), true);
  assert.equal(EMAIL_PASSWORD_SIGN_UP_DISABLED, true);
  const off = inviteMarketer(state, tenantA, "marketer-a", "guest@example.com", NOW, false);
  assert.equal(off.ok, false);
  assert.equal(off.state, state);
  const invited = inviteMarketer(state, tenantA, "marketer-a", "guest@example.com", NOW, true, "invite-1");
  if (!invited.ok) throw new Error(invited.reason);
  const hidden = readTenant(invited.state, { userId: "marketer-b", tenantId: tenantB }, invited.state.invites);
  assert.equal(hidden.ok, true);
  if (hidden.ok) assert.equal(hidden.rows.length, 0);
  const wrong = acceptInvite(invited.state, "invite-1", "marketer-b", "other@example.com", NOW, true);
  assert.equal(wrong.ok, false);
  const accepted = acceptInvite(invited.state, "invite-1", "marketer-b", "guest@example.com", NOW, true);
  if (!accepted.ok) throw new Error(accepted.reason);
  assert.equal(accepted.state.workspaces.length, invited.state.workspaces.length);
  assert.equal(sessionCanAccess(accepted.state, "marketer-b", tenantA), true);
  assert.equal(sessionCanAccess(accepted.state, "marketer-b", tenantB), true);
  const blocked = beginMarketerSignup(state, { enabled: false, userId: "", email: "new@example.com", workspaceName: "New", now: NOW });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, state);
  const anonymous = beginMarketerSignup(state, { enabled: true, userId: "", email: "new@example.com", workspaceName: "New", now: NOW });
  assert.equal(anonymous.ok, false);
  if (!anonymous.ok) assert.match(anonymous.reason, /Public registration is closed/);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "invites.ts"), "utf8");
  assert.doesNotMatch(src, /signUp\.email|disableSignUp:\s*false/);
});

test("subscription lifecycle and invoices stay at zero cents", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!opened.ok) throw new Error("open");
  const tenantId = opened.workspace.id;
  assert.equal(opened.workspace.subscriptionStatus, "trial");
  const skip = fakeBilling.transitionSubscription(opened.state, tenantId, "past_due", NOW, "bad");
  assert.equal(skip.ok, false);
  const active = fakeBilling.transitionSubscription(opened.state, tenantId, "active", NOW, "to-active");
  if (!active.ok) throw new Error(active.reason);
  assert.equal(active.event.amountCents, 0);
  const due = fakeBilling.transitionSubscription(active.state, tenantId, "past_due", NOW, "to-due");
  if (!due.ok) throw new Error(due.reason);
  const invoice = due.state.invoices.find((row) => row.tenantId === tenantId && row.status === "open");
  assert.ok(invoice);
  assert.equal(invoice?.amountCents, 0);
  const foreign = fakeBilling.payInvoice(due.state, "ws_other", invoice?.id || "", NOW, "nope");
  assert.equal(foreign.ok, false);
  const paid = fakeBilling.payInvoice(due.state, tenantId, invoice?.id || "", NOW, "paid");
  if (!paid.ok) throw new Error(paid.reason);
  assert.equal(paid.state.workspaces.find((row) => row.id === tenantId)?.subscriptionStatus, "active");
  assert.equal(paid.state.invoices.every((row) => row.amountCents === 0), true);
  const back = fakeBilling.transitionSubscription(paid.state, tenantId, "past_due", NOW, "due-2");
  if (!back.ok) throw new Error(back.reason);
  const canceled = fakeBilling.transitionSubscription(back.state, tenantId, "canceled", NOW, "cancel");
  if (!canceled.ok) throw new Error(canceled.reason);
  assert.equal(canceled.state.workspaces.find((row) => row.id === tenantId)?.subscriptionStatus, "canceled");
  assert.equal(canceled.state.invoices.some((row) => row.tenantId === tenantId && row.status === "open"), false);
  assert.equal(fakeBilling.transitionSubscription(canceled.state, tenantId, "active", NOW, "revive").ok, false);
});

test("row security policies hide and reject the other tenant", async () => {
  const pg = new PGlite();
  for (const name of ["0015_client_packages.sql", "0016_workspace_connections.sql", "0017_tenant_rls.sql", "0018_lead_follow_up.sql", "0019_lead_gen_ai_visibility.sql", "0020_reviews_appointments.sql", "0021_estimate_google_ads.sql", "0022_meta_office_bundle.sql"]) {
    await pg.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into marketer_workspaces (id, owner_user_id, name) values ('ws_a', 'a', 'A'), ('ws_b', 'b', 'B');
    insert into service_clients (id, workspace_id, name) values ('c1', 'ws_a', 'North'), ('c2', 'ws_b', 'South');
    insert into test_invoices (id, workspace_id, status, amount_cents, billing_mode) values
      ('i1', 'ws_a', 'open', 0, 'test'),
      ('i2', 'ws_b', 'open', 0, 'test');
    insert into follow_up_leads (id, workspace_id, client_id, enrollment_id, contact_name, status, captured_at)
      values ('lead-a', 'ws_a', 'c1', 'enr-a', 'Sam', 'active', '2026-11-15T15:00:00Z'),
             ('lead-b', 'ws_b', 'c2', 'enr-b', 'Pat', 'active', '2026-11-15T15:00:00Z');
    insert into package_runs (id, workspace_id, client_id, enrollment_id, package_id, status, opened_at)
      values ('run-a', 'ws_a', 'c1', 'enr-a', 'lead-generation', 'active', '2026-11-15T15:00:00Z'),
             ('run-r', 'ws_a', 'c1', 'enr-a', 'reviews-gbp', 'active', '2026-11-15T15:00:00Z'),
             ('run-g', 'ws_a', 'c1', 'enr-a', 'google-ads', 'active', '2026-11-15T15:00:00Z'),
             ('run-b', 'ws_b', 'c2', 'enr-b', 'ai-visibility', 'active', '2026-11-15T15:00:00Z'),
             ('run-m', 'ws_a', 'c1', 'enr-a', 'meta-ads', 'active', '2026-11-15T15:00:00Z'),
             ('run-o', 'ws_b', 'c2', 'enr-b', 'office-automation', 'active', '2026-11-15T15:00:00Z');
    insert into meta_budget_notes (workspace_id, enrollment_id, client_id, proposed_cents, ambiguous, status, updated_at)
      values ('ws_a', 'enr-a', 'c1', 40000, false, 'open', '2026-11-15T15:00:00Z'),
             ('ws_b', 'enr-b', 'c2', 90000, false, 'open', '2026-11-15T15:00:00Z');
    insert into office_workflows (workspace_id, enrollment_id, client_id, kind, ambiguous, schedule_note, updated_at)
      values ('ws_a', 'enr-a', 'c1', 'document-collection', false, 'Morning', '2026-11-15T15:00:00Z'),
             ('ws_b', 'enr-b', 'c2', 'invoice-reminders', false, 'Morning', '2026-11-15T15:00:00Z');
    insert into open_estimates (id, workspace_id, client_id, enrollment_id, customer_name, label, opened_at, recorded_at, outcome, status)
      values ('est-a', 'ws_a', 'c1', 'enr-a', 'Pat', 'Roof', '2026-11-13T15:00:00Z', '2026-11-15T15:00:00Z', 'open', 'active'),
             ('est-b', 'ws_b', 'c2', 'enr-b', 'Casey', 'Barn', '2026-11-13T15:00:00Z', '2026-11-15T15:00:00Z', 'open', 'active');
    insert into ads_metric_snapshots (id, workspace_id, client_id, enrollment_id, period_label, impressions, clicks, recorded_at, source)
      values ('met-a', 'ws_a', 'c1', 'enr-a', 'Harbor week', 120, 9, '2026-11-15T15:00:00Z', 'stored'),
             ('met-b', 'ws_b', 'c2', 'enr-b', 'Prairie week', 40, 3, '2026-11-15T15:00:00Z', 'stored');
    insert into generated_leads (id, workspace_id, client_id, enrollment_id, contact_name, captured_at)
      values ('gen-a', 'ws_a', 'c1', 'enr-a', 'Sam', '2026-11-15T15:00:00Z'),
             ('gen-b', 'ws_b', 'c2', 'enr-b', 'Pat', '2026-11-15T15:00:00Z');
    insert into completed_jobs (id, workspace_id, client_id, enrollment_id, customer_name, job_label, completed_at, recorded_at, status)
      values ('job-a', 'ws_a', 'c1', 'enr-a', 'Riley', 'Roof', '2026-11-14T15:00:00Z', '2026-11-15T15:00:00Z', 'completed'),
             ('job-b', 'ws_b', 'c2', 'enr-b', 'Jordan', 'Barn', '2026-11-14T15:00:00Z', '2026-11-15T15:00:00Z', 'completed');
    insert into client_appointments (id, workspace_id, client_id, enrollment_id, customer_name, starts_at, calendar, status, response, outcome, recorded_at)
      values ('appt-a', 'ws_a', 'c1', 'enr-a', 'Avery', '2026-11-17T15:00:00Z', 'booking_calendar', 'active', 'none', 'unset', '2026-11-15T15:00:00Z'),
             ('appt-b', 'ws_b', 'c2', 'enr-b', 'Morgan', '2026-11-17T15:00:00Z', 'booking_calendar', 'active', 'none', 'unset', '2026-11-15T15:00:00Z');
  `);
  await pg.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'tenant_reader') then
        create role tenant_reader nologin;
      end if;
    end $$;
    grant select, insert, update, delete on all tables in schema public to tenant_reader;
  `);
  await pg.exec(`set role tenant_reader`);
  await pg.query(`select set_config('app.tenant_id', 'ws_a', false)`);
  const seen = await pg.query<{ id: string }>(`select id from service_clients order by id`);
  assert.deepEqual(seen.rows.map((row) => row.id), ["c1"]);
  const invoices = await pg.query<{ id: string; amount_cents: number }>(`select id, amount_cents from test_invoices`);
  assert.deepEqual(invoices.rows, [{ id: "i1", amount_cents: 0 }]);
  await assert.rejects(() => pg.exec(`insert into service_clients (id, workspace_id, name) values ('c3', 'ws_b', 'Smuggle')`));
  const still = await pg.query<{ id: string }>(`select id from service_clients where id = 'c2'`);
  assert.equal(still.rows.length, 0);
  const leads = await pg.query<{ id: string }>(`select id from follow_up_leads order by id`);
  assert.deepEqual(leads.rows.map((row) => row.id), ["lead-a"]);
  await assert.rejects(() => pg.exec(`insert into follow_up_leads (id, workspace_id, client_id, enrollment_id, contact_name, status, captured_at) values ('lead-c', 'ws_b', 'c2', 'enr-b', 'Hidden', 'active', '2026-11-15T15:00:00Z')`));
  const runs = await pg.query<{ id: string }>(`select id from package_runs order by id`);
  assert.deepEqual(runs.rows.map((row) => row.id), ["run-a", "run-g", "run-m", "run-r"]);
  const generated = await pg.query<{ id: string }>(`select id from generated_leads order by id`);
  assert.deepEqual(generated.rows.map((row) => row.id), ["gen-a"]);
  await assert.rejects(() => pg.exec(`insert into generated_leads (id, workspace_id, client_id, enrollment_id, contact_name, captured_at) values ('gen-c', 'ws_b', 'c2', 'enr-b', 'Hidden', '2026-11-15T15:00:00Z')`));
  const jobs = await pg.query<{ id: string }>(`select id from completed_jobs order by id`);
  assert.deepEqual(jobs.rows.map((row) => row.id), ["job-a"]);
  const appointments = await pg.query<{ id: string }>(`select id from client_appointments order by id`);
  assert.deepEqual(appointments.rows.map((row) => row.id), ["appt-a"]);
  await assert.rejects(() => pg.exec(`insert into completed_jobs (id, workspace_id, client_id, enrollment_id, customer_name, job_label, completed_at, recorded_at, status) values ('job-c', 'ws_b', 'c2', 'enr-b', 'Hidden', 'Roof', '2026-11-14T15:00:00Z', '2026-11-15T15:00:00Z', 'completed')`));
  await assert.rejects(() => pg.exec(`insert into client_appointments (id, workspace_id, client_id, enrollment_id, customer_name, starts_at, calendar, status, response, outcome, recorded_at) values ('appt-c', 'ws_b', 'c2', 'enr-b', 'Hidden', '2026-11-17T15:00:00Z', 'booking_calendar', 'active', 'none', 'unset', '2026-11-15T15:00:00Z')`));
  const estimates = await pg.query<{ id: string }>(`select id from open_estimates order by id`);
  assert.deepEqual(estimates.rows.map((row) => row.id), ["est-a"]);
  const metrics = await pg.query<{ id: string }>(`select id from ads_metric_snapshots order by id`);
  assert.deepEqual(metrics.rows.map((row) => row.id), ["met-a"]);
  await assert.rejects(() => pg.exec(`insert into open_estimates (id, workspace_id, client_id, enrollment_id, customer_name, label, opened_at, recorded_at, outcome, status) values ('est-c', 'ws_b', 'c2', 'enr-b', 'Hidden', 'Roof', '2026-11-13T15:00:00Z', '2026-11-15T15:00:00Z', 'open', 'active')`));
  await assert.rejects(() => pg.exec(`insert into ads_metric_snapshots (id, workspace_id, client_id, enrollment_id, period_label, impressions, recorded_at, source) values ('met-c', 'ws_b', 'c2', 'enr-b', 'Hidden', 1, '2026-11-15T15:00:00Z', 'stored')`));
  const budgets = await pg.query<{ enrollment_id: string }>(`select enrollment_id from meta_budget_notes`);
  assert.deepEqual(budgets.rows.map((row) => row.enrollment_id), ["enr-a"]);
  const workflows = await pg.query<{ kind: string }>(`select kind from office_workflows`);
  assert.deepEqual(workflows.rows.map((row) => row.kind), ["document-collection"]);
  await assert.rejects(() => pg.exec(`insert into meta_budget_notes (workspace_id, enrollment_id, client_id, proposed_cents, ambiguous, status, updated_at) values ('ws_b', 'enr-b', 'c2', 1, false, 'open', '2026-11-15T15:00:00Z')`));
  await assert.rejects(() => pg.exec(`insert into office_workflows (workspace_id, enrollment_id, client_id, kind, ambiguous, schedule_note, updated_at) values ('ws_b', 'enr-c', 'c2', 'document-collection', false, 'Hidden', '2026-11-15T15:00:00Z')`));
  await pg.close();
});
