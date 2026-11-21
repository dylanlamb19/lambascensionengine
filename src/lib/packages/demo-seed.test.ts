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
  const harborLeads = sliceTenant(seed, harbor);
  assert.equal(harborLeads.leads.map((row) => row.contactName).join(), "Sam Ellis");
  assert.equal(sliceTenant(seed, prairie).leads.length, 0);
  assert.equal(sliceTenant(seed, prairie).leadSteps.length, 0);
  const drafted = harborLeads.leadSteps.find((row) => row.stepId === "speed-to-lead");
  assert.equal(drafted?.status, "needs_human");
  assert.match(drafted?.lastError || "", /Connected \(test\): Mailbox/);
  assert.match(drafted?.lastError || "", /Missing connection: Mailbox/);
  assert.match(drafted?.logs.map((row) => row.message).join("\n") || "", /Dry run/);
  assert.match(drafted?.logs.map((row) => row.message).join("\n") || "", /Nothing was sent/);
  const day3 = harborLeads.leadSteps.find((row) => row.stepId === "day-3");
  assert.equal(day3?.status, "pending");
  assert.equal(day3?.nextRunAt, "2026-11-16T15:00:00.000Z");
  assert.equal(harborLeads.packageRuns.map((row) => row.packageId).sort().join(), "ai-visibility,google-ads,lead-generation,reviews-gbp");
  assert.equal(harborLeads.packageRunSteps.find((row) => row.stepId === "launch")?.status, "needs_human");
  assert.match(harborLeads.packageRunSteps.find((row) => row.stepId === "ad-copy")?.draft || "", /Google/);
  assert.match(harborLeads.packageRunSteps.find((row) => row.stepId === "ad-copy")?.draft || "", /Meta/);
  assert.equal(harborLeads.packageRunSteps.find((row) => row.stepId === "ai-recommendation")?.status, "needs_human");
  assert.equal(harborLeads.completedJobs.map((row) => row.customerName).join(), "Riley Chen");
  assert.equal(harborLeads.reviewRequestSteps.find((row) => row.stepId === "review-request")?.status, "done");
  assert.match(harborLeads.reviewRequestSteps[0]?.output || "", /Nothing was sent/);
  assert.equal(harborLeads.packageRunSteps.find((row) => row.stepId === "reply-drafts")?.status, "needs_human");
  assert.equal(harborLeads.appointments.map((row) => row.customerName).join(), "Avery Cole");
  assert.equal(harborLeads.appointments[0]?.calendar, "booking_calendar");
  assert.equal(harborLeads.appointmentSteps.find((row) => row.stepId === "confirm")?.status, "done");
  assert.equal(harborLeads.appointmentSteps.find((row) => row.stepId === "reminder-2h")?.nextRunAt, "2026-11-17T14:00:00.000Z");
  assert.equal(harborLeads.estimates.map((row) => row.customerName).join(), "Pat Nguyen");
  assert.equal(harborLeads.estimateSteps.find((row) => row.stepId === "day-2")?.status, "done");
  assert.equal(harborLeads.estimateSteps.find((row) => row.stepId === "day-5")?.status, "pending");
  assert.match(harborLeads.estimateSteps.find((row) => row.stepId === "day-2")?.output || "", /Nothing was sent/);
  assert.equal(harborLeads.packageRunSteps.find((row) => row.packageId === "google-ads" && row.stepId === "campaign-plan")?.status, "done");
  assert.equal(harborLeads.packageRunSteps.find((row) => row.packageId === "google-ads" && row.stepId === "change-proposal")?.status, "needs_human");
  assert.match(harborLeads.packageRunSteps.find((row) => row.packageId === "google-ads" && row.stepId === "weekly-report")?.draft || "", /120/);
  assert.doesNotMatch(harborLeads.packageRunSteps.find((row) => row.packageId === "google-ads" && row.stepId === "weekly-report")?.draft || "", /prairie/);
  const prairieSlice = sliceTenant(seed, prairie);
  assert.equal(prairieSlice.packageRuns.map((row) => row.packageId).sort().join(), "google-ads,reviews-gbp");
  assert.equal(prairieSlice.completedJobs.map((row) => row.customerName).join(), "Jordan Hale");
  assert.equal(prairieSlice.appointments.map((row) => row.customerName).join(), "Morgan Diaz");
  assert.equal(prairieSlice.estimates.map((row) => row.customerName).join(), "Casey Brook");
  assert.match(prairieSlice.packageRunSteps.find((row) => row.packageId === "google-ads" && row.stepId === "weekly-report")?.draft || "", /40/);
  assert.equal(prairieSlice.generatedLeads.length, 0);
  assert.equal(harborLeads.estimates.some((row) => row.customerName === "Casey Brook"), false);
  assert.equal(prairieSlice.estimates.some((row) => row.customerName === "Pat Nguyen"), false);
  assert.equal(harborLeads.completedJobs.some((row) => row.customerName === "Jordan Hale"), false);
  assert.equal(prairieSlice.completedJobs.some((row) => row.customerName === "Riley Chen"), false);
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
