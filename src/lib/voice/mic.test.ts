import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listeningAllowed, micStatusLabel, micStreamLive } from "./mic.ts";

describe("microphone permission truth", () => {
  it("Listening is only allowed when conversation, mic, stream, session, and sending are all live", () => {
    const ready = {
      conversationOn: true,
      micPermission: "GRANTED" as const,
      micStreamActive: true,
      voiceSessionReady: true,
      micSending: true,
    };
    assert.equal(listeningAllowed(ready), true);
    assert.equal(listeningAllowed({ ...ready, conversationOn: false }), false);
    assert.equal(listeningAllowed({ ...ready, micPermission: "BLOCKED" }), false);
    assert.equal(listeningAllowed({ ...ready, micPermission: "DENIED" }), false);
    assert.equal(listeningAllowed({ ...ready, micStreamActive: false }), false);
    assert.equal(listeningAllowed({ ...ready, voiceSessionReady: false }), false);
    assert.equal(listeningAllowed({ ...ready, micSending: false }), false);
  });

  it("status labels never say Listening when mic is missing", () => {
    assert.equal(micStatusLabel("BLOCKED"), "Mic needed");
    assert.equal(micStatusLabel("DENIED"), "Mic needed");
    assert.equal(micStatusLabel("UNAVAILABLE"), "Voice input unavailable");
    assert.doesNotMatch(micStatusLabel("BLOCKED"), /Listening/);
  });

  it("micStreamLive requires a live enabled track", () => {
    assert.equal(micStreamLive(null), false);
    assert.equal(micStreamLive(undefined), false);
  });
});
