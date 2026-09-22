import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isVercelProduction,
  isWorkspacePreview,
  resolveDbSource,
} from "./env.server.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("production vs Grok workspace preview", () => {
  it("1. Vercel Production with no GROK_PROJECT_ID is NOT preview", () => {
    withEnv({ VERCEL_ENV: "production", GROK_PROJECT_ID: undefined }, () => {
      assert.equal(isVercelProduction(), true);
      assert.equal(isWorkspacePreview(), false);
    });
  });

  it("Grok sandbox with no GROK_PROJECT_ID remains preview", () => {
    withEnv({ VERCEL_ENV: undefined, GROK_PROJECT_ID: undefined }, () => {
      assert.equal(isVercelProduction(), false);
      assert.equal(isWorkspacePreview(), true);
    });
  });

  it("Grok published app with GROK_PROJECT_ID is not preview", () => {
    withEnv({ VERCEL_ENV: undefined, GROK_PROJECT_ID: "proj-123" }, () => {
      assert.equal(isWorkspacePreview(), false);
    });
  });

  it("any Vercel environment is never a Grok workspace preview", () => {
    withEnv({ VERCEL_ENV: "preview", GROK_PROJECT_ID: undefined }, () => {
      assert.equal(isVercelProduction(), false);
      assert.equal(isWorkspacePreview(), false);
    });
  });
});

describe("persistent database vs PGLite", () => {
  it("4. Production with DATABASE_URL never uses PGlite", () => {
    assert.equal(resolveDbSource("postgres://ep-prod.neon.tech/neondb"), "neon");
    assert.equal(resolveDbSource("postgresql://user:pass@host/db"), "neon");
    assert.equal(resolveDbSource(undefined), "pglite");
    assert.equal(resolveDbSource(null), "pglite");
    assert.equal(resolveDbSource(""), "pglite");
    assert.equal(resolveDbSource("   "), "pglite");
  });

  it("db.ts routes through resolveDbSource and never seeds demo prospects", () => {
    const src = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    assert.match(src, /resolveDbSource\(databaseUrl\)/);
    assert.doesNotMatch(src, /\bSEED\b/);
    assert.doesNotMatch(src, /insert into prospects/i);
    assert.doesNotMatch(src, /drop table/i);
  });
});
