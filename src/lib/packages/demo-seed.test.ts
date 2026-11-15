import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoSeed, demoSeedAllowed, demoTenantId, loadDemoSeed } from "./demo-seed.ts";
import { readTenant, writeTenant } from "./tenant-data.ts";
import { sliceTenant } from "./tenancy.ts";
import { usageFor } from "./usage.ts";

test("the demo seed is two isolated workspaces and refuses production", () => {
  assert.equal(demoSeedAllowed({}), true);
  assert.equal(demoSeedAllowed({ VERCEL_ENV: "preview" }), true);
  assert.equal(demoSeedAllowed({ VERCEL_ENV: "production" }), false);
  const refused = loadDemoSeed({ VERCEL_ENV: "production" });
  assert.equal(refused.ok, false);
  assert.equal(refused.state.workspaces.length, 0);
  assert.equal(refused.state.clients.length, 0);

  const seed = buildDemoSeed();
  assert.equal(seed.workspaces.length, 2);
  const harbor = demoTenantId("demo-harbor");
  const prairie = demoTenantId("demo-prairie");
  assert.ok(harbor && prairie);
  assert.notEqual(harbor, prairie);
  for (const tenantId of [harbor, prairie]) {
    const slice = sliceTenant(seed, tenantId);
    assert.ok(slice.clients.length >= 1);
    assert.ok(slice.enrollments.length >= 1);
    assert.ok(usageFor(seed, tenantId).pipelineRuns > 0);
    assert.ok(slice.steps.some((step) => step.status !== "pending"));
    assert.equal(slice.invoices.every((row) => row.amountCents === 0), true);
  }
  const names = {
    harbor: sliceTenant(seed, harbor).clients.map((row) => row.name).sort(),
    prairie: sliceTenant(seed, prairie).clients.map((row) => row.name).sort(),
  };
  assert.deepEqual(names.harbor, ["Lakeside HVAC", "North Roofing"]);
  assert.deepEqual(names.prairie, ["Main Street Dental", "Red Barn Roofing"]);
  const session = { userId: "demo-harbor", tenantId: harbor };
  const seen = readTenant(seed, session, seed.clients);
  assert.equal(seen.ok, true);
  if (seen.ok) assert.deepEqual(seen.rows.map((row) => row.name).sort(), names.harbor);
  const write = writeTenant(seed, session, { id: "x", tenantId: prairie, name: "Smuggled", createdAt: seed.clients[0].createdAt }, (current, row) => ({
    ...current,
    clients: [...current.clients, row],
  }));
  assert.equal(write.ok, false);
  if (!write.ok) assert.equal(write.state.clients.length, seed.clients.length);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "demo-seed.ts"), "utf8");
  assert.doesNotMatch(src, /getSql|@\/lib\/db|DATABASE_URL/);
});
