import assert from "node:assert/strict";
import test from "node:test";
import { SEED } from "../seed-prospects.ts";
import {
  contactFields,
  listingPhone,
  namedPeople,
  prospectActions,
  reachKind,
  taskForProspect,
  verifiedWebsite,
  whySurfaced,
} from "./reach.ts";

function byName(name: string) {
  const p = SEED.find((c) => c.name === name);
  assert.ok(p, name);
  return p;
}

test("Firefighter Roofing is not a dead end after website research fails", () => {
  const p = byName("Firefighter Roofing");
  assert.equal(p.research_status, "blocked");
  assert.equal(reachKind(p), "NEEDS_CONTACT_INFO");
  assert.ok(verifiedWebsite(p));
  assert.equal(listingPhone(p)?.value, "(817) 479-8999");
  const ids = prospectActions(p).map((a) => a.id);
  assert.ok(ids.includes("learn_more"));
  assert.ok(ids.includes("open_website"));
  assert.ok(ids.includes("call"));
  assert.ok(ids.includes("find_contact"));
  assert.ok(ids.includes("try_research"));
  assert.ok(ids.includes("draft_outreach"));
  assert.ok(ids.includes("skip"));
  const task = taskForProspect(p);
  assert.match(task.title, /needs a contact/i);
  assert.match(whySurfaced(p), /blocked|didn’t finish/i);
});

test("prospect with website + no phone still gets Open Website and Find Contact", () => {
  const p = byName("Align Foundation Repair");
  assert.ok(verifiedWebsite(p));
  assert.equal(listingPhone(p), null);
  const ids = prospectActions(p).map((a) => a.id);
  assert.ok(ids.includes("learn_more"));
  assert.ok(ids.includes("open_website"));
  assert.ok(ids.includes("find_contact"));
  assert.equal(ids.includes("call"), false);
});

test("Do Not Contact is blocked and does not offer Call/Find Contact", () => {
  const p = { ...byName("Firefighter Roofing"), stage: "Do Not Contact", suppressed: true };
  assert.equal(reachKind(p), "BLOCKED");
  assert.deepEqual(prospectActions(p).map((a) => a.id), ["learn_more"]);
});

test("named person + verified email is ready to contact", () => {
  const p = {
    ...byName("Firefighter Roofing"),
    research_status: "complete",
    contacts: [{
      name: "John Smith",
      title: "Owner",
      email: "john@example.com",
      email_status: "verified" as const,
      profile_url: "",
      source: "contact page",
      last_verified: "2026-09-18",
    }],
  };
  assert.equal(reachKind(p), "READY_TO_CONTACT");
  const ids = prospectActions(p, { gmailConnected: true }).map((a) => a.id);
  assert.ok(ids.includes("draft_email"));
  assert.ok(ids.includes("call"));
  const email = contactFields(p).find((f) => f.label === "Direct email" || f.label === "Business email");
  assert.equal(email?.status, "VERIFIED");
  assert.equal(namedPeople(p)[0]?.name, "John Smith");
});

test("contact fields never invent an email", () => {
  const p = byName("Firefighter Roofing");
  const email = contactFields(p).find((f) => /email/i.test(f.label));
  assert.equal(email?.value, "UNKNOWN");
  assert.equal(email?.status, "UNKNOWN");
});

test("failed website research still lists Open Website when a URL is on file", () => {
  const p = byName("SOS Foundation Repair");
  assert.equal(p.research_status, "failed");
  const ids = prospectActions(p).map((a) => a.id);
  assert.ok(ids.includes("try_research"));
  assert.ok(ids.includes("open_website"));
  assert.ok(ids.includes("find_contact"));
  assert.ok(ids.includes("learn_more"));
  assert.ok(ids.includes("call"));
});
