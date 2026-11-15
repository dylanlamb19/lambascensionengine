import assert from "node:assert/strict";
import test from "node:test";
import { FLAGS } from "../flags.ts";
import {
  formatMonthly,
  formatSetup,
  getPackage,
  includedPackages,
  listPackages,
  PACKAGE_IDS,
} from "./catalog.ts";

test("catalog lists the ten offer-sheet packages", () => {
  assert.equal(listPackages().length, 10);
  assert.deepEqual(listPackages().map((pkg) => pkg.id), [...PACKAGE_IDS]);
  assert.equal(new Set(PACKAGE_IDS).size, PACKAGE_IDS.length);
});

test("prices and setup fees match the offer sheet", () => {
  const expect: Record<string, [number, number, string]> = {
    "lead-follow-up": [35000, 50000, "fixed"],
    "ai-visibility": [60000, 0, "fixed"],
    "google-ads": [75000, 0, "fixed"],
    "meta-ads": [65000, 0, "fixed"],
    "lead-generation": [50000, 50000, "fixed"],
    "estimate-follow-ups": [20000, 25000, "fixed"],
    "reviews-gbp": [15000, 0, "fixed"],
    "appointment-reminders": [10000, 15000, "fixed"],
    "office-automation": [40000, 50000, "from"],
    "google-meta-ai": [250000, 0, "fixed"],
  };
  for (const [id, [monthly, setup, kind]] of Object.entries(expect)) {
    const pkg = getPackage(id as typeof PACKAGE_IDS[number]);
    assert.equal(pkg.monthlyCents, monthly, id);
    assert.equal(pkg.setupCents, setup, id);
    assert.equal(pkg.pricingKind, kind, id);
  }
  assert.equal(formatMonthly(getPackage("lead-follow-up")), "$350/mo");
  assert.equal(formatSetup(getPackage("lead-follow-up")), "$500 setup");
  assert.equal(formatMonthly(getPackage("office-automation")), "from $400/mo");
  assert.equal(formatMonthly(getPackage("google-meta-ai")), "$2,500/mo");
  assert.equal(formatSetup(getPackage("google-meta-ai")), "No setup fee");
});

test("the bundle is AI visibility, Google, Meta, and lead generation, with setup waived", () => {
  const bundle = getPackage("google-meta-ai");
  assert.deepEqual([...bundle.includes], ["ai-visibility", "google-ads", "meta-ads", "lead-generation"]);
  const parts = includedPackages("google-meta-ai");
  assert.equal(parts.reduce((sum, pkg) => sum + pkg.monthlyCents, 0), bundle.monthlyCents);
  assert.equal(parts.reduce((sum, pkg) => sum + pkg.setupCents, 0), 50000);
  assert.equal(bundle.setupCents, 0);
});

test("estimate follow-ups are an add-on and do not include lead follow-up steps", () => {
  const addon = getPackage("estimate-follow-ups");
  assert.equal(addon.addonOf, "lead-follow-up");
  assert.equal(addon.features.some((line) => /does not create a second/i.test(line)), true);
});

test("package fulfillment is off by default", () => {
  assert.equal(FLAGS.PACKAGE_FULFILLMENT, false);
});
