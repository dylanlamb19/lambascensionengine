import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clickAllowed, controlRisk, pointerAllowed, selectorRejected } from "./guard.ts";
import { executeAllowlistedTool, type AraDeskContext } from "../voice/tools.ts";

const desk: AraDeskContext = {
  view: "home",
  openUid: "uid-fire",
  companyName: "Firefighter Roofing",
  pipelineStage: "New",
  taskTitle: null,
  tasks: [],
  prospects: [{ uid: "uid-fire", name: "Firefighter Roofing", stage: "New" }],
  gmail: "connected",
  calendar: "connected",
  testMode: true,
  allowlist: [],
  availableActions: [],
  confirmationOpen: false,
  evidenceOpen: false,
  screenActions: [
    { id: "REVIEW", label: "Review", aliases: ["review", "press review"], risk: "LOW", tool: "review_current_task" },
    { id: "START", label: "Start My Tasks", aliases: ["start my tasks"], risk: "LOW", tool: "start_my_tasks" },
  ],
  taskUid: "uid-fire",
};

describe("Ara computer guard", () => {
  it("blocks high-risk send/schedule/test-mode clicks", () => {
    assert.equal(controlRisk("Approve & send"), "HIGH");
    assert.equal(controlRisk("Approve sequence"), "HIGH");
    assert.equal(controlRisk("Disable Test Mode"), "HIGH");
    const blocked = clickAllowed("Approve & send", "ara");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.reason, /Confirm send/i);
    assert.equal(clickAllowed("Review", "ara").ok, true);
    assert.equal(clickAllowed("Stop", "ara").ok, false);
    assert.equal(clickAllowed("Voice off", "ara").ok, false);
  });

  it("does not need a separate Take Control mode — Dylan already has the mouse", () => {
    assert.equal(clickAllowed("Review", "stopped").ok, true);
    assert.equal(clickAllowed("Review", "human").ok, true);
    assert.equal(pointerAllowed("ara").ok, true);
    assert.equal(pointerAllowed("human").ok, true);
  });

  it("rejects raw CSS/DOM selectors", () => {
    assert.equal(selectorRejected({ selector: "#send" }), true);
    assert.equal(selectorRejected({ name: "Review" }), false);
    const r = executeAllowlistedTool("computer_click", { selector: "button.send" }, desk);
    assert.equal(r.rejected, true);
    const ok = executeAllowlistedTool("computer_click", { name: "Review" }, desk);
    assert.equal(ok.rejected, false);
    assert.equal(ok.plan.type, "review_current");
    if (ok.plan.type === "review_current") {
      assert.equal(ok.plan.uid, "uid-fire");
    }
    const send = executeAllowlistedTool("computer_click", { name: "Approve & send" }, desk);
    assert.equal(send.ok, false);
    assert.equal(send.plan.type, "none");
  });

  it("generic click tools stay forbidden", () => {
    const r = executeAllowlistedTool("click", { name: "Review" }, desk);
    assert.equal(r.rejected, true);
    const el = executeAllowlistedTool("click_element", { selector: "#x" }, desk);
    assert.equal(el.rejected, true);
  });

  it("prefers structured tools over visual clicks", () => {
    const structured = executeAllowlistedTool("start_my_tasks", {}, desk);
    assert.equal(structured.plan.type, "start_tasks");
    const visual = executeAllowlistedTool("computer_click", { name: "Start My Tasks" }, desk);
    assert.equal(visual.plan.type, "start_tasks");
  });
});
