import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { emailAndPasswordConfig } from "../auth/email-password.ts";
import { fakeBilling } from "./billing.ts";
import { getTestPlan } from "./plans.ts";
import { recordPurchase, tickFulfillment } from "./runner.ts";
import { applyTenantScope, planTenantScope } from "./tenant-scope.ts";
import { startMarketerOnboarding, workspaceIdForUser } from "./tenancy.ts";
import { EMPTY_FULFILLMENT } from "./types.ts";
import { usageFor } from "./usage.ts";

const NOW = "2026-11-15T18:00:00.000Z";
const root = dirname(fileURLToPath(import.meta.url));

function ids() {
  let n = 0;
  return () => `m-${++n}`;
}

test("the request tenant comes from the verified user and is transaction-local", async () => {
  const derived = workspaceIdForUser("marketer-a");
  const plan = planTenantScope("marketer-a", null);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.tenantId, derived);
  assert.equal(plan.local, true);
  assert.deepEqual(plan.params, [derived, true]);
  const claimed = planTenantScope("marketer-a", "ws_someone_else");
  assert.equal(claimed.ok, false);
  const pg = new PGlite();
  await pg.exec("begin");
  await pg.query(plan.text, [...plan.params]);
  const inside = await pg.query<{ tenant: string | null }>("select current_setting('app.tenant_id', true) as tenant");
  assert.equal(inside.rows[0]?.tenant, derived);
  await pg.exec("commit");
  const outside = await pg.query<{ tenant: string | null }>("select current_setting('app.tenant_id', true) as tenant");
  assert.equal(outside.rows[0]?.tenant || "", "");
  const other = planTenantScope("marketer-b", null);
  if (!other.ok) throw new Error("b");
  await applyTenantScope("marketer-b", null, async (text, params) => {
    await pg.exec("begin");
    await pg.query(text, [...params]);
  }, async () => {
    const seen = await pg.query<{ tenant: string | null }>("select current_setting('app.tenant_id', true) as tenant");
    assert.equal(seen.rows[0]?.tenant, other.tenantId);
  });
  await pg.exec("rollback");
  const cleared = await pg.query<{ tenant: string | null }>("select current_setting('app.tenant_id', true) as tenant");
  assert.notEqual(cleared.rows[0]?.tenant, derived);
  await pg.close();
  const action = readFileSync(join(root, "scope-action.ts"), "utf8");
  assert.match(action, /authMiddleware/);
  assert.match(action, /context\.userId/);
  assert.match(action, /planTenantScope\(context\.userId, null\)/);
  assert.doesNotMatch(action, /data\.tenantId|claimedTenant/);
  assert.equal(emailAndPasswordConfig.disableSignUp, true);
});

test("package enrollments and pipeline runs are metered per workspace", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!opened.ok) throw new Error("a");
  const other = startMarketerOnboarding(opened.state, { userId: "marketer-b", workspaceName: "B", now: NOW });
  if (!other.ok) throw new Error("b");
  const trial = getTestPlan("test_trial");
  let state = other.state;
  const factory = ids();
  const packages = ["lead-follow-up", "ai-visibility", "google-ads", "meta-ads", "lead-generation"] as const;
  for (const packageId of packages) {
    const bought = recordPurchase(state, opened.workspace.id, {
      clientName: "North Roofing",
      packageId,
      setupPayment: "unrecorded",
      monthlyPayment: "unrecorded",
    }, NOW, factory);
    assert.equal(bought.ok, true, packageId);
    if (bought.ok) state = bought.state;
  }
  assert.equal(usageFor(state, opened.workspace.id).enrollments, trial.enrollmentLimit);
  const blocked = recordPurchase(state, opened.workspace.id, {
    clientName: "North Roofing",
    packageId: "reviews-gbp",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, factory);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /packages/);
  const neighbor = recordPurchase(state, other.workspace.id, {
    clientName: "South Plumbing",
    packageId: "lead-follow-up",
    setupPayment: "unrecorded",
    monthlyPayment: "unrecorded",
  }, NOW, factory);
  assert.equal(neighbor.ok, true);
  if (neighbor.ok) {
    state = neighbor.state;
    assert.equal(usageFor(state, other.workspace.id).enrollments, 1);
    assert.equal(usageFor(state, opened.workspace.id).enrollments, trial.enrollmentLimit);
  }
  const capped = {
    ...state,
    usage: state.usage.map((row) => row.tenantId === opened.workspace.id ? { ...row, pipelineRuns: trial.pipelineRunLimit || 0 } : row),
  };
  const stopped = tickFulfillment(capped, opened.workspace.id, NOW, { enabled: true });
  assert.equal(stopped.advanced, 0);
  assert.equal(usageFor(stopped.state, opened.workspace.id).pipelineRuns, trial.pipelineRunLimit);
  const neighborRun = tickFulfillment(stopped.state, other.workspace.id, NOW, { enabled: true });
  assert.ok(neighborRun.advanced > 0);
  assert.equal(usageFor(neighborRun.state, opened.workspace.id).pipelineRuns, trial.pipelineRunLimit);
});

test("test checkout records the plan at zero cents", () => {
  const opened = startMarketerOnboarding(EMPTY_FULFILLMENT, { userId: "marketer-a", workspaceName: "A", now: NOW });
  if (!opened.ok) throw new Error("open");
  const checked = fakeBilling.checkout(opened.state, opened.workspace.id, "test_operator", NOW, "chk-1");
  if (!checked.ok) throw new Error(checked.reason);
  assert.equal(checked.event.amountCents, 0);
  assert.equal(checked.event.type, "checkout");
  assert.equal(checked.event.billingMode, "test");
  const workspace = checked.state.workspaces.find((row) => row.id === opened.workspace.id);
  assert.equal(workspace?.planId, "test_operator");
  assert.equal(workspace?.subscriptionStatus, "active");
  assert.equal(checked.state.invoices.every((row) => row.amountCents === 0), true);
  assert.equal(checked.state.invoices.some((row) => row.status === "paid"), true);
  const foreign = fakeBilling.checkout(checked.state, "ws_nope", "test_agency", NOW, "chk-2");
  assert.equal(foreign.ok, false);
});
