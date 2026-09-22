import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emailAndPasswordConfig } from "./email-password.ts";
import { ownerBootstrapPlan } from "./owner-bootstrap-plan.ts";

test("public signup stays disabled after the owner exists", () => {
  assert.equal(emailAndPasswordConfig.disableSignUp, true);
});

test("bootstrap is server-only and blocks default production passwords", () => {
  const src = readFileSync(new URL("./bootstrap-owner.server.ts", import.meta.url), "utf8");
  assert.match(src, /OWNER_EMAIL/);
  assert.match(src, /OWNER_PASSWORD/);
  assert.match(src, /owner_exists/);
  assert.match(src, /default_password_blocked/);
  assert.match(src, /Never import this from client code/);
  assert.match(src, /preview_reset/);
  assert.match(src, /isWorkspacePreview/);
  assert.match(src, /isVercelProduction/);
  assert.match(src, /ownerBootstrapPlan/);
  assert.match(src, /hashPassword/);
  assert.doesNotMatch(src, /delete from "prospect/);
  assert.doesNotMatch(src, /drop table/i);
  assert.doesNotMatch(src, /truncate /i);
});

test("2. empty persistent DB bootstraps owner once", () => {
  assert.equal(
    ownerBootstrapPlan({
      email: "owner@example.com",
      password: "a-real-password",
      ownerExists: false,
      workspacePreview: false,
      vercelProduction: true,
      productionLike: true,
    }),
    "insert_owner",
  );
});

test("3. second boot does NOT change owner credentials", () => {
  const second = ownerBootstrapPlan({
    email: "new-owner@example.com",
    password: "a-different-password",
    ownerExists: true,
    workspacePreview: false,
    vercelProduction: true,
    productionLike: true,
  });
  assert.equal(second, "owner_exists");

  // Even if preview detection were wrong, Vercel Production must not reset.
  assert.equal(
    ownerBootstrapPlan({
      email: "new-owner@example.com",
      password: "a-different-password",
      ownerExists: true,
      workspacePreview: true,
      vercelProduction: true,
      productionLike: true,
    }),
    "owner_exists",
  );
});

test("preview sandbox may reset leftover owner; production never does", () => {
  assert.equal(
    ownerBootstrapPlan({
      email: "admin@localhost.com",
      password: "preview-pass",
      ownerExists: true,
      workspacePreview: true,
      vercelProduction: false,
      productionLike: false,
    }),
    "preview_reset",
  );
  assert.equal(
    ownerBootstrapPlan({
      email: "owner@example.com",
      password: "changeme",
      ownerExists: false,
      workspacePreview: false,
      vercelProduction: true,
      productionLike: true,
    }),
    "default_password_blocked",
  );
});
