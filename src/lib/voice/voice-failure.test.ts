import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { voiceFailure, voiceFailureReason } from "./voice-failure.ts";

test("missing xAI key is a distinct category, not a generic outage", () => {
  const miss = voiceFailure("XAI_KEY_MISSING");
  assert.equal(miss.ok, false);
  assert.equal(miss.code, "XAI_KEY_MISSING");
  assert.match(miss.reason, /XAI_KEY_MISSING/);
  assert.doesNotMatch(miss.reason, /speechSynthesis|SpeechSynthesisUtterance/);
});

test("every reconnect failure category is named", () => {
  for (const code of [
    "XAI_KEY_MISSING",
    "SESSION_CREATE_FAILED",
    "WEBSOCKET_FAILED",
    "MIC_BLOCKED",
    "AUDIO_OUTPUT_BLOCKED",
    "PROVIDER_ERROR",
  ] as const) {
    assert.match(voiceFailureReason(code), new RegExp(code));
  }
});

test("session mint returns XAI_KEY_MISSING when the key is absent", () => {
  const src = readFileSync(new URL("./ara-session.ts", import.meta.url), "utf8");
  assert.match(src, /XAI_KEY_MISSING/);
  assert.match(src, /SESSION_CREATE_FAILED/);
  assert.match(src, /process\.env\.XAI_API_KEY/);
});

test("Reconnect Ara Voice always mints a real session", () => {
  const desk = readFileSync(new URL("../../components/owner-desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /reconnectAraVoice/);
  assert.match(desk, /createAraSessionFn/);
  const bar = readFileSync(new URL("../../components/voice-bar.tsx", import.meta.url), "utf8");
  assert.match(bar, /Reconnect Ara Voice/);
  assert.match(bar, /data-voice-provider="xAI"/);
  assert.match(bar, /data-browser-tts="0"/);
  assert.doesNotMatch(bar, /speechSynthesis/);
});

test("owner desk never uses browser speechSynthesis as Ara", () => {
  const desk = readFileSync(new URL("../../components/owner-desk.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(desk, /speechSynthesis|SpeechSynthesisUtterance/);
});
