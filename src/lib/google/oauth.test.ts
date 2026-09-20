import assert from "node:assert/strict";
import test from "node:test";
import { googleOAuthConfigured, googleOAuthSetup } from "./oauth.ts";
import { isGoogleOauthMessage } from "./launch.ts";

test("googleOAuthSetup lists configuration names, never secret values", () => {
  const rows = googleOAuthSetup();
  assert.deepEqual(rows.map((r) => r.name), [
    "Google OAuth Client ID",
    "Google OAuth Client Secret",
    "APP_SECRET",
  ]);
  const blob = JSON.stringify(rows);
  assert.equal(blob.includes("sk-"), false);
  assert.doesNotMatch(blob, /GOCSPX|ya29\.|client_secret/i);
});

test("googleOAuthConfigured is false when client id or secret is missing", () => {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    assert.equal(googleOAuthConfigured(), false);
    const rows = googleOAuthSetup();
    assert.equal(rows.find((r) => r.name === "Google OAuth Client ID")?.ready, false);
    assert.equal(rows.find((r) => r.name === "Google OAuth Client Secret")?.ready, false);
  } finally {
    if (id !== undefined) process.env.GOOGLE_OAUTH_CLIENT_ID = id;
    else delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (secret !== undefined) process.env.GOOGLE_OAUTH_CLIENT_SECRET = secret;
    else delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  }
});

test("google oauth popup messages are recognized without leaking secrets", () => {
  assert.equal(isGoogleOauthMessage({ source: "lascengine-google", status: "connected" }), true);
  assert.equal(isGoogleOauthMessage({ source: "other", status: "connected" }), false);
  assert.equal(isGoogleOauthMessage("connected"), false);
});
