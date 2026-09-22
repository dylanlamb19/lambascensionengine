import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  AraSpeechController,
  decodeTtsAudio,
  resetAraSpeechForTests,
  setTtsClientForTests,
} from "./speech-controller.ts";
import { speak } from "./speech.ts";

const silentPcm = Buffer.alloc(480).toString("base64"); // 240 samples of zeros

describe("AraSpeechController", () => {
  it("diagnostics report xAI Ara and never browser TTS", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    setTtsClientForTests(async () => ({ ok: true, pcm: silentPcm, rate: 24000, voice: "Ara", provider: "xAI" }));
    const captions: string[] = [];
    c.onCaption = (t) => captions.push(t);
    await c.speakAsAra("Google Places isn't connected yet.", { source: "BLOCKER" });
    const d = c.diagnostics();
    assert.equal(d.voice_provider, "xAI");
    assert.equal(d.voice_name, "Ara");
    assert.equal(d.browser_tts_active, false);
    assert.equal(d.fallback_tts_active, false);
    assert.equal(captions[0], "Google Places isn't connected yet.");
  });

  it("queues a warning while conversation audio is playing and does not drop the caption", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    let started = 0;
    setTtsClientForTests(async () => {
      started += 1;
      return { ok: true, pcm: silentPcm, rate: 24000, voice: "Ara", provider: "xAI" };
    });
    c.playConversationPcm(new Int16Array(240));
    const queued = await c.speakAsAra("Gmail can’t connect because Google OAuth isn’t configured yet.", { source: "WARNING" });
    assert.equal(queued, true);
    assert.equal(started, 0);
    assert.equal(c.diagnostics().speech_queue_length >= 1, true);
    c.conversationEnded();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(started, 1);
  });

  it("on TTS failure keeps the caption and marks Ara voice unavailable — no browser fallback", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    const captions: string[] = [];
    let unavailable = false;
    c.onCaption = (t) => captions.push(t);
    c.onUnavailable = (v) => { unavailable = v; };
    setTtsClientForTests(async () => ({ ok: false, reason: "Ara's voice isn't available right now." }));
    await c.speakAsAra("Google Places isn't connected yet.", { source: "SCREEN_READER" });
    assert.equal(captions[0], "Google Places isn't connected yet.");
    assert.equal(unavailable, true);
    assert.equal(c.unavailable, true);
    assert.equal(c.diagnostics().browser_tts_active, false);
  });

  it("dedupes the same blocker key", async () => {
    resetAraSpeechForTests();
    const c = new AraSpeechController();
    let n = 0;
    setTtsClientForTests(async () => {
      n += 1;
      return { ok: true, pcm: silentPcm, rate: 24000, voice: "Ara", provider: "xAI" };
    });
    await c.speakAsAra("Live Find Clients is off because Google Places is not configured.", {
      source: "BLOCKER",
      dedupeKey: "find:places",
    });
    await c.speakAsAra("Live Find Clients is off because Google Places is not configured.", {
      source: "BLOCKER",
      dedupeKey: "find:places",
    });
    assert.equal(n, 1);
  });

  it("legacy speak() is a no-op so it cannot produce a male browser voice", () => {
    speak("this should never be heard", false);
    assert.equal(typeof speak, "function");
  });

  it("decodeTtsAudio reads raw pcm", () => {
    const pcm = new Int16Array([0, 100, -100, 0]);
    const b64 = Buffer.from(pcm.buffer).toString("base64");
    const out = decodeTtsAudio(b64, 24000);
    assert.equal(out.rate, 24000);
    assert.equal(out.pcm.length, 4);
    assert.equal(out.pcm[1], 100);
  });

  it("owner-desk and the speech controller never call speechSynthesis as Ara", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const owner = readFileSync(join(root, "../../components/owner-desk.tsx"), "utf8");
    const ctrl = readFileSync(join(root, "speech-controller.ts"), "utf8");
    const ara = readFileSync(join(root, "ara-client.ts"), "utf8");
    assert.doesNotMatch(ctrl, /speechSynthesis/);
    assert.doesNotMatch(owner, /speechSynthesis\.speak/);
    assert.match(owner, /speakAsAra|araSpeech/);
    assert.match(ara, /playPcm/);
    assert.doesNotMatch(ara, /SpeechSynthesisUtterance/);
  });
});
