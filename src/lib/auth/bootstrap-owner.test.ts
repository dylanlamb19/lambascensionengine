import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emailAndPasswordConfig } from "./email-password.ts";

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
  assert.match(src, /hashPassword/);
  assert.doesNotMatch(src, /delete from "prospect/);
  assert.doesNotMatch(src, /drop table/i);
});
