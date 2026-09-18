import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseImageCommand } from "./gallery.ts";
import { parseVisualCommand, applyVisualCommand, DEFAULT_VISUAL_THEME } from "./theme.ts";
import { evaluateImageSafety, asIntendedUse } from "./safety.ts";
import { asAspectRatio, asQuality, composeModelPrompt, IMAGINE_ENDPOINT, IMAGINE_QUALITY_MODEL, jpegSize, modelForQuality, promptHash } from "./provider.ts";
import { executeAllowlistedTool } from "../voice/tools.ts";
import { spokenToAction, applyDeskAction, emptyDesk } from "../voice/desk-actions.ts";
import { buildAraInstructions } from "../voice/ara-context.ts";
import { FLAGS } from "../flags.ts";

const desk = {
  view: "home" as const,
  openUid: null,
  companyName: null,
  pipelineStage: null,
  taskTitle: null,
  tasks: [],
  prospects: [],
  gmail: "missing" as const,
  calendar: "missing" as const,
  testMode: true,
  allowlist: [],
  availableActions: [],
  confirmationOpen: false,
  evidenceOpen: false,
};

describe("true AI generation vs background presets", () => {
  it("spoken generate is an IMAGE command, not a bundled preset", () => {
    const cmd = parseImageCommand("Ara, generate a photorealistic glass cabin beside a mountain lake under the northern lights.");
    assert.equal(cmd?.op, "generate");
    if (cmd?.op === "generate") {
      assert.match(cmd.prompt, /glass cabin/i);
      assert.equal(cmd.asBackground, false);
    }
    assert.equal(parseVisualCommand("Ara, generate a photorealistic glass cabin beside a mountain lake under the northern lights."), null);
    const mapped = spokenToAction("Generate a new background for Home. I want a giant mountain overlooking a futuristic city at night.", emptyDesk(), { prospects: [], tasks: [] });
    assert.ok("action" in mapped);
    if ("action" in mapped) {
      assert.equal(mapped.action.name, "IMAGE");
      assert.equal(mapped.action.image?.op, "generate");
      if (mapped.action.image?.op === "generate") assert.equal(mapped.action.image.asBackground, true);
    }
  });

  it("make another version with extra detail is a new generation, not a crop", () => {
    const cmd = parseImageCommand("Generate another version with more stars.");
    assert.equal(cmd?.op, "again");
    if (cmd?.op === "again") assert.match(cmd.extra || "", /more stars/i);
    const wider = parseImageCommand("Make it wider for my background.");
    assert.equal(wider?.op, "again");
    if (wider?.op === "again") assert.equal(wider.aspectRatio, "21:9");
  });

  it("preset selection stays a preset and is labeled that way", () => {
    const cmd = parseVisualCommand("Put Desert Sunset behind Home.");
    assert.equal(cmd?.op, "background");
    const applied = applyVisualCommand(DEFAULT_VISUAL_THEME, { op: "background", scene: "desert-sunset" });
    assert.equal(applied.theme.home.backgroundId, "desert-sunset");
    assert.equal(applied.theme.home.source, "bundled");
    assert.match(applied.spoken, /Preset selected/i);
    assert.doesNotMatch(applied.spoken, /AI generated/i);
  });

  it("generate_background tool is an image generation plan, not set_page_background", () => {
    const r = executeAllowlistedTool("generate_background", { prompt: "cyberpunk city at night" }, desk);
    if (!FLAGS.AI_IMAGE_GENERATION) {
      assert.equal(r.rejected, true);
      assert.match(String(r.output.reason), /paused/i);
    } else {
      assert.equal(r.rejected, false);
      assert.equal(r.plan.type, "image");
      if (r.plan.type === "image" && r.plan.cmd.op === "generate") {
        assert.equal(r.plan.cmd.asBackground, true);
        assert.equal(r.plan.cmd.kind, "background");
        assert.match(r.plan.cmd.prompt, /cyberpunk/i);
      }
    }
    const preset = executeAllowlistedTool("set_page_background", { scene: "mountain-lake-sunrise" }, desk);
    assert.equal(preset.plan.type, "visual");
  });

  it("public/ad uses refuse NSFW", () => {
    const blocked = evaluateImageSafety({ intendedUse: "ad", nsfw: true });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.reason, /brand-safe/i);
    const ok = evaluateImageSafety({ intendedUse: "home", nsfw: true });
    assert.equal(ok.ok, true);
    assert.equal(asIntendedUse("facebook ad"), "ad");
  });

  it("provider maps quality and aspect without using bundled assets", () => {
    assert.equal(asAspectRatio("16:9"), "16:9");
    assert.equal(asQuality("fast"), "low");
    assert.equal(modelForQuality("high"), IMAGINE_QUALITY_MODEL);
    assert.match(IMAGINE_ENDPOINT, /api\.x\.ai\/v1\/images\/generations/);
    const wrapped = composeModelPrompt({ prompt: "japanese garden at night", kind: "background" });
    assert.match(wrapped, /japanese garden/i);
    assert.notEqual(promptHash(["a"]), promptHash(["b"]));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x00, 0x07, 0x80, 0x00]);
    const size = jpegSize(jpeg);
    assert.equal(size?.height, 1024);
    assert.equal(size?.width, 1920);
  });

  it("client generate files never contain the API key and never fall back to a preset", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const deskSrc = readFileSync(join(root, "../../components/owner-desk.tsx"), "utf8");
    assert.doesNotMatch(deskSrc, /XAI_API_KEY/);
    assert.doesNotMatch(deskSrc, /I used a bundled sharp background instead/);
    assert.match(deskSrc, /data-scenery-view/);
    const gen = readFileSync(join(root, "generate.ts"), "utf8");
    assert.doesNotMatch(gen, /XAI_API_KEY/);
    assert.match(gen, /generateImage\(/);
    const provider = readFileSync(join(root, "provider.ts"), "utf8");
    assert.match(provider, /process\.env\.XAI_API_KEY/);
  });

  it("Ara instructions distinguish presets from AI generation", () => {
    const text = buildAraInstructions(desk);
    assert.match(text, /Background Preset/i);
    assert.match(text, /Never call a preset/);
    assert.match(text, /AI image generation is paused/);
  });

  it("desk IMAGE generate does not apply a preset as a side effect", () => {
    const start = emptyDesk();
    const r = applyDeskAction(start, {
      name: "IMAGE",
      image: { op: "generate", prompt: "northern lights cabin", n: 1, kind: "background", asBackground: true },
    }, { prospects: [], tasks: [] });
    assert.equal(r.effect.type, "image_generate");
    if (r.effect.type === "image_generate") {
      assert.equal(r.effect.prompt, "northern lights cabin");
      assert.equal(r.effect.asBackground, true);
    }
    assert.equal(r.state.visual.home.backgroundId, start.visual.home.backgroundId);
    assert.equal(r.state.gallery.busy, true);
    assert.equal(r.state.gallery.status, "creating");
  });
});
