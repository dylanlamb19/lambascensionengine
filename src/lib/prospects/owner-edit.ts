/**
 * Owner-provided prospect information.
 * Allowlisted fields only — never arbitrary JSON writes.
 * Provenance is always OWNER PROVIDED. Never VERIFIED / FOUND PUBLICLY / ENRICHED.
 */
import type { DecisionMaker } from "../research/types.ts";
import type { Finding, Prospect } from "../review-brief.ts";
import { blankish, namedPeople, reachKind, usefulEmail, type Provenance } from "./reach.ts";

export const OWNER_PROVENANCE = "OWNER PROVIDED" as const;
export const OWNER_ACTOR = "owner" as const;

export const ALLOWED_CHANGE_KEYS = [
  "decisionMakerName",
  "decisionMakerRole",
  "decisionMakerPhone",
  "businessEmail",
  "businessPhone",
  "website",
  "contactPage",
  "linkedin",
  "profileUrl",
  "industry",
  "city",
  "notes",
] as const;

export type ProspectInfoField = (typeof ALLOWED_CHANGE_KEYS)[number];

export type ProspectInfoChanges = {
  [K in ProspectInfoField]?: string | null;
};

export type FieldAudit = {
  field: ProspectInfoField;
  previous: string;
  next: string;
  source: "OWNER";
};

export type HistoryEntry = {
  at: string;
  action: string;
  detail: string;
  field?: string;
  previous?: string;
  next?: string;
  source?: string;
  actor?: string;
};

export type PendingProspectEdit = {
  uid: string;
  at: number;
  need: "fields" | "confirm_destructive" | "phone_target";
  changes?: ProspectInfoChanges;
  spoken?: string;
};

export type ParseKind =
  | { kind: "none" }
  | { kind: "prompt" }
  | { kind: "readback" }
  | { kind: "fields"; changes: ProspectInfoChanges }
  | { kind: "ambiguous_phone"; phone: string; changes: ProspectInfoChanges }
  | { kind: "destructive"; changes: ProspectInfoChanges }
  | { kind: "confirm_yes" }
  | { kind: "confirm_no" }
  | { kind: "phone_business" }
  | { kind: "phone_decision_maker" };

export type ValidationError = { field: string; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_FIND = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
const EMAIL_FIND = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_FIND = /(?:https?:\/\/|www\.)[^\s,;]+/i;
const NAME_TOKEN = "[A-Za-z][A-Za-z.'\\-]+(?:\\s+[A-Za-z][A-Za-z.'\\-]+){0,3}";
const MAX_NAME = 80;
const MAX_NOTES = 2000;
const MAX_HISTORY = 60;
const PENDING_MS = 5 * 60 * 1000;

const FIELD_LABEL: Record<ProspectInfoField, string> = {
  decisionMakerName: "Decision maker",
  decisionMakerRole: "Role",
  decisionMakerPhone: "Decision maker phone",
  businessEmail: "Email",
  businessPhone: "Business phone",
  website: "Website",
  contactPage: "Contact page",
  linkedin: "Company LinkedIn",
  profileUrl: "Profile",
  industry: "Industry",
  city: "Location",
  notes: "Owner note",
};

export function provenanceLabel(status: Provenance | string | undefined): string {
  switch (status) {
    case "OWNER PROVIDED": return "Owner provided";
    case "FOUND PUBLICLY": return "Found publicly";
    case "VERIFIED": return "Verified";
    case "ENRICHED": return "Enriched";
    case "UNKNOWN": return "";
    default: return status ? String(status) : "";
  }
}

export function isOwnerProvenance(source?: string | null): boolean {
  return /owner provided/i.test(source || "");
}

export function pendingProspectEditExpired(pending?: PendingProspectEdit | null, now = Date.now()): boolean {
  if (!pending) return true;
  return now - pending.at > PENDING_MS;
}

export function pickKnownChanges(raw: Record<string, unknown>): { changes: ProspectInfoChanges; unknown: string[] } {
  const changes: ProspectInfoChanges = {};
  const unknown: string[] = [];
  const aliases: Record<string, ProspectInfoField> = {
    decision_maker_name: "decisionMakerName",
    decisionMakerName: "decisionMakerName",
    owner_name: "decisionMakerName",
    decision_maker_role: "decisionMakerRole",
    decisionMakerRole: "decisionMakerRole",
    title: "decisionMakerRole",
    role: "decisionMakerRole",
    decision_maker_phone: "decisionMakerPhone",
    decisionMakerPhone: "decisionMakerPhone",
    business_email: "businessEmail",
    businessEmail: "businessEmail",
    email: "businessEmail",
    business_phone: "businessPhone",
    businessPhone: "businessPhone",
    phone: "businessPhone",
    website: "website",
    contact_page: "contactPage",
    contactPage: "contactPage",
    linkedin: "linkedin",
    company_linkedin: "linkedin",
    profile_url: "profileUrl",
    profileUrl: "profileUrl",
    industry: "industry",
    vertical: "industry",
    city: "city",
    notes: "notes",
    owner_notes: "notes",
    note: "notes",
  };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "prospectUid" || key === "prospect_uid" || key === "uid" || key === "confirmDestructive"
      || key === "confirm_destructive" || key === "phoneTarget" || key === "phone_target"
      || key === "inputMethod" || key === "prompt_only" || key === "clear_fields") continue;
    const field = aliases[key];
    if (!field) {
      unknown.push(key);
      continue;
    }
    if (value === null || value === undefined) {
      changes[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      unknown.push(key);
      continue;
    }
    changes[field] = value;
  }
  const clears = raw.clear_fields;
  if (Array.isArray(clears)) {
    for (const item of clears) {
      const key = String(item);
      const field = (aliases[key] || (ALLOWED_CHANGE_KEYS as readonly string[]).includes(key) ? key : undefined) as ProspectInfoField | undefined;
      const resolved = aliases[key] || (ALLOWED_CHANGE_KEYS.includes(field as ProspectInfoField) ? field : undefined);
      if (resolved) changes[resolved] = null;
    }
  }
  return { changes, unknown };
}

export function hasChanges(changes: ProspectInfoChanges): boolean {
  return Object.keys(changes).length > 0;
}

function stripCtl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || c >= 32) out += ch;
  }
  return out.trim();
}

export function validateEmail(raw: string): string | null {
  const s = stripCtl(raw).toLowerCase();
  if (!s || s.length > 254) return null;
  if (!EMAIL_RE.test(s)) return null;
  if (/\s/.test(s)) return null;
  return s;
}

export function normalizePhone(raw: string): { display: string; digits: string } | null {
  const original = stripCtl(raw);
  if (!original || original.length > 40) return null;
  const digits = original.replace(/[^\d]/g, "");
  const usable = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (usable.length < 10 || usable.length > 15) return null;
  return { display: original, digits: usable };
}

export function validateHttpUrl(raw: string): string | null {
  const s = stripCtl(raw).replace(/[.,;)\]]+$/, "");
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function validateName(raw: string): string | null {
  const s = stripCtl(raw).replace(/\s+/g, " ");
  if (!s || s.length < 2 || s.length > MAX_NAME) return null;
  if (/https?:|www\.|@/.test(s)) return null;
  return s;
}

export function validateTitle(raw: string): string | null {
  const s = stripCtl(raw).replace(/\s+/g, " ");
  if (!s || s.length > MAX_NAME) return null;
  if (/https?:|www\.|@/.test(s)) return null;
  return s;
}

export function validateNotes(raw: string): string | null {
  const s = stripCtl(raw).replace(/\s+\n/g, "\n").trim();
  if (!s || s.length > MAX_NOTES) return null;
  return s;
}

export function validateCity(raw: string): string | null {
  const s = stripCtl(raw).replace(/\s+/g, " ");
  if (!s || s.length > MAX_NAME) return null;
  return s;
}

export function sanitizeChanges(input: ProspectInfoChanges): { ok: true; changes: ProspectInfoChanges } | { ok: false; errors: ValidationError[] } {
  const out: ProspectInfoChanges = {};
  const errors: ValidationError[] = [];
  const put = (field: ProspectInfoField, raw: string | null | undefined, fn: (v: string) => string | null, emptyOk = true) => {
    if (raw === undefined) return;
    if (raw === null || raw.trim() === "") {
      if (!emptyOk) {
        errors.push({ field, message: `${FIELD_LABEL[field]} cannot be empty.` });
        return;
      }
      out[field] = null;
      return;
    }
    const v = fn(raw);
    if (!v) errors.push({ field, message: `${FIELD_LABEL[field]} looks malformed. I didn’t save it.` });
    else out[field] = v;
  };
  put("decisionMakerName", input.decisionMakerName, validateName);
  put("decisionMakerRole", input.decisionMakerRole, validateTitle);
  put("decisionMakerPhone", input.decisionMakerPhone, (v) => normalizePhone(v)?.display || null);
  put("businessEmail", input.businessEmail, (v) => validateEmail(v));
  put("businessPhone", input.businessPhone, (v) => normalizePhone(v)?.display || null);
  put("website", input.website, validateHttpUrl);
  put("contactPage", input.contactPage, validateHttpUrl);
  put("linkedin", input.linkedin, validateHttpUrl);
  put("profileUrl", input.profileUrl, validateHttpUrl);
  put("industry", input.industry, validateTitle);
  put("city", input.city, validateCity);
  put("notes", input.notes, validateNotes);
  if (errors.length) return { ok: false, errors };
  return { ok: true, changes: out };
}

function currentValue(p: Prospect, field: ProspectInfoField): string {
  const people = p.contacts || [];
  const primary = people.find((c) => c.name && c.name !== "UNKNOWN") || people[0];
  switch (field) {
    case "decisionMakerName": return primary?.name && primary.name !== "UNKNOWN" ? primary.name : "";
    case "decisionMakerRole": return primary?.title && primary.title !== "UNKNOWN" ? primary.title : "";
    case "decisionMakerPhone": return primary?.phone || "";
    case "businessEmail": return (people.find((c) => c.email && c.email.includes("@"))?.email) || "";
    case "businessPhone": return blankish(p.phone) ? "" : p.phone;
    case "website": return blankish(p.website) ? "" : p.website;
    case "contactPage": return p.contact_page || "";
    case "linkedin": return (p.socials || []).find((s) => s.network === "linkedin")?.url || "";
    case "profileUrl": return people.find((c) => c.profile_url)?.profile_url || "";
    case "industry": return p.vertical || "";
    case "city": return blankish(p.city) ? "" : p.city;
    case "notes": return p.owner_notes || "";
  }
}

function ensurePrimary(contacts: DecisionMaker[]): DecisionMaker {
  if (contacts[0]) return contacts[0];
  const blank: DecisionMaker = {
    name: "UNKNOWN",
    title: "UNKNOWN",
    email: "",
    email_status: "none",
    profile_url: "",
    source: OWNER_PROVENANCE,
    last_verified: "",
  };
  contacts.push(blank);
  return blank;
}

function setFinding(findings: Finding[], id: string, result: string, source: string): Finding[] {
  const next = findings.filter((f) => f.id !== id);
  if (!result) return next;
  next.push({
    id,
    result,
    status: "OBSERVED",
    source,
    checked_at: new Date().toISOString(),
    confidence: "high",
  });
  return next;
}

export function applyProspectInfoChanges(
  prospect: Prospect,
  rawChanges: ProspectInfoChanges,
  opts?: { at?: string; actor?: string },
): {
  prospect: Prospect;
  audits: FieldAudit[];
  history: HistoryEntry[];
  reach: ReturnType<typeof reachKind>;
} {
  const at = opts?.at || new Date().toISOString();
  const actor = opts?.actor || OWNER_ACTOR;
  const next: Prospect = {
    ...prospect,
    contacts: (prospect.contacts || []).map((c) => ({ ...c })),
    socials: (prospect.socials || []).map((s) => ({ ...s })),
    findings: (prospect.findings || []).map((f) => ({ ...f })),
    history: [...(prospect.history || [])],
  };
  const contacts = next.contacts || [];
  next.contacts = contacts;
  const audits: FieldAudit[] = [];

  const record = (field: ProspectInfoField, value: string) => {
    const previous = currentValue(next, field);
    const nextVal = value;
    if (previous === nextVal) return;
    audits.push({ field, previous, next: nextVal, source: "OWNER" });
  };

  if (rawChanges.decisionMakerName !== undefined) {
    record("decisionMakerName", rawChanges.decisionMakerName || "");
    const person = ensurePrimary(contacts);
    person.name = rawChanges.decisionMakerName || "UNKNOWN";
    person.name_source = OWNER_PROVENANCE;
    if (!person.source || person.source === "UNKNOWN") person.source = OWNER_PROVENANCE;
  }
  if (rawChanges.decisionMakerRole !== undefined) {
    record("decisionMakerRole", rawChanges.decisionMakerRole || "");
    const person = ensurePrimary(contacts);
    person.title = rawChanges.decisionMakerRole || "UNKNOWN";
    person.title_source = OWNER_PROVENANCE;
    if (!person.source || person.source === "UNKNOWN") person.source = OWNER_PROVENANCE;
  }
  if (rawChanges.decisionMakerPhone !== undefined) {
    record("decisionMakerPhone", rawChanges.decisionMakerPhone || "");
    const person = ensurePrimary(contacts);
    person.phone = rawChanges.decisionMakerPhone || "";
    person.phone_source = OWNER_PROVENANCE;
  }
  if (rawChanges.businessEmail !== undefined) {
    record("businessEmail", rawChanges.businessEmail || "");
    const person = ensurePrimary(contacts);
    person.email = rawChanges.businessEmail ? (rawChanges.businessEmail.toLowerCase()) : "";
    person.email_status = rawChanges.businessEmail ? "unverified" : "none";
    person.email_source = OWNER_PROVENANCE;
    if (!person.source || person.source === "UNKNOWN") person.source = OWNER_PROVENANCE;
  }
  if (rawChanges.businessPhone !== undefined) {
    record("businessPhone", rawChanges.businessPhone || "");
    next.phone = rawChanges.businessPhone || "UNKNOWN";
    next.phone_source = OWNER_PROVENANCE;
    next.findings = setFinding(next.findings || [], "owner_phone", rawChanges.businessPhone || "", OWNER_PROVENANCE);
  }
  if (rawChanges.website !== undefined) {
    record("website", rawChanges.website || "");
    next.website = rawChanges.website || "UNKNOWN";
    next.website_source = OWNER_PROVENANCE;
  }
  if (rawChanges.contactPage !== undefined) {
    record("contactPage", rawChanges.contactPage || "");
    next.contact_page = rawChanges.contactPage || "";
    next.contact_page_source = OWNER_PROVENANCE;
    next.findings = setFinding(next.findings || [], "owner_contact_page", rawChanges.contactPage || "", OWNER_PROVENANCE);
  }
  if (rawChanges.linkedin !== undefined) {
    record("linkedin", rawChanges.linkedin || "");
    const socials = (next.socials || []).filter((s) => s.network !== "linkedin");
    if (rawChanges.linkedin) {
      socials.push({ network: "linkedin", url: rawChanges.linkedin, source: OWNER_PROVENANCE });
    }
    next.socials = socials;
  }
  if (rawChanges.profileUrl !== undefined) {
    record("profileUrl", rawChanges.profileUrl || "");
    const person = ensurePrimary(contacts);
    person.profile_url = rawChanges.profileUrl || "";
    person.profile_source = OWNER_PROVENANCE;
  }
  if (rawChanges.industry !== undefined) {
    record("industry", rawChanges.industry || "");
    next.vertical = rawChanges.industry || next.vertical;
  }
  if (rawChanges.city !== undefined) {
    record("city", rawChanges.city || "");
    next.city = rawChanges.city || next.city;
  }
  if (rawChanges.notes !== undefined) {
    record("notes", rawChanges.notes || "");
    next.owner_notes = rawChanges.notes || "";
  }

  const history: HistoryEntry[] = audits.map((a) => ({
    at,
    action: "PROSPECT_INFORMATION_UPDATED",
    detail: `${FIELD_LABEL[a.field]} updated: ${a.previous || "Unknown"} → ${a.next || "cleared"}. Source: Owner provided.`,
    field: a.field,
    previous: a.previous,
    next: a.next,
    source: "OWNER",
    actor,
  }));
  next.history = [...(next.history || []), ...history].slice(-MAX_HISTORY);
  return { prospect: next, audits, history, reach: reachKind(next) };
}

export function spokenAfterSave(audits: FieldAudit[], companyName?: string): string {
  if (!audits.length) return "Nothing changed.";
  const bits = audits.map((a) => {
    if (!a.next) return `cleared ${FIELD_LABEL[a.field].toLowerCase()}`;
    if (a.field === "decisionMakerName") return `added ${a.next} as the decision maker`;
    if (a.field === "notes") return "saved your note";
    return `updated ${FIELD_LABEL[a.field].toLowerCase()} to ${a.next}`;
  });
  const who = companyName ? "" : "";
  void who;
  if (bits.length === 1) return `Done — I ${bits[0]}.`;
  return `Done — I ${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}.`;
}

export function formatHistory(entries: HistoryEntry[]): { at: string; line: string; source: string }[] {
  return entries
    .filter((e) => e.action === "PROSPECT_INFORMATION_UPDATED")
    .slice(-20)
    .reverse()
    .map((e) => {
      const d = new Date(e.at);
      const at = Number.isNaN(d.getTime())
        ? e.at
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        at,
        line: e.detail.replace(/\s*Source:.*$/, "").trim(),
        source: "Owner provided",
      };
    });
}

export function removingOnlyContactRoute(p: Prospect, changes: ProspectInfoChanges): boolean {
  const after = applyProspectInfoChanges(p, changes).prospect;
  const beforeReady = reachKind(p) === "READY_TO_CONTACT";
  const afterReady = reachKind(after) === "READY_TO_CONTACT";
  const clearingContact = changes.businessEmail === null || changes.businessEmail === ""
    || changes.businessPhone === null || changes.businessPhone === ""
    || changes.decisionMakerName === null || changes.decisionMakerName === "";
  return beforeReady && !afterReady && clearingContact;
}

function norm(raw: string): string {
  return (raw || "")
    .replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "")
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_PROMPT = /^(add|update) (some )?(information|info|details)( (to|on|for) (this |the )?(prospect|company|one))?$/;
const GENERIC_PROMPT2 = /^(update this (company|prospect)|add info|add their (info|information)|i found the owner'?s name|add (their |the |an? )?(email|phone|linkedin|note|notes|contact page|website))$/;
const DESTRUCTIVE = /^(delete|clear|remove|wipe) (all|every)( of)? (the )?(contact|their) (information|info|details|data)$/;
const READBACK = /how can we contact|what email did i add|who owns (this |the )?(company|prospect|business|one)|what notes did i add|what do we know about (them|this|the company)|who is the (owner|decision maker)|what('s| is) (their|the) (email|phone|number|note)/;
const CONFIRM_YES = /^(yes|yeah|yep|confirm|do it|please do|go ahead|that'?s right|correct)$/;
const CONFIRM_NO = /^(no|nope|cancel|never mind|nevermind|stop|don'?t)$/;
const PHONE_BUSINESS = /^(the )?((business|company|listing|office) (phone|number)|business|company|listing)$/;
const PHONE_DM = /^(the )?((decision maker|owner|his|her|their)('s)? (phone|number)|decision maker|owner|his|hers)$/;

function stopAt(name: string): string {
  return name
    .replace(/\s+(and|who|his|her|their|email|phone|number|linkedin|website|contact).*$/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function firstEmail(text: string): string | undefined {
  return text.match(EMAIL_FIND)?.[0];
}
function firstPhone(text: string): string | undefined {
  return text.match(PHONE_FIND)?.[0];
}
function allUrls(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(URL_FIND.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0].replace(/[.,;)\]]+$/g, ""));
  return out;
}

export function isProspectEditSpeech(raw: string): boolean {
  const t = norm(raw);
  if (!t) return false;
  if (/^(who|what|how|where|when)\b/.test(t)) return false;
  if (GENERIC_PROMPT.test(t) || GENERIC_PROMPT2.test(t) || DESTRUCTIVE.test(t)) return true;
  if (/\b(add|update|change|remove|clear|set)\b/.test(t) && /\b(email|phone|number|owner|linkedin|website|note|contact page|decision maker|profile)\b/.test(t)) return true;
  if (/\b(the )?(owner|decision maker) is\b/.test(t)) return true;
  if (new RegExp(`^${NAME_TOKEN} is the (owner|decision maker)`, "i").test(raw.trim().replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, ""))) return true;
  if (/\b(his|her|their) (email|number|phone|linkedin)\b/.test(t)) return true;
  if (/^add a note\b/.test(t)) return true;
  return false;
}

export function isProspectReadbackSpeech(raw: string): boolean {
  const t = norm(raw);
  return READBACK.test(t);
}

export function parseProspectEditSpeech(raw: string, opts?: { hasNamedPerson?: boolean }): ParseKind {
  const stripped = (raw || "").replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "").trim();
  const t = norm(raw);
  if (!t) return { kind: "none" };
  if (CONFIRM_YES.test(t)) return { kind: "confirm_yes" };
  if (CONFIRM_NO.test(t)) return { kind: "confirm_no" };
  if (PHONE_BUSINESS.test(t)) return { kind: "phone_business" };
  if (PHONE_DM.test(t)) return { kind: "phone_decision_maker" };
  if (READBACK.test(t)) return { kind: "readback" };
  if (DESTRUCTIVE.test(t)) {
    return {
      kind: "destructive",
      changes: {
        decisionMakerName: null,
        decisionMakerRole: null,
        decisionMakerPhone: null,
        businessEmail: null,
        businessPhone: null,
        profileUrl: null,
      },
    };
  }
  if (GENERIC_PROMPT.test(t) || GENERIC_PROMPT2.test(t)) return { kind: "prompt" };

  const changes: ProspectInfoChanges = {};
  const email = firstEmail(stripped);
  const phone = firstPhone(stripped);
  const urls = allUrls(stripped);

  const ownerIs = stripped.match(new RegExp(`(?:the )?(?:owner|decision maker|contact person) is (${NAME_TOKEN})`, "i"));
  const isOwner = stripped.match(new RegExp(`^(${NAME_TOKEN}) is the (?:owner|decision maker)`, "i"));
  const changeDm = stripped.match(new RegExp(`(?:change|update|set) the (?:owner|decision maker|contact person) to (${NAME_TOKEN})`, "i"));
  const foundName = stripped.match(new RegExp(`(?:the )?(?:owner'?s?|decision maker'?s?) name is (${NAME_TOKEN})`, "i"));
  const nameHit = stopAt((ownerIs || isOwner || changeDm || foundName)?.[1] || "");
  if (nameHit) changes.decisionMakerName = nameHit;

  function looksLikeRole(raw: string): boolean {
    const s = raw.trim();
    if (!s || s.length > 80) return false;
    if (/@|https?:|www\.|\d{3}/.test(s)) return false;
    if (/^(his|her|their|and|email|phone|number|the)\b/i.test(s)) return false;
    return true;
  }

  const roleAfterComma = stripped.match(new RegExp(`(?:decision maker|owner) is ${NAME_TOKEN},\\s*([^.,]+)`, "i"));
  const roleIs = stripped.match(/\b(?:role|title) is ([^,]+?)(?:\.|$| and )/i);
  if (roleAfterComma?.[1] && looksLikeRole(roleAfterComma[1])) changes.decisionMakerRole = roleAfterComma[1].trim();
  else if (roleIs?.[1] && looksLikeRole(roleIs[1])) changes.decisionMakerRole = roleIs[1].trim();
  else if (nameHit) {
    const roleOnly = stripped.match(new RegExp(`${nameHit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},\\s*([^.,]+)`, "i"));
    if (roleOnly?.[1] && looksLikeRole(roleOnly[1])) changes.decisionMakerRole = roleOnly[1].trim();
  }

  if (email) changes.businessEmail = email;

  const note = stripped.match(/add a note(?: that)?\s+(.+)$/i) || stripped.match(/\bnote(?: that)?:?\s+(.+)$/i);
  if (note?.[1] && !EMAIL_FIND.test(note[1])) changes.notes = note[1].trim();

  const city = stripped.match(/\b(?:they(?:'re| are) in|located in|city is)\s+([^.,]+)/i);
  if (city?.[1]) changes.city = city[1].trim();
  const industry = stripped.match(/\b(?:industry is|they sell|business type is)\s+([^.,]+)/i);
  if (industry?.[1]) changes.industry = industry[1].trim();

  for (const url of urls) {
    const around = t;
    if (/linkedin\.com\/in/i.test(url) || /\bprofile\b/.test(around) && /linkedin/.test(around)) {
      if (/linkedin\.com\/in/i.test(url)) changes.profileUrl = url;
      else if (/linkedin\.com\/company/i.test(url) || /\blinkedin\b/.test(around)) changes.linkedin = url;
      else changes.profileUrl = url;
    } else if (/linkedin\.com\/company/i.test(url) || (/\blinkedin\b/.test(around) && !changes.linkedin)) {
      changes.linkedin = url;
    } else if (/\bcontact (page|form|url)\b/.test(around) || /\/contact/i.test(url)) {
      changes.contactPage = url;
    } else if (/\bwebsite\b|\bsite\b|\bhomepage\b/.test(around) || !changes.website) {
      if (/\bcontact (page|form)\b/.test(around)) changes.contactPage = url;
      else if (/\blinkedin\b/.test(around)) changes.linkedin = url;
      else if (/\bprofile\b/.test(around)) changes.profileUrl = url;
      else changes.website = url;
    }
  }

  if (phone) {
    const hisNumber = /\b(his|her|their) (number|phone)\b/.test(t);
    const companyPhone = /\b(company|business|listing|office) phone\b/.test(t) || /\bthe phone number is\b/.test(t) && /\bcompany\b/.test(t);
    const removePhone = /\b(remove|clear|delete) (the )?(old )?(phone|number)\b/.test(t);
    if (removePhone && !/\d/.test(t)) {
      changes.businessPhone = null;
    } else if (hisNumber && !opts?.hasNamedPerson && !nameHit) {
      return { kind: "ambiguous_phone", phone, changes };
    } else if (/\bdecision maker'?s? phone\b/.test(t) || (hisNumber && (opts?.hasNamedPerson || nameHit))) {
      if (companyPhone) changes.businessPhone = phone;
      else if (hisNumber && !companyPhone && (opts?.hasNamedPerson || nameHit) && !/\bcompany phone\b/.test(t)) {
        // Spec: "the company phone is X" is business. "his number" with a person in the same utterance
        // in the multi-field example is still the company phone when they say "the company phone".
        // Bare "his number" with a named person present → still ask? Spec only requires ask when
        // no contact person exists. Save as business phone.
        changes.businessPhone = phone;
      } else {
        changes.businessPhone = phone;
      }
    } else {
      changes.businessPhone = phone;
    }
  } else if (/\b(remove|clear|delete) (the )?(old )?(phone|number)\b/.test(t)) {
    changes.businessPhone = null;
  }
  if (/\b(remove|clear|delete) (the )?(email)\b/.test(t) && !email) changes.businessEmail = null;
  if (/\b(remove|clear|delete) (the )?(owner|decision maker|contact person)\b/.test(t) && !nameHit) {
    changes.decisionMakerName = null;
  }

  if (!hasChanges(changes)) {
    if (isProspectEditSpeech(raw)) return { kind: "prompt" };
    return { kind: "none" };
  }
  return { kind: "fields", changes };
}

export function formatReadback(p: Prospect): string {
  const people = namedPeople(p);
  const bits: string[] = [];
  if (people[0]) {
    const c = people[0];
    const src = provenanceLabel(isOwnerProvenance(c.name_source || c.source) ? OWNER_PROVENANCE : "FOUND PUBLICLY");
    bits.push(`Decision maker: ${c.name}${c.title && c.title !== "UNKNOWN" ? `, ${c.title}` : ""} (${src || "on file"}).`);
  } else bits.push("Decision maker unknown. I will not invent a name.");
  const email = usefulEmail(p);
  if (email) bits.push(`Email: ${email.value} (${provenanceLabel(email.status) || email.status}).`);
  else bits.push("Email: none on file.");
  if (!blankish(p.phone)) {
    const src = isOwnerProvenance(p.phone_source) ? "Owner provided" : "Found publicly";
    bits.push(`Phone: ${p.phone} (${src}).`);
  } else bits.push("Phone: none on file.");
  if (p.owner_notes) bits.push(`Owner note: ${p.owner_notes}.`);
  bits.push("Adding contact information does not send email.");
  return bits.join(" ");
}

export function whichProspectSpeech(): string {
  return "Which prospect should I add that to?";
}

export function whatToAddSpeech(): string {
  return "What would you like to add or update?";
}

export function destructiveAskSpeech(): string {
  return "That would delete all the contact information. Say yes if you want me to clear it, or no to leave it.";
}

export function ambiguousPhoneSpeech(phone: string): string {
  return `Should I save ${phone} as the business phone or as the decision maker’s phone?`;
}

export function onlyRouteAskSpeech(): string {
  return "That’s the only contact route on file. Say yes to remove it, or no to keep it.";
}

export const FIELD_LABELS = FIELD_LABEL;
