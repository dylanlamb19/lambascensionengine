import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ttsRequestBody, TTS_VOICE_ID } from "./tts-request.ts";
import { classifyTtsHttp, classifyTtsTransportError, voiceFailureReason } from "./voice-failure.ts";
import { decodeTtsAudio, resetAraSpeechForTests, setTtsClientForTests, AraSpeechController } from "./speech-controller.ts";
import { ownerEventSuccessSpeech } from "../calendar/owner-event.ts";

const SOUTHSTATE = "Done — I added ‘Go to South State Bank and withdraw cash’ to your calendar for tomorrow at 4:00 PM.";
const GMAIL = "Yes, Gmail is connected.";

describe("Ara TTS request path", () => {
  it("SouthState success speech is a valid Ara TTS payload", () => {
    const spoken = ownerEventSuccessSpeech("Go to South State Bank and withdraw cash", "tomorrow at 4:00 PM");
    assert.equal(spoken, SOUTHSTATE);
    const body = ttsRequestBody(spoken);
    assert.equal(body.voice_id, TTS_VOICE_ID);
    assert.equal(body.language, "en");
    assert.equal(body.output_format.codec, "pcm");
    assert.equal(body.output_format.sample_rate, 24000);
    assert.equal(body.text, SOUTHSTATE);
    const json = JSON.stringify(body);
    assert.match(json, /South State Bank/);
    assert.doesNotMatch(json, /Authorization|xai-/i);
  });

  it("a simple Gmail confirmation is a valid Ara TTS payload", () => {
    const body = ttsRequestBody(GMAIL);
    assert.equal(body.text, GMAIL);
    assert.equal(body.voice_id, "ara");
  });

  it("classifies TTS HTTP failures instead of a generic PROVIDER_ERROR", () => {
    assert.equal(classifyTtsHttp(401), "VOICE_AUTH_FAILED");
    assert.equal(classifyTtsHttp(403), "VOICE_AUTH_FAILED");
    assert.equal(classifyTtsHttp(429), "VOICE_RATE_LIMITED");
    assert.equal(classifyTtsHttp(400), "VOICE_UPSTREAM_4XX");
    assert.equal(classifyTtsHttp(404), "VOICE_UPSTREAM_4XX");
    assert.equal(classifyTtsHttp(500), "VOICE_UPSTREAM_5XX");
    assert.equal(classifyTtsHttp(503), "VOICE_UPSTREAM_5XX");
    assert.match(voiceFailureReason("VOICE_RATE_LIMITED"), /VOICE_RATE_LIMITED/);
    assert.match(voiceFailureReason("VOICE_TIMEOUT"), /VOICE_TIMEOUT/);
    assert.match(voiceFailureReason("VOICE_BAD_RESPONSE"), /VOICE_BAD_RESPONSE/);
    assert.match(voiceFailureReason("VOICE_AUDIO_DECODE_FAILED"), /VOICE_AUDIO_DECODE_FAILED/);
    assert.match(voiceFailureReason("VOICE_PLAYBACK_FAILED"), /VOICE_PLAYBACK_FAILED/);
  });

  it("classifies aborted fetches as VOICE_TIMEOUT", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    assert.equal(classifyTtsTransportError(abort), "VOICE_TIMEOUT");
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    assert.equal(classifyTtsTransportError(timeout), "VOICE_TIMEOUT");
    assert.equal(classifyTtsTransportError(new Error("socket hang up")), "PROVIDER_ERROR");
  });
});

describe("Ara speech controller TTS path", () => {
  it("plays the exact SouthState calendar success line through Ara TTS", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    const spoken: string[] = [];
    let requested = "";
    c.onCaption = (t) => spoken.push(t);
    const silentPcm = Buffer.alloc(480).toString("base64");
    setTtsClientForTests(async (text, source) => {
      requested = text;
      assert.equal(source, "TOOL_RESULT");
      return { ok: true, pcm: silentPcm, rate: 24000, voice: "Ara", provider: "xAI" };
    });
    const ok = await c.speakAsAra(SOUTHSTATE, { source: "TOOL_RESULT" });
    assert.equal(ok, true);
    assert.equal(requested, SOUTHSTATE);
    assert.equal(spoken[0], SOUTHSTATE);
    assert.equal(c.unavailable, false);
  });

  it("plays a simple Gmail confirmation through Ara TTS", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    let requested = "";
    const silentPcm = Buffer.alloc(480).toString("base64");
    setTtsClientForTests(async (text) => {
      requested = text;
      return { ok: true, pcm: silentPcm, rate: 24000, voice: "Ara", provider: "xAI" };
    });
    await c.speakAsAra(GMAIL, { source: "TOOL_RESULT" });
    assert.equal(requested, GMAIL);
    assert.equal(c.unavailable, false);
  });

  it("TTS failure keeps the caption, does not use browser speech, and resets speaking", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    const captions: string[] = [];
    let reason = "";
    c.onCaption = (t) => captions.push(t);
    c.onUnavailable = (_v, r) => { reason = r; };
    setTtsClientForTests(async () => ({ ok: false, reason: voiceFailureReason("VOICE_UPSTREAM_5XX") }));
    await c.speakAsAra(SOUTHSTATE, { source: "TOOL_RESULT" });
    assert.equal(captions[0], SOUTHSTATE);
    assert.match(reason, /VOICE_UPSTREAM_5XX/);
    assert.equal(c.speaking, false);
    assert.equal(c.diagnostics().browser_tts_active, false);
  });

  it("decodeTtsAudio still reads raw pcm for playback", () => {
    const pcm = new Int16Array([0, 100, -100, 0]);
    const b64 = Buffer.from(pcm.buffer).toString("base64");
    const out = decodeTtsAudio(b64, 24000);
    assert.equal(out.pcm[1], 100);
  });
});
