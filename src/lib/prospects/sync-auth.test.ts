import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("prospect and discovery server functions require auth and ignore client user_id", () => {
  const sync = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");
  const find = readFileSync(new URL("../discovery/run.ts", import.meta.url), "utf8");
  const repo = readFileSync(new URL("./repo.server.ts", import.meta.url), "utf8");
  for (const src of [sync, find]) {
    assert.match(src, /authMiddleware/);
    assert.doesNotMatch(src, /data\.userId|data\.user_id/);
  }
  assert.match(repo, /where user_id = \$\{userId\}/);
  assert.match(repo, /never a client-supplied user_id/);
});

test("Places is reserved before the live API call", () => {
  const run = readFileSync(new URL("../discovery/run.ts", import.meta.url), "utf8");
  assert.match(run, /reserve:\s*async \(kind\)/);
  assert.match(run, /tryReserveDiscovery\(context\.userId, cents\)/);
  assert.match(run, /We will not invent businesses/);
  assert.match(run, /if \(!hits\.length\)/);
});
