import assert from "node:assert/strict";
import test from "node:test";
import { SEED } from "../seed-prospects.ts";
import { contactFields, reachKind, usefulEmail } from "./reach.ts";
import {
  applyProspectInfoChanges,
  formatReadback,
  isProspectEditSpeech,
  isProspectReadbackSpeech,
  parseProspectEditSpeech,
  pickKnownChanges,
  provenanceLabel,
  sanitizeChanges,
  spokenAfterSave,
  validateEmail,
  validateHttpUrl,
} from "./owner-edit.ts";

function firefighter() {
  const p = SEED.find((c) => c.name === "Firefighter Roofing");
  assert.ok(p);
  return { ...p, contacts: [], history: [], findings: [...(p.findings || [])] };
}

test("acceptance 1 — Ara add owner name on current prospect", () => {
  const parsed = parseProspectEditSpeech("The owner is John Smith.");
  assert.equal(parsed.kind, "fields");
  if (parsed.kind !== "fields") return;
  const raw = firefighter();
  const { prospect, audits } = applyProspectInfoChanges(raw, parsed.changes);
  assert.equal(prospect.contacts?.[0]?.name, "John Smith");
  assert.equal(prospect.contacts?.[0]?.name_source, "OWNER PROVIDED");
  assert.equal(prospect.contacts?.[0]?.source, "OWNER PROVIDED");
  assert.equal(audits[0]?.previous, "");
  assert.equal(audits[0]?.next, "John Smith");
  assert.match(prospect.history?.[0]?.detail || "", /John Smith/);
  assert.equal(contactFields(prospect).find((f) => f.label === "Decision maker")?.status, "OWNER PROVIDED");
  assert.equal(spokenAfterSave(audits), "Done — I added John Smith as the decision maker.");
});

test("generic add command is a prompt, not a guess", () => {
  assert.equal(parseProspectEditSpeech("Ara, add information to this prospect.").kind, "prompt");
  assert.equal(parseProspectEditSpeech("Update this company.").kind, "prompt");
  assert.equal(isProspectEditSpeech("Add information to this prospect."), true);
});

test("acceptance 2 — multiple fields in one utterance", () => {
  const parsed = parseProspectEditSpeech(
    "The owner is John Smith, his email is john@example.com, and the company phone is 817-555-1234.",
  );
  assert.equal(parsed.kind, "fields");
  if (parsed.kind !== "fields") return;
  const san = sanitizeChanges(parsed.changes);
  assert.equal(san.ok, true);
  if (!san.ok) return;
  const { prospect } = applyProspectInfoChanges(firefighter(), san.changes);
  assert.equal(prospect.contacts?.[0]?.name, "John Smith");
  assert.equal(prospect.contacts?.[0]?.email, "john@example.com");
  assert.equal(prospect.contacts?.[0]?.email_status, "unverified");
  assert.equal(prospect.contacts?.[0]?.email_source, "OWNER PROVIDED");
  assert.equal(prospect.phone, "817-555-1234");
  assert.equal(prospect.phone_source, "OWNER PROVIDED");
  const email = usefulEmail(prospect);
  assert.equal(email?.value, "john@example.com");
  assert.equal(email?.status, "OWNER PROVIDED");
  assert.equal(reachKind(prospect), "READY_TO_CONTACT");
});

test("acceptance 6 — adding a usable email recomputes contactability and does not send", () => {
  const before = firefighter();
  assert.equal(reachKind(before), "NEEDS_CONTACT_INFO");
  const { prospect, audits } = applyProspectInfoChanges(before, { businessEmail: "john@example.com" });
  assert.equal(reachKind(prospect), "READY_TO_CONTACT");
  assert.equal(prospect.stage, before.stage);
  assert.equal(prospect.contacts?.[0]?.email_status, "unverified");
  assert.notEqual(contactFields(prospect).find((f) => /email/i.test(f.label))?.status, "VERIFIED");
  assert.ok(audits.length);
});

test("acceptance 7 — conflict keeps history and owner provenance", () => {
  const existing = {
    ...firefighter(),
    contacts: [{
      name: "Sarah Jones",
      title: "Owner",
      email: "",
      email_status: "none" as const,
      profile_url: "",
      source: "contact page",
      last_verified: "2026-09-18",
    }],
  };
  const parsed = parseProspectEditSpeech("Change the decision maker to John Smith.");
  assert.equal(parsed.kind, "fields");
  if (parsed.kind !== "fields") return;
  const { prospect, audits } = applyProspectInfoChanges(existing, parsed.changes);
  assert.equal(prospect.contacts?.[0]?.name, "John Smith");
  assert.equal(prospect.contacts?.[0]?.name_source, "OWNER PROVIDED");
  assert.equal(audits[0]?.previous, "Sarah Jones");
  assert.equal(audits[0]?.next, "John Smith");
  assert.match(prospect.history?.at(-1)?.detail || "", /Sarah Jones → John Smith/);
});

test("acceptance 8 — readback uses persisted owner-provided facts", () => {
  const { prospect } = applyProspectInfoChanges(firefighter(), {
    decisionMakerName: "John Smith",
    businessEmail: "john@apexsecuritysolutions.net",
    notes: "Met the owner at a networking event.",
  });
  const text = formatReadback(prospect);
  assert.match(text, /John Smith/);
  assert.match(text, /john@apexsecuritysolutions\.net/);
  assert.match(text, /Owner provided|OWNER PROVIDED/i);
  assert.match(text, /networking event/);
  assert.match(text, /does not send email/i);
  assert.equal(isProspectReadbackSpeech("How can we contact Apex Security Solutions?"), true);
  assert.equal(isProspectReadbackSpeech("What email did I add?"), true);
  assert.equal(isProspectEditSpeech("What email did I add?"), false);
});

test("ambiguous his-number with no person asks", () => {
  const parsed = parseProspectEditSpeech("His number is 817-555-1234.", { hasNamedPerson: false });
  assert.equal(parsed.kind, "ambiguous_phone");
  if (parsed.kind === "ambiguous_phone") assert.equal(parsed.phone, "817-555-1234");
});

test("destructive clear requires a dedicated parse kind", () => {
  const parsed = parseProspectEditSpeech("Delete all the contact information.");
  assert.equal(parsed.kind, "destructive");
});

test("remove the old phone is an explicit single-field clear", () => {
  const parsed = parseProspectEditSpeech("Remove the old phone number.");
  assert.equal(parsed.kind, "fields");
  if (parsed.kind !== "fields") return;
  const before = { ...firefighter(), phone: "(817) 479-8999" };
  const { prospect, audits } = applyProspectInfoChanges(before, parsed.changes);
  assert.ok(blankishSafe(prospect.phone));
  assert.equal(audits[0]?.previous, "(817) 479-8999");
});

function blankishSafe(v?: string) {
  const s = (v || "").trim();
  return !s || s.toUpperCase() === "UNKNOWN";
}

test("validation rejects malformed values and unknown keys", () => {
  assert.equal(validateEmail("not-an-email"), null);
  assert.equal(validateEmail("john@example.com"), "john@example.com");
  assert.equal(validateHttpUrl("javascript:alert(1)"), null);
  assert.equal(validateHttpUrl("apexsecuritysolutions.net")?.startsWith("https://"), true);
  const bad = sanitizeChanges({ businessEmail: "nope" });
  assert.equal(bad.ok, false);
  const picked = pickKnownChanges({ businessEmail: "a@b.co", secretToken: "x", prospect_uid: "uid-1" });
  assert.deepEqual(picked.unknown, ["secretToken"]);
  assert.equal(picked.changes.businessEmail, "a@b.co");
});

test("owner-provided email is usable but never labeled verified", () => {
  const { prospect } = applyProspectInfoChanges(firefighter(), { businessEmail: "John@Example.COM" });
  const email = usefulEmail(prospect);
  assert.equal(email?.value, "john@example.com");
  assert.equal(email?.status, "OWNER PROVIDED");
  assert.notEqual(email?.status, "VERIFIED");
  assert.equal(provenanceLabel(email?.status), "Owner provided");
});

test("DNC stays blocked even after an owner email", () => {
  const p = { ...firefighter(), stage: "Do Not Contact", suppressed: false };
  const { prospect } = applyProspectInfoChanges(p, { businessEmail: "john@example.com" });
  assert.equal(reachKind(prospect), "BLOCKED");
});

test("suppressed stays suppressed even after an owner email", () => {
  const p = { ...firefighter(), stage: "New", suppressed: true };
  const { prospect } = applyProspectInfoChanges(p, { businessEmail: "john@example.com" });
  assert.equal(reachKind(prospect), "SUPPRESSED");
});

test("notes stay owner notes, not public research claims", () => {
  const { prospect } = applyProspectInfoChanges(firefighter(), {
    notes: "They asked me to follow up in October.",
  });
  assert.equal(prospect.owner_notes, "They asked me to follow up in October.");
  assert.match(formatReadback(prospect), /follow up in October/);
  const parsed = parseProspectEditSpeech("Add a note that they said they are looking for more leads.");
  assert.equal(parsed.kind, "fields");
  if (parsed.kind === "fields") {
    assert.match(parsed.changes.notes || "", /looking for more leads/i);
  }
});

test("decision maker with role in one utterance", () => {
  const parsed = parseProspectEditSpeech("The decision maker is Sarah Jones, Marketing Director.");
  assert.equal(parsed.kind, "fields");
  if (parsed.kind !== "fields") return;
  const { prospect } = applyProspectInfoChanges(firefighter(), parsed.changes);
  assert.equal(prospect.contacts?.[0]?.name, "Sarah Jones");
  assert.equal(prospect.contacts?.[0]?.title, "Marketing Director");
});
