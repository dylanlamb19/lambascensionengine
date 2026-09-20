import assert from "node:assert/strict";
import test from "node:test";
import { discoverySpoken, placesKeyConfigured } from "./status.ts";

test("placesKeyConfigured never returns the key, only a boolean", () => {
  assert.equal(placesKeyConfigured(() => undefined), false);
  assert.equal(placesKeyConfigured(() => "secret-value"), true);
  assert.equal(placesKeyConfigured(() => "  "), false);
});

test("discoverySpoken names Places without exposing a key", () => {
  assert.match(discoverySpoken(false), /Google Places is not configured/i);
  assert.doesNotMatch(discoverySpoken(false), /AIza|sk-|secret/i);
  assert.match(discoverySpoken(true), /ready/i);
});
