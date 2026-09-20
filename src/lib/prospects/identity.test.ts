import assert from "node:assert/strict";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import { applyByUid, findByUid, patchByUid } from "./identity.ts";

function p(uid: string, id: number, name: string, extra: Partial<Prospect> = {}): Prospect {
  return {
    id, uid, name, vertical: "Roofing", city: "Dallas", website: "", review_count: 0,
    google_rating: "UNKNOWN", phone: "UNKNOWN", job_value_est: 0, score: 50,
    fit: "possible", fit_plain: "Possible", stage: "New", stage_plain: "Just added",
    research_status: "none", findings: [], ...extra,
  };
}

test("two devices can mint the same numeric id; actions still hit only the matching uid", () => {
  const a = p("device-a-uuid", 7, "Dallas Roof Co");
  const b = p("device-b-uuid", 7, "Fort Worth HVAC");
  const rows = [a, b];
  assert.equal(findByUid(rows, "device-a-uuid")?.name, "Dallas Roof Co");
  assert.equal(findByUid(rows, "device-b-uuid")?.name, "Fort Worth HVAC");

  const approved = applyByUid(rows, "device-a-uuid", (c) => ({ ...c, stage: "Approved for Outreach", suppressed: false }));
  assert.equal(findByUid(approved, "device-a-uuid")?.stage, "Approved for Outreach");
  assert.equal(findByUid(approved, "device-b-uuid")?.stage, "New");
  assert.equal(findByUid(approved, "device-b-uuid")?.name, "Fort Worth HVAC");

  const skipped = applyByUid(approved, "device-b-uuid", (c) => ({ ...c, stage: "Do Not Contact", suppressed: true }));
  assert.equal(findByUid(skipped, "device-a-uuid")?.stage, "Approved for Outreach");
  assert.equal(findByUid(skipped, "device-a-uuid")?.suppressed, false);
  assert.equal(findByUid(skipped, "device-b-uuid")?.stage, "Do Not Contact");
  assert.equal(findByUid(skipped, "device-b-uuid")?.suppressed, true);

  const patched = patchByUid(skipped, { ...a, stage: "Contacted" });
  assert.equal(findByUid(patched, "device-a-uuid")?.stage, "Contacted");
  assert.equal(findByUid(patched, "device-b-uuid")?.id, 7);
  assert.equal(findByUid(patched, "device-b-uuid")?.name, "Fort Worth HVAC");
});
