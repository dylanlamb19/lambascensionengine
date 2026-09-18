import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { AraAudioPipeline, ARA_PCM_RATE, ARA_WAV_RATE, pcm16Resample, pcm16ToWav, resamplePcm } from "./audio-out.ts";

describe("Ara audio pipeline", () => {
  it("keeps a single active response and drops stale/duplicate chunks", () => {
    const p = new AraAudioPipeline();
    p.begin("response_1042");
    assert.equal(p.activeResponseId, "response_1042");
    const pcm = new Int16Array(8);
    assert.equal(p.enqueue("response_1042", pcm, 0), "ok");
    assert.equal(p.enqueue("response_1042", pcm, 1), "ok");
    assert.equal(p.enqueue("response_1042", pcm, 1), "dup");
    assert.equal(p.enqueue("response_99", pcm, 2), "stale");
    assert.equal(p.enqueue("response_1042", pcm, 2), "ok");
    p.begin("response_1043");
    assert.equal(p.activeResponseId, "response_1043");
    assert.equal(p.enqueue("response_1042", pcm, 3), "stale");
    assert.equal(p.enqueue("response_1043", pcm, 0), "ok");
    p.stop();
    assert.equal(p.enqueue("response_1043", pcm, 1), "no_active");
  });

  it("TEST 6 — cancelled generation never resumes old chunks", () => {
    const p = new AraAudioPipeline();
    p.begin("response_a");
    const gen = p.playbackGeneration;
    const pcm = new Int16Array(8);
    assert.equal(p.enqueue("response_a", pcm, 0), "ok");
    p.stop();
    assert.ok(p.playbackGeneration > gen);
    assert.equal(p.enqueue("response_a", pcm, 1), "no_active");
    p.begin("response_b");
    assert.equal(p.enqueue("response_a", pcm, 2), "stale");
    assert.equal(p.enqueue("response_b", pcm, 0), "ok");
  });

  it("resamples 24 kHz PCM up to a 48 kHz Bluetooth/phone mixer", () => {
    const pcm = new Int16Array(24);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i * 1000;
    const out = resamplePcm(pcm, ARA_PCM_RATE, 48000);
    assert.equal(out.length, 48);
    assert.ok(Math.abs(out[0] - pcm[0] / 32768) < 1e-6);
    assert.ok(out.every((s) => s >= -1 && s <= 1));
  });

  it("resamples 24 kHz PCM to 44.1 kHz phone WAV", () => {
    const pcm = new Int16Array(240);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 1000;
    const out = pcm16Resample(pcm, ARA_PCM_RATE, ARA_WAV_RATE);
    assert.equal(out.length, Math.round(240 * (ARA_WAV_RATE / ARA_PCM_RATE)));
    assert.ok(out.every((s) => s >= -32768 && s <= 32767));
  });

  it("plays WAV through the phone media mixer instead of Web Audio Bluetooth", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "audio-out.ts"), "utf8");
    assert.match(src, /unlockAraOutput/);
    assert.match(src, /pcm16ToWav/);
    assert.match(src, /audio\/wav/);
    assert.match(src, /phoneMicConstraints/);
    assert.match(src, /ARA_WAV_RATE = 44100/);
    assert.match(src, /replayAraOutput/);
    assert.match(src, /la-ara-voice-out/);
    assert.match(src, /startHold/);
    assert.match(src, /onHostEnded/);
    assert.doesNotMatch(src, /new AudioContext\(\{\s*sampleRate:\s*24000/);
    assert.doesNotMatch(src, /const el = new Audio\(\)/);
  });

  it("pcm16ToWav writes a real RIFF WAVE blob", async () => {
    const wav = pcm16ToWav(new Int16Array([0, 32767, -32768]), ARA_PCM_RATE);
    assert.equal(wav.type, "audio/wav");
    const bytes = new Uint8Array(await wav.arrayBuffer());
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "RIFF");
    assert.equal(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]), "WAVE");
  });
});
