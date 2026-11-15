import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PREVIEW_CLIENT_ID,
  PREVIEW_SIGN_IN_DISABLED_MESSAGE,
  resolveGrokClientCredentials,
} from "./preview.ts";

const FIXTURE_PREVIEW = "preview-env-secret-not-real";
const FIXTURE_DEPLOYED = "deployed-env-secret-not-real";

describe("preview sign-in credentials", () => {
  it("fails closed when neither client secret is set", () => {
    const creds = resolveGrokClientCredentials({});
    assert.equal(creds.previewSignInEnabled, false);
    assert.equal(creds.clientSecret, undefined);
    assert.equal(creds.secretSource, null);
    assert.equal(creds.clientId, PREVIEW_CLIENT_ID);
    assert.match(PREVIEW_SIGN_IN_DISABLED_MESSAGE, /Preview sign-in is disabled/);
    assert.match(PREVIEW_SIGN_IN_DISABLED_MESSAGE, /GROK_PREVIEW_CLIENT_SECRET/);
    assert.match(PREVIEW_SIGN_IN_DISABLED_MESSAGE, /GROK_AUTH_CLIENT_SECRET/);
    assert.match(PREVIEW_SIGN_IN_DISABLED_MESSAGE, /No fallback secret is used/);
    assert.doesNotMatch(PREVIEW_SIGN_IN_DISABLED_MESSAGE, /[0-9a-f]{32,}/);
  });

  it("treats blank secrets as unset", () => {
    const creds = resolveGrokClientCredentials({
      GROK_PREVIEW_CLIENT_SECRET: "   ",
      GROK_AUTH_CLIENT_SECRET: "",
    });
    assert.equal(creds.previewSignInEnabled, false);
    assert.equal(creds.clientSecret, undefined);
  });

  it("enables preview sign-in only from GROK_PREVIEW_CLIENT_SECRET", () => {
    const creds = resolveGrokClientCredentials({
      GROK_PREVIEW_CLIENT_SECRET: `  ${FIXTURE_PREVIEW}  `,
    });
    assert.equal(creds.previewSignInEnabled, true);
    assert.equal(creds.secretSource, "GROK_PREVIEW_CLIENT_SECRET");
    assert.equal(creds.clientSecret, FIXTURE_PREVIEW);
    assert.equal(creds.clientId, PREVIEW_CLIENT_ID);
    assert.doesNotMatch(PREVIEW_SIGN_IN_DISABLED_MESSAGE, new RegExp(FIXTURE_PREVIEW));
  });

  it("prefers the deployed GROK_AUTH_CLIENT_SECRET over the preview secret", () => {
    const creds = resolveGrokClientCredentials({
      GROK_AUTH_CLIENT_ID: "app-client",
      GROK_AUTH_CLIENT_SECRET: FIXTURE_DEPLOYED,
      GROK_PREVIEW_CLIENT_SECRET: FIXTURE_PREVIEW,
    });
    assert.equal(creds.previewSignInEnabled, true);
    assert.equal(creds.secretSource, "GROK_AUTH_CLIENT_SECRET");
    assert.equal(creds.clientSecret, FIXTURE_DEPLOYED);
    assert.equal(creds.clientId, "app-client");
  });

  it("does not bake a client secret into preview.ts or server.ts", () => {
    const previewSrc = readFileSync(new URL("./preview.ts", import.meta.url), "utf8");
    const serverSrc = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(previewSrc, /(?<![A-Z_])PREVIEW_CLIENT_SECRET\s*=/);
    assert.doesNotMatch(previewSrc, /["'][0-9a-f]{32,}["']/);
    assert.doesNotMatch(serverSrc, /(?<![A-Z_])PREVIEW_CLIENT_SECRET/);
    assert.doesNotMatch(serverSrc, /\?\?\s*["'][0-9a-f]{16,}["']/);
    assert.match(serverSrc, /resolveGrokClientCredentials\(process\.env\)/);
    assert.match(serverSrc, /PREVIEW_SIGN_IN_DISABLED_MESSAGE/);
    assert.match(serverSrc, /console\.error\(PREVIEW_SIGN_IN_DISABLED_MESSAGE\)/);
  });
});
