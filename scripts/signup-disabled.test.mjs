import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("source-level: public registration is closed", () => {
  it("email-password config disables sign-up", () => {
    const src = readFileSync(join(root, "src/lib/auth/email-password.ts"), "utf8");
    assert.match(src, /disableSignUp:\s*true/);
  });

  it("server.ts wires disableSignUp for email and OAuth", () => {
    const src = readFileSync(join(root, "src/lib/auth/server.ts"), "utf8");
    assert.match(src, /emailAndPasswordConfig/);
    assert.match(src, /disableSignUp:\s*true/);
    assert.match(src, /disableImplicitSignUp:\s*true/);
  });

  it("owner desk never calls signUp or offers account creation", () => {
    const src = readFileSync(join(root, "src/components/owner-desk.tsx"), "utf8");
    assert.doesNotMatch(src, /signUp\.email/);
    assert.doesNotMatch(src, /Create owner account/);
    assert.doesNotMatch(src, /needsAccount/);
    assert.doesNotMatch(src, /changeme/);
  });
});
