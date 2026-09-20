import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_ASSETS,
  applyVisualCommand,
  DEFAULT_VISUAL_THEME,
  matchVisualAsset,
  nsfwLocked,
  parseVisualCommand,
  summarizeTheme,
  visualCssVars,
  visualFromUnknown,
} from "./theme.ts";

describe("Ara visual theme", () => {
  it("maps relaxing mountain lake to the bundled sunrise lake", () => {
    const asset = matchVisualAsset("put a relaxing mountain lake behind Home");
    assert.equal(asset?.id, "mountain-lake-sunrise");
  });

  it("applies a scene, darkens it, then undoes", () => {
    let theme = DEFAULT_VISUAL_THEME;
    const applied = applyVisualCommand(theme, { op: "background", description: "relaxing mountain lake" });
    theme = applied.theme;
    assert.equal(theme.home.backgroundId, "mountain-lake-sunrise");
    assert.ok((theme.home.overlay || 0) > 0.4);
    assert.equal(theme.home.cardGlass, true);
    assert.equal(theme.home.blur, 0);
    assert.match(applied.spoken, /Mountain Lake Sunrise/);
    assert.match(applied.spoken, /sharp/i);

    const darker = applyVisualCommand(theme, { op: "overlay", delta: 0.1 });
    assert.ok(darker.theme.home.overlay > theme.home.overlay);
    assert.equal(darker.theme.home.blur, 0);
    const undone = applyVisualCommand(darker.theme, { op: "undo" });
    assert.equal(undone.theme.home.overlay, theme.home.overlay);
    assert.equal(undone.theme.home.backgroundId, "mountain-lake-sunrise");
    assert.equal(undone.theme.home.blur, 0);
  });

  it("glass and gold commands change card style and accent", () => {
    let theme = applyVisualCommand(DEFAULT_VISUAL_THEME, { op: "background", scene: "misty forest" }).theme;
    theme = applyVisualCommand(theme, { op: "cards", glass: true }).theme;
    assert.equal(theme.home.cardGlass, true);
    const quiet = applyVisualCommand(theme, { op: "accent", delta: -0.3 });
    assert.ok(quiet.theme.home.accent < theme.home.accent);
    const reset = applyVisualCommand(quiet.theme, { op: "reset" });
    assert.equal(reset.theme.home.backgroundId, null);
    assert.equal(reset.theme.home.accent, 1);
  });

  it("parses natural visual commands and ignores explain phrases", () => {
    assert.equal(parseVisualCommand("Make it darker.")?.op, "overlay");
    assert.equal(parseVisualCommand("Let me see more of the mountains.")?.op, "overlay");
    assert.equal(parseVisualCommand("Make the cards more glassy.")?.op, "cards");
    assert.equal(parseVisualCommand("Less gold.")?.op, "accent");
    assert.equal(parseVisualCommand("Undo that.")?.op, "undo");
    assert.equal(parseVisualCommand("Reset Home.")?.op, "reset");
    assert.equal(parseVisualCommand("Show me the explanation."), null);
    assert.equal(parseVisualCommand("What am I looking at?"), null);
  });

  it("summarizes the live theme in plain English", () => {
    const theme = applyVisualCommand(DEFAULT_VISUAL_THEME, { op: "background", description: "night mountain" }).theme;
    assert.match(summarizeTheme(theme), /Alpine|Mountain/i);
    assert.match(summarizeTheme(theme), /sharp/i);
  });

  it("never stores image blur — readability uses overlay and cards", () => {
    assert.equal(DEFAULT_VISUAL_THEME.home.blur, 0);
    assert.equal(DEFAULT_VISUAL_THEME.adultMode, false);
    const mountain = applyVisualCommand(DEFAULT_VISUAL_THEME, { op: "background", description: "Mountain Lake Sunrise" });
    assert.equal(mountain.theme.home.blur, 0);
    const readable = applyVisualCommand(mountain.theme, parseVisualCommand("Make the interface easier to read.")!);
    assert.equal(readable.theme.home.blur, 0);
    assert.ok(readable.theme.home.overlay > mountain.theme.home.overlay);
    const brighter = applyVisualCommand(mountain.theme, parseVisualCommand("Make the picture brighter.")!);
    assert.equal(brighter.theme.home.blur, 0);
    assert.ok(brighter.theme.home.overlay < mountain.theme.home.overlay);
    const blurAsk = parseVisualCommand("Too blurry. Let me see more.");
    assert.ok(blurAsk);
    assert.notEqual(blurAsk?.op, "background");
    const moreBlur = parseVisualCommand("More blur.");
    assert.equal(moreBlur?.op, "readable");
    const lessBlurry = parseVisualCommand("Less blurry.");
    assert.equal(lessBlurry?.op, "overlay");
    const persisted = visualFromUnknown({ home: { ...mountain.theme.home, blur: 24 } });
    assert.equal(persisted.home.blur, 0);
    const css = visualCssVars(mountain.theme.home);
    assert.equal(css["--la-blur"], undefined);
    assert.equal(css["--la-focus"], "center center");
    assert.match(css["--la-scene-url"] || "", /mountain-lake-sunrise/);

    const desert = applyVisualCommand(DEFAULT_VISUAL_THEME, { op: "background", scene: "desert-sunset" });
    assert.equal(desert.theme.home.backgroundId, "desert-sunset");
    const desertCss = visualCssVars(desert.theme.home);
    assert.match(desertCss["--la-scene-url"] || "", /desert-sunset\.jpg/);
    assert.equal(desertCss["--la-focus"], "center center");
    assert.ok(Number(desertCss["--la-overlay"]) > 0);
  });

  it("Adult Background Mode is off by default and explicit NSFW enables it and applies a sharp adult asset", () => {
    assert.equal(DEFAULT_VISUAL_THEME.adultMode, false);
    assert.equal(matchVisualAsset("nsfw")?.id, undefined);
    const cmd = parseVisualCommand("Ara, use an NSFW background.");
    assert.equal(cmd?.op, "background");
    if (cmd?.op === "background") assert.equal(cmd.nsfw, true);
    const applied = applyVisualCommand(DEFAULT_VISUAL_THEME, cmd!);
    assert.equal(applied.theme.adultMode, true);
    assert.equal(applied.theme.home.nsfw, true);
    assert.equal(applied.theme.home.blur, 0);
    assert.ok(ADULT_ASSETS.some((a) => a.id === applied.theme.home.backgroundId));
    assert.match(applied.spoken, /sharp/i);

    const another = applyVisualCommand(applied.theme, parseVisualCommand("Try another one.")!);
    assert.equal(another.theme.home.nsfw, true);
    assert.notEqual(another.theme.home.backgroundId, applied.theme.home.backgroundId);
    assert.equal(another.theme.home.blur, 0);

    const mountain = applyVisualCommand(another.theme, parseVisualCommand("Go back to the mountain.")!);
    assert.equal(mountain.theme.home.backgroundId, "mountain-lake-sunrise");
    assert.equal(mountain.theme.home.nsfw, false);
    assert.equal(mountain.theme.home.blur, 0);

    const pinup = parseVisualCommand("Give me an adult pin-up style background.");
    assert.equal(pinup?.op, "background");
    const locked = { ...applied.theme, hideAdultUntilUnlock: true };
    assert.equal(nsfwLocked(locked, false), true);
    assert.equal(nsfwLocked(locked, true), false);
    assert.equal(nsfwLocked(DEFAULT_VISUAL_THEME, false), false);
  });

  it("moves focal point and fills the screen without blur", () => {
    const theme = applyVisualCommand(DEFAULT_VISUAL_THEME, { op: "background", description: "mountain lake" }).theme;
    const left = applyVisualCommand(theme, parseVisualCommand("Move the focal point to the left.")!);
    assert.equal(left.theme.home.focus, "left");
    assert.equal(left.theme.home.blur, 0);
    const fill = applyVisualCommand(left.theme, parseVisualCommand("Make the image fill the whole screen.")!);
    assert.equal(fill.theme.home.focus, "center");
  });
});
