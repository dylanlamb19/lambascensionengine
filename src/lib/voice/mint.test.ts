import assert from "node:assert/strict";
import test from "node:test";
import {
  araClientSecretsMintBodies,
  mintEphemeralClientSecret,
  publicPayloadOrFail,
  shouldRetryMint,
} from "./mint.ts";
import { classifyMintHttp } from "./voice-failure.ts";

test("voice session creation success from provider token", async () => {
  let calls = 0;
  const minted = await mintEphemeralClientSecret("xai-test-key", async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init.body)) as { session?: { model?: string } };
    assert.equal(body.session?.model, "grok-voice-latest");
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ value: "xai-realtime-client-secret-ok", expires_at: 99 }),
    };
  });
  assert.equal(minted.ok, true);
  assert.equal(calls, 1);
  if (minted.ok) {
    const pub = publicPayloadOrFail(minted.raw, "xai-test-key");
    assert.equal(pub.ok, true);
    if (pub.ok) assert.equal(pub.token, "xai-realtime-client-secret-ok");
  }
});

test("voice provider failure classification", () => {
  assert.equal(classifyMintHttp(403, "forbidden"), "ARA_VOICE_PROVIDER_AUTH_FAILED");
  assert.equal(classifyMintHttp(403, "You have run out of credits [WKE=personal-team-blocked:spending-limit]"), "VOICE_CREDITS_EXHAUSTED");
  assert.equal(classifyMintHttp(401, "invalid api key"), "ARA_VOICE_PROVIDER_AUTH_FAILED");
  assert.equal(classifyMintHttp(503, "down"), "ARA_VOICE_PROVIDER_UNAVAILABLE");
  assert.equal(classifyMintHttp(400, "bad session"), "ARA_VOICE_SESSION_CREATE_FAILED");
  assert.equal(shouldRetryMint(403), true);
  assert.equal(shouldRetryMint(400), true);
  assert.equal(shouldRetryMint(401), false);
});

test("first 403 spending-limit retries session-bound body and succeeds", async () => {
  const statuses: number[] = [];
  const minted = await mintEphemeralClientSecret("xai-test-key", async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { session?: unknown };
    if (body.session) {
      statuses.push(200);
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ value: "xai-realtime-client-secret-retry", expires_at: 1 }),
      };
    }
    statuses.push(403);
    return {
      ok: false,
      status: 403,
      text: async () => "You have run out of credits [WKE=personal-team-blocked:spending-limit]",
      json: async () => ({}),
    };
  });
  assert.equal(minted.ok, true);
  assert.deepEqual(statuses, [200]);
});

test("403 on first body without session still retries the other shape", async () => {
  const bodies = araClientSecretsMintBodies();
  assert.equal("session" in bodies[0]!, true);
  let n = 0;
  const minted = await mintEphemeralClientSecret("xai-test-key", async () => {
    n += 1;
    if (n === 1) {
      return {
        ok: false,
        status: 403,
        text: async () => "You have run out of credits",
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ value: "xai-realtime-client-secret-second", expires_at: 2 }),
    };
  });
  assert.equal(n, 2);
  assert.equal(minted.ok, true);
});
