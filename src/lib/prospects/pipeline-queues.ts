/**
 * Acquisition OS Part 2 — derived pipeline queues (no duplicate storage).
 * Default Pipeline emphasizes contactable / active / replies / calls / proposals / needs Dylan.
 */
import type { Prospect } from "../review-brief.ts";
import {
  evaluateContactability,
  isActivePipelineStage,
  isArchiveStage,
  type ContactabilityOpts,
} from "./contactability.ts";
import { isTestWorkflowUid } from "../mail/test-loop.ts";
import type { FilterableProspect, ProspectViewFilter } from "./view-filter.ts";

export const PIPELINE_QUEUES = [
  "ACTIVE_PIPELINE",
  "NEEDS_CONTACT_INFORMATION",
  "NEEDS_RESEARCH",
  "NEEDS_DYLAN",
  "ARCHIVE_NOT_PURSUING",
  "SUPPRESSED",
] as const;

export type PipelineQueue = (typeof PIPELINE_QUEUES)[number];

export const QUEUE_LABEL: Record<PipelineQueue, string> = {
  ACTIVE_PIPELINE: "Active Pipeline",
  NEEDS_CONTACT_INFORMATION: "Needs Contact Information",
  NEEDS_RESEARCH: "Needs Research",
  NEEDS_DYLAN: "Needs Dylan",
  ARCHIVE_NOT_PURSUING: "Archive / Not Pursuing",
  SUPPRESSED: "Suppressed",
};

/** Extended filter — queue is Acquisition OS Part 2 (derived, not SQL). */
export type AcqProspectViewFilter = ProspectViewFilter & {
  queue?: PipelineQueue;
};

const NEEDS_DYLAN_STAGES = new Set([
  "Replied",
  "Call Booked",
  "Proposal Sent",
  "Negotiation",
  "Approved for Outreach",
  "Ready for Review",
  "Qualified",
]);

export function needsDylan(p: Prospect | FilterableProspect): boolean {
  const stage = "stage" in p ? p.stage : "";
  if (NEEDS_DYLAN_STAGES.has(stage)) return true;
  if ("reach" in p && p.reach === "READY_TO_CONTACT" && (stage === "New" || stage === "Qualified" || stage === "Approved for Outreach")) {
    return true;
  }
  return false;
}

export function assignQueue(p: Prospect, opts?: ContactabilityOpts): PipelineQueue {
  const c = evaluateContactability(p, opts);
  if (c.status === "SUPPRESSED") return "SUPPRESSED";
  if (p.suppressed) return "SUPPRESSED";
  if (isArchiveStage(p.stage || "") || c.status === "BLOCKED") {
    if ((p.stage || "") === "Do Not Contact" || c.status === "BLOCKED") return "ARCHIVE_NOT_PURSUING";
    if ((p.stage || "") === "Won" || (p.stage || "") === "Lost") return "ARCHIVE_NOT_PURSUING";
  }
  if (p.is_demo || isTestWorkflowUid(p.uid)) return "ARCHIVE_NOT_PURSUING";

  if (needsDylan(p) || isActivePipelineStage(p.stage || "")) return "NEEDS_DYLAN";

  if (c.contactable || c.status === "CONTACTABLE") {
    // Contactable first-touch sits in Active Pipeline (and Needs Dylan when awaiting send).
    if (p.stage === "Approved for Outreach" || c.contactable) return "ACTIVE_PIPELINE";
    return "ACTIVE_PIPELINE";
  }

  if (c.status === "NEEDS_RESEARCH") return "NEEDS_RESEARCH";
  if (c.status === "NEEDS_CONTACT_INFORMATION") return "NEEDS_CONTACT_INFORMATION";

  if (isActivePipelineStage(p.stage || "")) return "ACTIVE_PIPELINE";
  return "NEEDS_RESEARCH";
}

/**
 * Default Pipeline VIEW: active work only.
 * Hides TEST, DEMO, Needs Contact Info backlog, Needs Research backlog,
 * Suppressed, Not Pursuing / Archived — still reachable via secondary queues.
 */
export function defaultActivePipelineFilter(): AcqProspectViewFilter {
  return {
    excludeTest: true,
    excludeDemo: true,
    queue: "ACTIVE_PIPELINE",
    sort: "needs_attention",
    replace: true,
  };
}

export function filterForQueue(queue: PipelineQueue): AcqProspectViewFilter {
  return {
    excludeTest: queue !== "ARCHIVE_NOT_PURSUING",
    excludeDemo: queue !== "ARCHIVE_NOT_PURSUING",
    queue,
    replace: true,
    sort: queue === "NEEDS_DYLAN" || queue === "ACTIVE_PIPELINE" ? "needs_attention" : "newest",
  };
}

export function matchesQueue(
  row: FilterableProspect,
  queue: PipelineQueue,
  full?: Prospect,
  opts?: ContactabilityOpts,
): boolean {
  if (queue === "SUPPRESSED") {
    return row.reach === "SUPPRESSED" || row.stage === "Do Not Contact" || Boolean(full?.suppressed);
  }
  if (queue === "ARCHIVE_NOT_PURSUING") {
    return row.isDemo || row.isTest || row.stage === "Won" || row.stage === "Lost"
      || row.stage === "Do Not Contact" || row.reach === "BLOCKED";
  }
  if (queue === "NEEDS_CONTACT_INFORMATION") {
    return row.reach === "NEEDS_CONTACT_INFO" && !row.isDemo && !row.isTest && row.stage !== "Do Not Contact";
  }
  if (queue === "NEEDS_RESEARCH") {
    return row.reach === "NEEDS_RESEARCH" && !row.isDemo && !row.isTest;
  }
  if (queue === "NEEDS_DYLAN") {
    if (row.isDemo || row.isTest || row.reach === "SUPPRESSED" || row.reach === "BLOCKED") return false;
    return needsDylan(full || row);
  }
  // ACTIVE_PIPELINE
  if (row.isDemo || row.isTest) return false;
  if (row.reach === "SUPPRESSED" || row.reach === "BLOCKED") return false;
  if (row.reach === "NEEDS_CONTACT_INFO" || row.reach === "NEEDS_RESEARCH") {
    // Active stages still show even if reach is stale
    return isActivePipelineStage(row.stage);
  }
  if (row.reach === "READY_TO_CONTACT") return true;
  if (isActivePipelineStage(row.stage)) return true;
  if (full) {
    const c = evaluateContactability(full, opts);
    return c.contactable || c.status === "CONTACTABLE" && isActivePipelineStage(full.stage || "");
  }
  return false;
}

export function countByQueue(prospects: Prospect[], opts?: ContactabilityOpts): Record<PipelineQueue, number> {
  const out: Record<PipelineQueue, number> = {
    ACTIVE_PIPELINE: 0,
    NEEDS_CONTACT_INFORMATION: 0,
    NEEDS_RESEARCH: 0,
    NEEDS_DYLAN: 0,
    ARCHIVE_NOT_PURSUING: 0,
    SUPPRESSED: 0,
  };
  for (const p of prospects) {
    out[assignQueue(p, opts)] += 1;
  }
  return out;
}

export function queueChipLabel(queue: PipelineQueue, count: number): string {
  return `${QUEUE_LABEL[queue]} (${count})`;
}

/** Prefer assignQueue on full prospect when available. */
export function queueFromFilterable(row: FilterableProspect): PipelineQueue {
  if (row.reach === "SUPPRESSED") return "SUPPRESSED";
  if (row.isDemo || row.isTest || row.stage === "Won" || row.stage === "Lost" || row.reach === "BLOCKED") {
    return "ARCHIVE_NOT_PURSUING";
  }
  if (needsDylan(row) || isActivePipelineStage(row.stage)) return "NEEDS_DYLAN";
  if (row.reach === "READY_TO_CONTACT") return "ACTIVE_PIPELINE";
  if (row.reach === "NEEDS_CONTACT_INFO") return "NEEDS_CONTACT_INFORMATION";
  if (row.reach === "NEEDS_RESEARCH") return "NEEDS_RESEARCH";
  return "NEEDS_RESEARCH";
}

