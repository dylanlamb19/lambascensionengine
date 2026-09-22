#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function write(rel, text) { fs.writeFileSync(path.join(root, rel), text); console.log("patched", rel); }
function once(hay, needle, repl, label) {
  if (!hay.includes(needle)) {
    if (hay.includes(String(repl).split("\n")[0].slice(0, 48))) {
      console.log("skip (present)", label);
      return hay;
    }
    throw new Error("patch miss: " + label);
  }
  return hay.replace(needle, repl);
}

{
  let t = read("src/lib/prospects/view-filter.ts");
  t = once(
    t,
    'export const REACH_FILTER = ["READY_TO_CONTACT", "NEEDS_CONTACT_INFO", "NEEDS_RESEARCH", "BLOCKED"] as const;',
    'export const REACH_FILTER = ["READY_TO_CONTACT", "NEEDS_CONTACT_INFO", "NEEDS_RESEARCH", "BLOCKED", "SUPPRESSED"] as const;\nexport const QUEUE_FILTER = ["ACTIVE_PIPELINE", "NEEDS_CONTACT_INFORMATION", "NEEDS_RESEARCH", "NEEDS_DYLAN", "ARCHIVE_NOT_PURSUING", "SUPPRESSED"] as const;',
    "REACH_FILTER",
  );
  if (!t.includes("queue?:")) {
    t = once(
      t,
      "  limit?: number;\n  replace?: boolean;\n};",
      "  limit?: number;\n  replace?: boolean;\n  /** Acquisition OS derived queue (Part 2). */\n  queue?: (typeof QUEUE_FILTER)[number];\n};",
      "queue field",
    );
  }
  t = once(t, '"sort", "limit", "replace",\n]);', '"sort", "limit", "replace", "queue",\n]);', "ALLOWED_KEYS queue");
  if (!t.includes("filter.queue =")) {
    t = once(
      t,
      "  const replace = asBool(input.replace);\n  if (replace !== undefined) filter.replace = replace;\n  return { filter, unknown };",
      "  const replace = asBool(input.replace);\n  if (replace !== undefined) filter.replace = replace;\n  const queue = pickEnum(input.queue, QUEUE_FILTER)?.[0];\n  if (queue) filter.queue = queue;\n  return { filter, unknown };",
      "validate queue",
    );
  }
  t = once(
    t,
    "const ATTN_RANK: Record<ReachKind, number> = {\n  NEEDS_RESEARCH: 0,\n  NEEDS_CONTACT_INFO: 1,\n  BLOCKED: 2,\n  READY_TO_CONTACT: 3,\n};",
    "const ATTN_RANK: Record<ReachKind, number> = {\n  NEEDS_RESEARCH: 0,\n  NEEDS_CONTACT_INFO: 1,\n  BLOCKED: 2,\n  SUPPRESSED: 2,\n  READY_TO_CONTACT: 3,\n};",
    "ATTN_RANK",
  );
  if (!t.includes("matchesQueue")) {
    t = once(
      t,
      'import type { LastDiscovery } from "./last-discovery.ts";',
      'import type { LastDiscovery } from "./last-discovery.ts";\nimport { matchesQueue, type PipelineQueue } from "./pipeline-queues.ts";',
      "import matchesQueue",
    );
    t = once(
      t,
      "  if (f.minRating != null && p.rating < f.minRating) return false;\n  return true;\n}",
      "  if (f.minRating != null && p.rating < f.minRating) return false;\n  if (f.queue) {\n    if (!matchesQueue(p, f.queue as PipelineQueue)) return false;\n  }\n  return true;\n}",
      "matches queue",
    );
  }
  if (!t.includes("Active Pipeline")) {
    t = once(
      t,
      '  if (f.sort === "needs_attention") chips.push("Needs attention first");\n  return [...new Set(chips)];',
      '  if (f.sort === "needs_attention") chips.push("Needs attention first");\n  if (f.queue === "ACTIVE_PIPELINE") chips.push("Active Pipeline");\n  if (f.queue === "NEEDS_CONTACT_INFORMATION") chips.push("Needs Contact Information");\n  if (f.queue === "NEEDS_RESEARCH") chips.push("Needs Research");\n  if (f.queue === "NEEDS_DYLAN") chips.push("Needs Dylan");\n  if (f.queue === "ARCHIVE_NOT_PURSUING") chips.push("Archive / Not Pursuing");\n  if (f.queue === "SUPPRESSED") chips.push("Suppressed");\n  return [...new Set(chips)];',
      "queue chips",
    );
  }
  t = t.replace(
    'chips.push(r === "NEEDS_CONTACT_INFO" ? "Needs Contact Info" : r === "READY_TO_CONTACT" ? "Ready to contact" : r === "NEEDS_RESEARCH" ? "Needs research" : "Blocked");',
    'chips.push(r === "NEEDS_CONTACT_INFO" ? "Needs Contact Information" : r === "READY_TO_CONTACT" ? "Ready to contact" : r === "NEEDS_RESEARCH" ? "Needs research" : r === "SUPPRESSED" ? "Suppressed" : "Blocked");',
  );
  if (!t.includes('filter.queue = "ACTIVE_PIPELINE"')) {
    t = once(
      t,
      '  if (/\\bneed(s|ing)? contact( info| information)?|missing contact|no contact info\\b/.test(t)) {\n    filter.reach = ["NEEDS_CONTACT_INFO"];\n  }',
      '  if (/\\bneed(s|ing)? contact( info| information)?|missing contact|no contact info\\b/.test(t)) {\n    filter.reach = ["NEEDS_CONTACT_INFO"];\n  }\n  if (/\\b(active pipeline|show (me )?active)\\b/.test(t)) filter.queue = "ACTIVE_PIPELINE";\n  if (/\\bneeds dylan\\b/.test(t)) filter.queue = "NEEDS_DYLAN";\n  if (/\\b(needs contact information queue|contact info backlog)\\b/.test(t)) filter.queue = "NEEDS_CONTACT_INFORMATION";',
      "spoken queues",
    );
  }
  if (!t.includes("args.queue")) {
    t = once(
      t,
      "    replace: args.replace ?? args.clear,\n  };",
      "    replace: args.replace ?? args.clear,\n    queue: args.queue,\n  };",
      "toolArgs queue",
    );
  }
  t = t.replace(
    '"source", "excludeTest", "excludeDemo", "addedAfter",\n  "minReviews", "minRating", "prospectUids",\n];',
    '"source", "excludeTest", "excludeDemo", "addedAfter",\n  "minReviews", "minRating", "prospectUids", "queue",\n];',
  );
  write("src/lib/prospects/view-filter.ts", t);
}

{
  let t = read("src/lib/sentinel/codes.ts");
  if (!t.includes("CONTACTABILITY_MISMATCH")) {
    t = once(t, '  "HTTP_UNHEALTHY",\n  "SENTINEL_OK",\n] as const;', '  "HTTP_UNHEALTHY",\n  "CONTACTABILITY_MISMATCH",\n  "CONTACTABLE_WITHOUT_EMAIL",\n  "PIPELINE_QUEUE_INVARIANT",\n  "SENTINEL_OK",\n] as const;', "sentinel codes");
    t = once(t, '    case "HTTP_UNHEALTHY":\n      return "high";', '    case "HTTP_UNHEALTHY":\n    case "CONTACTABILITY_MISMATCH":\n    case "CONTACTABLE_WITHOUT_EMAIL":\n    case "PIPELINE_QUEUE_INVARIANT":\n      return "high";', "sentinel severity");
    t = once(t, '    || code === "BOUNCE_FUTURE_SEND_SCHEDULED"\n  ) return "pipeline";', '    || code === "BOUNCE_FUTURE_SEND_SCHEDULED"\n    || code === "CONTACTABILITY_MISMATCH"\n    || code === "CONTACTABLE_WITHOUT_EMAIL"\n    || code === "PIPELINE_QUEUE_INVARIANT"\n  ) return "pipeline";', "sentinel feature");
    t = once(t, '    case "HTTP_UNHEALTHY": return "The live site did not respond";\n    default: return "Sentinel noted a check";', '    case "HTTP_UNHEALTHY": return "The live site did not respond";\n    case "CONTACTABILITY_MISMATCH": return "Contactability labels disagree with the email route";\n    case "CONTACTABLE_WITHOUT_EMAIL": return "A prospect was marked contactable without an email";\n    case "PIPELINE_QUEUE_INVARIANT": return "Pipeline queue membership looks inconsistent";\n    default: return "Sentinel noted a check";', "sentinel labels");
    write("src/lib/sentinel/codes.ts", t);
  } else console.log("skip sentinel codes");
}

{
  let t = read("src/lib/voice/tools.ts");
  if (!t.includes("contact_eligible_prospects")) {
    t = once(t, '  "filter_prospects",\n  "start_tasks",', '  "filter_prospects",\n  "contact_eligible_prospects",\n  "start_tasks",', "allowed tool");
    if (t.includes('FILTER_PROSPECTS: "filter_prospects"')) {
      t = once(t, '  FILTER_PROSPECTS: "filter_prospects",', '  FILTER_PROSPECTS: "filter_prospects",\n  CONTACT_ELIGIBLE_PROSPECTS: "contact_eligible_prospects",', "tool alias");
    }
    t = once(
      t,
      '{ type: "function", name: "filter_prospects",',
      '{ type: "function", name: "contact_eligible_prospects", description: "Report how many prospects are currently CONTACTABLE by usable EMAIL (Acquisition OS). Test Mode gated. Never sends. Never invents counts.", parameters: { type: "object", properties: {} } },\n    { type: "function", name: "filter_prospects",',
      "tool schema",
    );
    write("src/lib/voice/tools.ts", t);
  } else console.log("skip tools");
}

{
  let t = read("src/components/owner-desk.tsx");
  if (!t.includes("defaultActivePipelineFilter")) {
    t = once(
      t,
      'import { applyProspectFilter, filterChips, filterSummary, fromProspect, isFilterEmpty, type ProspectViewFilter } from "@/lib/prospects/view-filter";',
      'import { applyProspectFilter, filterChips, filterSummary, fromProspect, isFilterEmpty, type ProspectViewFilter } from "@/lib/prospects/view-filter";\nimport {\n  defaultActivePipelineFilter,\n  filterForQueue,\n  QUEUE_LABEL,\n  type PipelineQueue,\n} from "@/lib/prospects/pipeline-queues";',
      "owner import queues",
    );
    t = once(
      t,
      "const [prospectFilter, setProspectFilter] = useState<ProspectViewFilter>({});",
      "const [prospectFilter, setProspectFilter] = useState<ProspectViewFilter>(() => defaultActivePipelineFilter());",
      "default filter",
    );
    if (!t.includes("data-acq-queues")) {
      t = once(
        t,
        '            <p className="la-kicker">Pipeline</p>\n            <h2 className="font-display mb-2 mt-2 text-2xl">Pipeline</h2>',
        '            <p className="la-kicker">Pipeline</p>\n            <h2 className="font-display mb-2 mt-2 text-2xl">Pipeline</h2>\n            <div className="mb-3 flex flex-wrap gap-2" data-acq-queues="1">\n              {([\n                "ACTIVE_PIPELINE",\n                "NEEDS_DYLAN",\n                "NEEDS_CONTACT_INFORMATION",\n                "NEEDS_RESEARCH",\n                "SUPPRESSED",\n                "ARCHIVE_NOT_PURSUING",\n              ] as PipelineQueue[]).map((q) => (\n                <button\n                  key={q}\n                  type="button"\n                  className="la-btn la-btn-quiet"\n                  data-on={(prospectFilter as { queue?: string }).queue === q ? "1" : "0"}\n                  onClick={() => dispatchAction({ name: "FILTER_PROSPECTS", filter: filterForQueue(q) })}\n                >\n                  {QUEUE_LABEL[q]}\n                </button>\n              ))}\n            </div>',
        "queue buttons",
      );
    }
    write("src/components/owner-desk.tsx", t);
  } else console.log("skip owner-desk");
}

// TOOLS_APPEND_START
{
  let t = read("src/lib/voice/tools.ts");
  if (!t.includes("contact_eligible_prospects")) {
    t = once(t, '  "filter_prospects",\n  "start_tasks",', '  "filter_prospects",\n  "contact_eligible_prospects",\n  "start_tasks",', "allowed tool");
    if (t.includes('FILTER_PROSPECTS: "filter_prospects"')) {
      t = once(t, '  FILTER_PROSPECTS: "filter_prospects",', '  FILTER_PROSPECTS: "filter_prospects",\n  CONTACT_ELIGIBLE_PROSPECTS: "contact_eligible_prospects",', "tool alias");
    }
    t = once(
      t,
      '{ type: "function", name: "filter_prospects",',
      '{ type: "function", name: "contact_eligible_prospects", description: "Report how many prospects are currently CONTACTABLE by usable EMAIL (Acquisition OS). Test Mode gated. Never sends. Never invents counts.", parameters: { type: "object", properties: {} } },\n    { type: "function", name: "filter_prospects",',
      "tool schema",
    );
  }
  if (!t.includes('from "../prospects/contactability')) {
    t = once(
      t,
      'import { hasChanges, pickKnownChanges, whatToAddSpeech, whichProspectSpeech } from "../prospects/owner-edit.ts";',
      'import { hasChanges, pickKnownChanges, whatToAddSpeech, whichProspectSpeech } from "../prospects/owner-edit.ts";\nimport { evaluateContactability } from "../prospects/contactability.ts";',
      "import contactability",
    );
  }
  if (!t.includes('tool === "contact_eligible_prospects"')) {
    const marker = '  if (tool === "filter_prospects") {';
    const insert = [
      '  if (tool === "contact_eligible_prospects") {',
      '    let contactable = 0, needsContact = 0, needsResearch = 0, blocked = 0, suppressed = 0;',
      '    const contactableUids = [];',
      '    for (const row of ctx.prospects || []) {',
      '      const p = {',
      '        id: 0, uid: row.uid, name: row.name, vertical: row.vertical || "", city: row.city || "",',
      '        website: row.website || "UNKNOWN", phone: row.phone || "UNKNOWN",',
      '        review_count: row.review_count || 0, google_rating: row.google_rating || "UNKNOWN",',
      '        job_value_est: 0, score: row.score || 0, fit: "possible", fit_plain: "",',
      '        stage: row.stage || "New", stage_plain: row.stage_plain || "",',
      '        research_status: row.research_status || "none", findings: [],',
      '        contacts: row.recipient ? [{ name: row.decisionMaker || "UNKNOWN", title: "UNKNOWN", email: row.recipient, email_status: "unverified", profile_url: "", source: "prospect record", last_verified: "" }] : [],',
      '        is_demo: Boolean(row.is_demo), suppressed: Boolean(row.suppressed),',
      '        readiness: row.fit_headline === "GOOD FIT" ? "STRONG CANDIDATE FOR FURTHER QUALIFICATION" : row.fit_headline === "POSSIBLE FIT" ? "POSSIBLE CANDIDATE" : undefined,',
      '      };',
      '      const c = evaluateContactability(p);',
      '      if (c.status === "CONTACTABLE" && c.contactable) { contactable += 1; if (row.uid) contactableUids.push(row.uid); }',
      '      else if (c.status === "NEEDS_CONTACT_INFORMATION") needsContact += 1;',
      '      else if (c.status === "NEEDS_RESEARCH") needsResearch += 1;',
      '      else if (c.status === "BLOCKED") blocked += 1;',
      '      else if (c.status === "SUPPRESSED") suppressed += 1;',
      '    }',
      '    const spoken = ctx.testMode',
      '      ? `Test Mode is on. ${contactable} prospect${contactable === 1 ? "" : "s"} currently CONTACTABLE by email. Nothing was sent.`',
      '      : `${contactable} prospect${contactable === 1 ? "" : "s"} currently CONTACTABLE by email. Nothing was sent.`;',
      '    return {',
      '      ok: true, tool, rejected: false,',
      '      output: { ok: true, counts: { contactable, needsContactInformation: needsContact, needsResearch, blocked, suppressed }, contactableUids, testMode: Boolean(ctx.testMode), spoken, emailSent: false, changed: false },',
      '      plan: { type: "speak", text: spoken },',
      '    };',
      '  }',
      marker,
    ].join("\n");
    t = t.replace(marker, insert);
  }
  t = t.replace(
    'reach: { type: "array", items: { type: "string", enum: ["READY_TO_CONTACT", "NEEDS_CONTACT_INFO", "NEEDS_RESEARCH", "BLOCKED"] } }',
    'reach: { type: "array", items: { type: "string", enum: ["READY_TO_CONTACT", "NEEDS_CONTACT_INFO", "NEEDS_RESEARCH", "BLOCKED", "SUPPRESSED"] } }, queue: { type: "string", enum: ["ACTIVE_PIPELINE", "NEEDS_CONTACT_INFORMATION", "NEEDS_RESEARCH", "NEEDS_DYLAN", "ARCHIVE_NOT_PURSUING", "SUPPRESSED"] }',
  );
  write("src/lib/voice/tools.ts", t);
}
// TOOLS_APPEND_END


// --- wire contactability invariants (inspect-only) ---
{
  let t = read("src/lib/sentinel/invariants.ts");
  if (!t.includes("evaluateContactabilityInvariants")) {
    t = once(
      t,
      'import { makeFinding } from "./ledger.ts";\nimport type { InvariantSnapshot, SentinelFinding } from "./types.ts";',
      'import { makeFinding } from "./ledger.ts";\nimport type { InvariantSnapshot, SentinelFinding } from "./types.ts";\nimport { evaluateContactabilityInvariants } from "./contactability-check.ts";',
      "import contactability invariants",
    );
    t = once(
      t,
      '  return out;\n}\n\nexport const EMPTY_INVARIANTS',
      '  // Acquisition OS contactability checks require prospect payloads; caller may pass via snap.prospects when present.\n  const prospects = (snap as InvariantSnapshot & { prospects?: import("../review-brief.ts").Prospect[] }).prospects;\n  if (prospects?.length) out.push(...evaluateContactabilityInvariants(prospects));\n  return out;\n}\n\nexport const EMPTY_INVARIANTS',
      "call contactability invariants",
    );
    write("src/lib/sentinel/invariants.ts", t);
  } else console.log("skip invariants wire");
}

console.log("Acquisition OS patches applied.");
