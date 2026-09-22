import assert from "node:assert/strict";
import test from "node:test";
import { GROK_BOT_HANDOFF_NOTE, toJsonBag } from "./types.ts";

test("toJsonBag keeps JSON and drops functions", () => {
  const bag = toJsonBag({
    focus: "NEEDS_CONTACT_INFORMATION",
    do_not_invent_email: true,
    verticals: ["Dental", "Law / personal injury"],
    nested: { nope: true },
    n: 3,
    fn: () => "no",
  });
  assert.equal(bag.focus, "NEEDS_CONTACT_INFORMATION");
  assert.equal(bag.do_not_invent_email, true);
  assert.deepEqual(bag.verticals, ["Dental", "Law / personal injury"]);
  assert.equal(bag.n, 3);
  assert.deepEqual(bag.nested, { nope: true });
  assert.equal("fn" in bag, false);
});

test("Grok Bot handoff forbids invented email and Gmail send", () => {
  assert.match(GROK_BOT_HANDOFF_NOTE, /Do not invent emails/);
  assert.match(GROK_BOT_HANDOFF_NOTE, /Do not send Gmail/);
  assert.match(GROK_BOT_HANDOFF_NOTE, /mode=complete/);
});
