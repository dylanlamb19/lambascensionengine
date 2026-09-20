import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { realtimeErrorText } from "./voice-failure.ts";
import { shouldFailClosedOnRealtimeError } from "./lifecycle.ts";

describe("Conversation Mode realtime errors", () => {
  it("does not take Ara down for a benign response.cancel after a calendar intercept", () => {
    const cancel = {
      type: "error",
      error: { type: "invalid_request_error", code: "response_cancel_not_active", message: "Cancellation failed: no active response" },
    };
    assert.match(realtimeErrorText(cancel), /response_cancel_not_active|no active response/i);
    assert.equal(shouldFailClosedOnRealtimeError(cancel), false);

    const inProgress = {
      type: "error",
      error: { code: "conversation_already_has_active_response", message: "Already has an active response" },
    };
    assert.equal(shouldFailClosedOnRealtimeError(inProgress), false);

    const buffer = {
      type: "error",
      error: { message: "input_audio_buffer is too small" },
    };
    assert.equal(shouldFailClosedOnRealtimeError(buffer), false);
  });

  it("still fails closed on fatal auth / session errors", () => {
    const auth = { type: "error", error: { message: "invalid auth token" } };
    assert.equal(shouldFailClosedOnRealtimeError(auth), true);
    const session = { type: "error", error: { message: "invalid session configuration" } };
    assert.equal(shouldFailClosedOnRealtimeError(session), true);
  });

  it("does not leak Authorization headers from error text", () => {
    const ev = { type: "error", error: { message: "Cancellation failed: no active response" } };
    assert.doesNotMatch(realtimeErrorText(ev), /Authorization|Bearer |xai-/i);
  });
});
