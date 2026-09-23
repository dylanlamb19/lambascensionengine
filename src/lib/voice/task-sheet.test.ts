import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DESK_REPLY_HOLD_MS,
  TASK_SHEET_DISMISS_GUARD_MS,
  mergeAraCaption,
  shouldCloseTaskSheet,
} from "./task-sheet.ts";

describe("Start My Tasks sheet on a phone", () => {
  it("ignores the opening tap on the backdrop, then allows a later dismiss", () => {
    const opened = 1_000;
    assert.equal(shouldCloseTaskSheet(opened, opened + 20, true), false);
    assert.equal(shouldCloseTaskSheet(opened, opened + TASK_SHEET_DISMISS_GUARD_MS - 1, true), false);
    assert.equal(shouldCloseTaskSheet(opened, opened + TASK_SHEET_DISMISS_GUARD_MS, true), true);
    assert.equal(shouldCloseTaskSheet(opened, opened + 2_000, false), false);
  });

  it("keeps the task sentence when a cancelled voice turn sends an empty or short flash", () => {
    const desk = "Firefighter Roofing needs a contact. Website research didn’t finish.";
    const spokenAt = 5_000;
    assert.equal(
      mergeAraCaption(desk, "", { isFinal: true, deskSpokenAt: spokenAt, now: spokenAt + 40 }),
      desk,
    );
    assert.equal(
      mergeAraCaption(desk, "Okay", { isFinal: false, deskSpokenAt: spokenAt, now: spokenAt + 80 }),
      desk,
    );
    assert.equal(
      mergeAraCaption(desk, "Got it.", { isFinal: true, deskSpokenAt: spokenAt, now: spokenAt + 100 }),
      desk,
    );
    const full = "Firefighter Roofing needs a contact. Website research didn’t finish. I opened that task for you.";
    assert.equal(
      mergeAraCaption(desk, full, { isFinal: true, deskSpokenAt: spokenAt, now: spokenAt + 200 }),
      full,
    );
    assert.equal(
      mergeAraCaption(desk, "", { isFinal: true, deskSpokenAt: spokenAt, now: spokenAt + DESK_REPLY_HOLD_MS + 5 }),
      "",
    );
  });

  it("the task sheet beats the shell stacking rule without pinning the tall header", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../../styles.css"), "utf8");
    const shellAt = css.indexOf(".la-shell > *:not(.la-scene)");
    const sheetAt = css.indexOf(".la-shell > .la-sheet-backdrop");
    assert.ok(shellAt >= 0 && sheetAt > shellAt);
    assert.match(css, /\.la-shell > \.la-sheet-backdrop \{[^}]*position:\s*fixed/);
    assert.equal(css.includes(".la-shell > .la-top"), false);
    assert.match(css, /data-sheet-armed="0"/);
    const desk = readFileSync(join(here, "../../components/owner-desk.tsx"), "utf8");
    assert.match(desk, /data-start-tasks="1"/);
    assert.match(desk, /data-task-sheet="1"/);
    assert.match(desk, /data-task-run=/);
    assert.match(desk, /araSpeech\(\)\.unlock\(\)/);
  });
});
