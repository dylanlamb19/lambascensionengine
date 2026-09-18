import assert from "node:assert/strict";
import test from "node:test";
import { createPinnedLookup } from "./pinned-lookup.ts";

test("pinned lookup resolves the exact pinned host to the pinned IP (2-arg callback form)", () => {
  const lookup = createPinnedLookup("example.com", "93.184.216.34");
  lookup("example.com", undefined, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
});

test("pinned lookup resolves the exact pinned host to the pinned IP (options.all array form)", () => {
  const lookup = createPinnedLookup("example.com", "93.184.216.34");
  lookup("example.com", { all: true }, (err: Error | null, addresses?: { address: string; family: number }[]) => {
    assert.equal(err, null);
    assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
  });
});

test("pinned lookup detects IPv6 pinned addresses and reports family 6", () => {
  const lookup = createPinnedLookup("example.com", "2606:2800:220:1:248:1893:25c8:1946");
  lookup("example.com", { all: true }, (err: Error | null, addresses?: { address: string; family: number }[]) => {
    assert.equal(err, null);
    assert.deepEqual(addresses, [{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
  });
});

test("pinned lookup REFUSES a host other than the one it was built for, rather than resolving it for real", () => {
  // This is the core of the fix: a per-request Agent is built for exactly
  // one validated (hostname, ip) pair. If undici's connector ever asked
  // this lookup function to resolve a DIFFERENT hostname, silently doing a
  // real lookup would quietly un-pin the connection. It must fail instead.
  const lookup = createPinnedLookup("example.com", "93.184.216.34");
  let sawError = false;
  lookup("attacker.example", undefined, (err: Error | null) => {
    sawError = err != null;
  });
  assert.equal(sawError, true);
});
