import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import {
  EMAIL_PASSWORD_SIGN_UP_DISABLED,
  emailAndPasswordConfig,
} from "./email-password.ts";

describe("single-owner desk — public registration is impossible", () => {
  it("5. public signup remains disabled", () => {
    assert.equal(emailAndPasswordConfig.disableSignUp, true);
    assert.equal(EMAIL_PASSWORD_SIGN_UP_DISABLED, true);
    assert.equal(
      Boolean(emailAndPasswordConfig.enabled) && !emailAndPasswordConfig.disableSignUp,
      false,
    );
  });

  it("sign-up/email is rejected by Better Auth before a user is created", async () => {
    const auth = betterAuth({
      baseURL: "http://localhost:8080",
      secret: "test-secret-test-secret-test-secret-32",
      emailAndPassword: { ...emailAndPasswordConfig },
    });
    await assert.rejects(
      () =>
        auth.api.signUpEmail({
          body: { email: "intruder@example.com", password: "not-the-owner-pass", name: "Intruder" },
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return /sign up is not enabled|EMAIL_PASSWORD_SIGN_UP_DISABLED|disabled/i.test(msg);
      },
    );
  });

  it("Owner Mode has no Create account / signUp.email path", () => {
    const desk = readFileSync(new URL("../../../src/components/owner-desk.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(desk, /signUp\.email/);
    assert.doesNotMatch(desk, /Create owner account/);
    assert.doesNotMatch(desk, /Create account/);
    assert.match(desk, /signIn\.email/);
    assert.doesNotMatch(desk, /changeme/);
  });

  it("Better Auth catch-all is mounted so email sign-in can reach the server", () => {
    const src = readFileSync(new URL("../../../src/routes/api/auth/$.ts", import.meta.url), "utf8");
    assert.match(src, /createFileRoute\("\/api\/auth\/\$"\)/);
    assert.match(src, /auth\.handler/);
    assert.match(src, /ensureDbReady/);
  });
});
