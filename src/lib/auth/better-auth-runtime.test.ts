import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolveBetterAuthRuntime } from "./better-auth-runtime.ts";

const PRODUCTION_URL = "https://lamb-ascension-engine.vercel.app";

describe("Better Auth production URL and secret", () => {
  it("6. uses configured production URL and secret, not preview defaults", () => {
    const runtime = resolveBetterAuthRuntime({
      betterAuthUrl: PRODUCTION_URL,
      betterAuthSecret: "configured-production-secret",
      previewSecret: "preview-random-must-not-win",
    });
    assert.equal(runtime.baseURL, PRODUCTION_URL);
    assert.equal(runtime.secret, "configured-production-secret");
    assert.equal(runtime.usesConfiguredUrl, true);
    assert.equal(runtime.usesConfiguredSecret, true);
    assert.notEqual(runtime.secret, "preview-random-must-not-win");
  });

  it("falls back to the preview secret only when BETTER_AUTH_SECRET is unset", () => {
    const runtime = resolveBetterAuthRuntime({
      betterAuthUrl: undefined,
      betterAuthSecret: "  ",
      previewSecret: "preview-only",
    });
    assert.equal(runtime.baseURL, undefined);
    assert.equal(runtime.usesConfiguredUrl, false);
    assert.equal(runtime.usesConfiguredSecret, false);
    assert.equal(runtime.secret, "preview-only");
  });

  it("server.ts wires BETTER_AUTH_URL / BETTER_AUTH_SECRET through the runtime helper", () => {
    const src = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    assert.match(src, /resolveBetterAuthRuntime/);
    assert.match(src, /BETTER_AUTH_URL/);
    assert.match(src, /BETTER_AUTH_SECRET/);
    assert.match(src, /betterAuthRuntime\.secret/);
    assert.doesNotMatch(src, /APP_SECRET/);
  });
});
