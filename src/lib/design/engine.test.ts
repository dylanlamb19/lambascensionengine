import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_HOME_LAYOUT, visibleOrder, type HomeLayout } from "../voice/layout.ts";
import { DEFAULT_VISUAL_THEME } from "../visual/theme.ts";
import {
  applyDesignOps,
  designFromParts,
  emptyHistory,
  isDesignDirectorUtterance,
  isMajorDesign,
  matchDesignComponent,
  parseDesignOp,
  resolveDesign,
  safeSnapshot,
  undoLastByActor,
} from "./engine.ts";
import { designOpBlocked, rejectPrivilegeEscalation } from "./guard.ts";
import { designTools } from "./openai.ts";

describe("Design Director engine", () => {
  it("Make Start My Tasks more prominent uses the shared layout engine", () => {
    const doc = designFromParts(DEFAULT_VISUAL_THEME, DEFAULT_HOME_LAYOUT);
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [{ op: "emphasize_component", component: "hero" }],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    assert.equal(r.doc.layout.emphasis, "hero");
    assert.equal(r.doc.chrome.widgetSize.hero, "l");
    assert.equal(r.results[0].ok, true);
    assert.equal(r.history.past[0].actor, "CHATGPT_DESIGN_DIRECTOR");
  });

  it("Move Sales farther down changes the same Home order Ara uses", () => {
    const shown = {
      ...DEFAULT_HOME_LAYOUT,
      hidden: [] as typeof DEFAULT_HOME_LAYOUT.hidden,
      order: ["greeting", "hero", "sales", "status", "up_next", "needs_you"] as typeof DEFAULT_HOME_LAYOUT.order,
    };
    const doc = designFromParts(DEFAULT_VISUAL_THEME, shown);
    const before = visibleOrder(doc.layout).indexOf("sales");
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [{ op: "move_component", component: "sales", position: "lower" }],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    const after = visibleOrder(r.doc.layout).indexOf("sales");
    assert.ok(after > before);
  });

  it("Undo reverts only the last committed design change", () => {
    let doc = designFromParts();
    let history = emptyHistory(doc);
    const a = applyDesignOps(doc, history, { operations: [{ op: "emphasize_component", component: "up_next" }], actor: "CHATGPT_DESIGN_DIRECTOR" });
    doc = a.doc;
    history = a.history;
    const b = applyDesignOps(doc, history, { operations: [{ op: "move_component", component: "sales", position: "top" }], actor: "CHATGPT_DESIGN_DIRECTOR" });
    const undone = applyDesignOps(b.doc, b.history, { operations: [{ op: "undo_design_change" }], actor: "DYLAN" });
    assert.equal(undone.doc.layout.emphasis, "up_next");
    assert.equal(visibleOrder(undone.doc.layout)[0] === "sales", false);
  });

  it("desktop width override leaves mobile layout alone", () => {
    const doc = designFromParts();
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [{ op: "set_main_width", width: "wide", viewport: "desktop" }],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    const mobile = resolveDesign(r.doc, "mobile");
    const desktop = resolveDesign(r.doc, "desktop");
    assert.equal(mobile.chrome.mainWidth, "default");
    assert.equal(desktop.chrome.mainWidth, "wide");
  });

  it("mobile hide Sales does not hide it on desktop", () => {
    const shown: HomeLayout = { ...DEFAULT_HOME_LAYOUT, hidden: [], order: [...DEFAULT_HOME_LAYOUT.order, "sales"] };
    const doc = designFromParts(DEFAULT_VISUAL_THEME, shown);
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [{ op: "hide_component", component: "sales", viewport: "mobile" }],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    assert.equal(resolveDesign(r.doc, "mobile").layout.hidden.includes("sales"), true);
    assert.equal(resolveDesign(r.doc, "desktop").layout.hidden.includes("sales"), false);
  });

  it("cannot hide Start My Tasks", () => {
    const doc = designFromParts();
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [{ op: "hide_component", component: "hero" }],
    });
    assert.equal(r.results[0].blocked, true);
    assert.ok(visibleOrder(r.doc.layout).includes("hero"));
  });

  it("rejects privilege escalation names", () => {
    assert.match(rejectPrivilegeEscalation("disable_test_mode") || "", /cannot change/i);
    assert.match(rejectPrivilegeEscalation("send_email") || "", /cannot change/i);
    assert.equal(rejectPrivilegeEscalation("apply_design_operations"), null);
  });

  it("does not treat hear-me or business talk as design-director utterances", () => {
    assert.equal(isDesignDirectorUtterance("Ara, can you hear me?"), false);
    assert.equal(isDesignDirectorUtterance("ChatGPT, make this easier to use on my phone."), true);
    assert.equal(isDesignDirectorUtterance("Stop changing the design."), true);
    assert.equal(isDesignDirectorUtterance("Undo what ChatGPT just did."), true);
  });

  it("maps current task and revenue aliases", () => {
    assert.equal(matchDesignComponent("current task"), "up_next");
    assert.equal(matchDesignComponent("Start My Tasks"), "hero");
    assert.equal(matchDesignComponent("Revenue"), "sales");
    assert.equal(parseDesignOp({ op: "resize_component", component: "current_task", size: "l" })?.op, "resize_component");
  });

  it("safe snapshot has no secrets or prospect records", () => {
    const snap = safeSnapshot(designFromParts(), "mobile");
    const blob = JSON.stringify(snap);
    assert.equal(blob.includes("password"), false);
    assert.equal(blob.includes("api_key"), false);
    assert.equal(snap.screen, "HOME");
    assert.ok(snap.components.some((c) => c.id === "hero"));
  });

  it("major redesigns are flagged for preview", () => {
    assert.equal(isMajorDesign([{ op: "emphasize_component", component: "hero" }]), false);
    assert.equal(isMajorDesign([{ op: "apply_layout", order: ["hero"] }]), true);
  });

  it("glass and quieter gold go through the existing visual engine", () => {
    const doc = designFromParts();
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [
        { op: "set_card_style", glass: true, opacity: 0.75 },
        { op: "set_accent_color", delta: -0.28 },
      ],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    assert.equal(r.doc.visual.home.cardGlass, true);
    assert.ok(r.doc.visual.home.accent < 1);
  });

  it("restore baseline puts the session start back", () => {
    const start = designFromParts();
    const history = emptyHistory(start);
    const changed = applyDesignOps(start, history, {
      operations: [{ op: "set_ara_scale", scale: 0.8 }],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    const restored = applyDesignOps(changed.doc, changed.history, {
      operations: [{ op: "restore_baseline" }],
      actor: "DYLAN",
    });
    assert.equal(restored.doc.chrome.araScale, 1);
  });

  it("designOpBlocked is silent for normal visual ops", () => {
    assert.equal(designOpBlocked({ op: "set_card_style", glass: true }), null);
  });

  it("request viewport fills in ops that omitted it", () => {
    const shown: HomeLayout = { ...DEFAULT_HOME_LAYOUT, hidden: [], order: [...DEFAULT_HOME_LAYOUT.order, "sales"] };
    const doc = designFromParts(DEFAULT_VISUAL_THEME, shown);
    const r = applyDesignOps(doc, emptyHistory(doc), {
      operations: [{ op: "hide_component", component: "sales" }],
      viewport: "mobile",
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    assert.equal(resolveDesign(r.doc, "mobile").layout.hidden.includes("sales"), true);
    assert.equal(resolveDesign(r.doc, "desktop").layout.hidden.includes("sales"), false);
  });

  it("undoLastByActor finds ChatGPT’s last change", () => {
    const start = designFromParts();
    const a = applyDesignOps(start, emptyHistory(start), {
      operations: [{ op: "set_ara_scale", scale: 0.8 }],
      actor: "CHATGPT_DESIGN_DIRECTOR",
    });
    const undone = undoLastByActor(a.doc, a.history, "CHATGPT_DESIGN_DIRECTOR");
    assert.equal(undone.doc.chrome.araScale, 1);
  });

  it("uses the official OpenAI Responses function-tool shape, not Chat Completions nested functions", () => {
    const tools = designTools();
    assert.ok(tools.length >= 4);
    for (const t of tools) {
      assert.equal(t.type, "function");
      assert.equal("name" in t, true);
      assert.equal("function" in t, false);
    }
    assert.ok(tools.some((t) => t.name === "get_current_design"));
    assert.ok(tools.some((t) => t.name === "apply_design_operations"));
    assert.ok(tools.some((t) => t.name === "undo_last_design_change"));
    assert.ok(tools.some((t) => t.name === "restore_session_baseline"));
  });
});
