import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLayoutCommand,
  DEFAULT_HOME_LAYOUT,
  parseLayoutCommand,
  visibleOrder,
} from "./layout.ts";
import { applyDeskAction, emptyDesk, spokenToAction, type DeskWorld } from "./desk-actions.ts";
import { executeAllowlistedTool, type AraDeskContext } from "./tools.ts";
import { clickAllowed, selectorRejected } from "../ara-computer/guard.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const world: DeskWorld = {
  prospects: [{ uid: "uid-fire", name: "Firefighter Roofing", score: 88, stage_plain: "New" }],
  tasks: [{ title: "Firefighter Roofing", plain: "Website research didn’t finish.", uid: "uid-fire", id: "fail-uid-fire", retry: true }],
};

const desk: AraDeskContext = {
  view: "home",
  openUid: null,
  companyName: null,
  taskTitle: null,
  tasks: world.tasks,
  prospects: [{ uid: "uid-fire", name: "Firefighter Roofing", stage: "New" }],
  gmail: "connected",
  calendar: "connected",
  testMode: true,
  allowlist: [],
  availableActions: ["start_my_tasks", "navigate_pipeline"],
  confirmationOpen: false,
  evidenceOpen: false,
  pipelineStage: null,
  screen: "HOME",
  lookingAt: "You’re looking at Home.",
  screenActions: [
    { id: "START_TASKS", label: "Start My Tasks", aliases: ["start my tasks"], risk: "LOW", tool: "start_my_tasks" },
    { id: "REVIEW", label: "Review", aliases: ["review", "press review"], risk: "LOW", tool: "review_current_task" },
  ],
  taskUid: "uid-fire",
};

describe("shared-screen Home layout", () => {
  it("moves Start My Tasks to the top of the real Home layout", () => {
    const cmd = parseLayoutCommand("Move Start My Tasks above everything else.");
    assert.ok(cmd);
    assert.equal(cmd?.kind, "move");
    const next = applyLayoutCommand(DEFAULT_HOME_LAYOUT, cmd!);
    assert.equal(visibleOrder(next.layout)[0], "hero");
    assert.match(next.spoken, /Start My Tasks/i);
  });

  it("hides Sales on the real Home, not a copy", () => {
    const cmd = parseLayoutCommand("Hide Sales.");
    assert.equal(cmd?.kind, "hide");
    const next = applyLayoutCommand(DEFAULT_HOME_LAYOUT, cmd!);
    assert.ok(next.layout.hidden.includes("sales"));
    assert.equal(visibleOrder(next.layout).includes("sales"), false);
  });

  it("make Home cleaner keeps the greeting and Start My Tasks", () => {
    const cmd = parseLayoutCommand("Make Home cleaner.");
    assert.equal(cmd?.kind, "clean");
    const next = applyLayoutCommand(DEFAULT_HOME_LAYOUT, cmd!);
    assert.deepEqual(visibleOrder(next.layout).slice(0, 2), ["greeting", "hero"]);
    assert.ok(next.layout.hidden.includes("sales"));
  });

  it("spoken layout commands change DeskState layout", () => {
    const decided = spokenToAction("Move Start My Tasks to the top.", emptyDesk(), world);
    assert.ok("action" in decided);
    if (!("action" in decided)) return;
    assert.equal(decided.action.name, "LAYOUT");
    const r = applyDeskAction(emptyDesk(), decided.action, world);
    assert.equal(visibleOrder(r.state.layout)[0], "hero");
  });

  it("Move Sales farther down uses the shared layout engine, not a second copy", () => {
    const start = emptyDesk();
    start.layout = { ...DEFAULT_HOME_LAYOUT, hidden: [], order: ["greeting", "hero", "sales", "status", "up_next", "needs_you"] };
    const decided = spokenToAction("Move Sales farther down.", start, world);
    assert.ok("action" in decided);
    if (!("action" in decided)) return;
    assert.equal(decided.action.layoutPlace, "lower");
    const r = applyDeskAction(start, decided.action, world);
    assert.ok(visibleOrder(r.state.layout).indexOf("sales") > visibleOrder(start.layout).indexOf("sales"));
  });
});

describe("Ara operates the same screen Dylan sees", () => {
  it("Owner Mode source does not mount Ara Workspace", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const deskSrc = readFileSync(join(here, "../../components/owner-desk.tsx"), "utf8");
    assert.equal(/AraWorkspace/.test(deskSrc), false);
    assert.equal(/data-ara-workspace/.test(deskSrc), false);
    assert.equal(/Take Control/.test(deskSrc), false);
    assert.equal(/computerStartFn/.test(deskSrc), false);
  });

  it("compact Ara bar has a persistent caption, not a giant default transcript", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const bar = readFileSync(join(here, "../../components/voice-bar.tsx"), "utf8");
    assert.match(bar, /data-ara-caption/);
    assert.match(bar, /la-ara-reply/);
    assert.match(bar, /Hold to speak/);
    assert.match(bar, /Conversation/);
    assert.equal(/IDLE_COLLAPSE_MS/.test(bar), false);
    assert.equal(/Ara voice is temporarily unavailable/.test(bar), false);
  });

  it("phone Ara bar wraps and keeps tap targets — no transform scale", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../../styles.css"), "utf8");
    assert.match(css, /\.la-ara-ask/);
    assert.match(css, /max-width: 719px/);
    assert.match(css, /data-ara-compact="1"[\s\S]*flex-wrap:\s*wrap/);
    assert.doesNotMatch(css, /transform:\s*scale\(var\(--la-ara-scale/);
  });

  it("computer_click Review uses the shared Review action, not a second browser", () => {
    const r = executeAllowlistedTool("computer_click", { name: "Review" }, { ...desk, view: "home", screen: "TASKS", taskUid: "uid-fire" });
    assert.equal(r.rejected, false);
    assert.equal(r.plan.type, "review_current");
    if (r.plan.type === "review_current") assert.equal(r.plan.uid, "uid-fire");
  });

  it("computer_click cannot send email by pressing Approve & send", () => {
    const r = executeAllowlistedTool("computer_click", { name: "Approve & send" }, desk);
    assert.equal(r.ok, false);
    assert.equal(r.plan.type, "none");
    assert.match(String(r.output.reason), /Confirm send/i);
    assert.equal(clickAllowed("Approve & send", "ara").ok, false);
  });

  it("raw CSS selectors are still rejected", () => {
    assert.equal(selectorRejected({ selector: "#send" }), true);
    const r = executeAllowlistedTool("computer_click", { selector: "button.send" }, desk);
    assert.equal(r.rejected, true);
  });

  it("Dylan mouse navigation and Ara tools share one view", () => {
    let state = emptyDesk();
    state = applyDeskAction(state, { name: "NAVIGATE_PIPELINE" }, world).state;
    assert.equal(state.view, "pipe");
    state = applyDeskAction(state, { name: "OPEN_PROSPECT", uid: "uid-fire" }, world).state;
    assert.equal(state.view, "detail");
    assert.equal(state.openUid, "uid-fire");
    state = applyDeskAction(state, { name: "NAVIGATE_HOME" }, world).state;
    assert.equal(state.view, "home");
    const explain = executeAllowlistedTool("explain_current_screen", {}, {
      ...desk,
      view: "home",
      screen: "HOME",
      lookingAt: "You’re looking at Home.",
      openUid: null,
    });
    assert.match(String(explain.output.lookingAt || explain.output.spoken), /Home/i);
  });

  it("computer_inspect describes this screen, not a remote computer", () => {
    const r = executeAllowlistedTool("computer_inspect", {}, desk);
    assert.equal(r.ok, true);
    assert.equal(r.output.sharedScreen, true);
    assert.match(String(r.output.lookingAt), /Home/i);
  });

  it("Ara design tools use the same DesignOp engine as ChatGPT Design Director", () => {
    const snap = executeAllowlistedTool("get_current_design", {}, desk);
    assert.equal(snap.ok, true);
    assert.equal(snap.plan.type, "none");
    const r = executeAllowlistedTool("apply_design_operations", {
      operations: [{ op: "emphasize_component", component: "hero" }],
    }, desk);
    assert.equal(r.ok, true);
    assert.equal(r.plan.type, "design");
    if (r.plan.type === "design") {
      assert.equal(r.plan.operations[0]?.op, "emphasize_component");
    }
  });

  it("Owner Mode keeps Design Director code but does not mount it on recovery", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const deskSrc = readFileSync(join(here, "../../components/owner-desk.tsx"), "utf8");
    const flags = readFileSync(join(here, "../flags.ts"), "utf8");
    assert.match(deskSrc, /DesignDirectorBar/);
    assert.match(deskSrc, /FLAGS\.DESIGN_DIRECTOR/);
    assert.match(flags, /DESIGN_DIRECTOR:\s*false/);
    assert.match(flags, /AI_IMAGE_GENERATION:\s*false/);
    assert.match(flags, /EXPERIMENTAL_VOICE_FEATURES:\s*false/);
    assert.equal(/Get Paid/.test(deskSrc), false);
  });
});
