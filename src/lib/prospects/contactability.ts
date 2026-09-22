/**
 * Authoritative Acquisition OS contactability.
 * CONTACTABLE / READY TO CONTACT requires a usable EMAIL route.
 * Phone, LinkedIn, and contact forms do NOT count without real send integrations.
 * Never invents emails, revenue, ad spend, ROAS, or lead counts.
 */
import { isTestWorkflowUid } from "../mail/test-loop.ts";
import type { Prospect } from "../review-brief.ts";
import { fitHeadline, type FitHeadline } from "./qualify.ts";
import {
  listingPhone,
  namedPeople,
  usefulEmail,
  verifiedWebsite,
  type ContactField,
  type Provenance,
} from "./reach.ts";

export type ContactabilityStatus =
  | "CONTACTABLE"
  | "NEEDS_CONTACT_INFORMATION"
  | "NEEDS_RESEARCH"
  | "BLOCKED"
  | "SUPPRESSED";

/** Owner-facing labels (Acquisition OS Part 1). */
export type OwnerContactLabel =
  | "READY TO CONTACT"
  | "NEEDS CONTACT INFORMATION"
  | "NEEDS RESEARCH"
  | "BLOCKED"
  | "SUPPRESSED";

export type ContactabilityOpts = {
  unsubscribed?: boolean;
  hardBounced?: boolean;
  /** ISO timestamp; while in the future, contactable=false. */
  cooldownUntil?: string | null;
  /** Active first-touch or follow-up sequence already running. */
  activeOutreach?: boolean;
  now?: Date;
};

export type ContactabilityResult = {
  status: ContactabilityStatus;
  ownerLabel: OwnerContactLabel;
  /** True only when a new autonomous email first-contact is allowed (still needs Dylan confirm + Test Mode). */
  contactable: boolean;
  reasons: string[];
  emailRoute: ContactField | null;
  emailProvenance: Provenance | null;
  qualOk: boolean;
  fitHeadline: FitHeadline;
  isRealProspect: boolean;
  blockers: string[];
};

const ACTIVE_STAGES = new Set([
  "Approved for Outreach",
  "Contacted",
  "Replied",
  "Call Booked",
  "Proposal Sent",
  "Negotiation",
]);

const ARCHIVE_STAGES = new Set(["Won", "Lost", "Do Not Contact"]);

export function ownerLabelFor(status: ContactabilityStatus): OwnerContactLabel {
  switch (status) {
    case "CONTACTABLE": return "READY TO CONTACT";
    case "NEEDS_CONTACT_INFORMATION": return "NEEDS CONTACT INFORMATION";
    case "NEEDS_RESEARCH": return "NEEDS RESEARCH";
    case "BLOCKED": return "BLOCKED";
    case "SUPPRESSED": return "SUPPRESSED";
  }
}

export function isRealProspect(p: Prospect): boolean {
  if (p.is_demo) return false;
  if (isTestWorkflowUid(p.uid)) return false;
  const name = (p.name || "").trim();
  if (!name || /^unknown$/i.test(name)) return false;
  return true;
}

/** Qualification threshold for autonomous contactability. */
export function meetsQualThreshold(p: Prospect): boolean {
  const fit = fitHeadline(p);
  if (fit === "GOOD FIT" || fit === "POSSIBLE FIT") return true;
  if (p.readiness === "STRONG CANDIDATE FOR FURTHER QUALIFICATION" || p.readiness === "POSSIBLE CANDIDATE") {
    return true;
  }
  if (p.fit === "strong" || p.fit === "possible") return true;
  if (ACTIVE_STAGES.has(p.stage || "")) return true;
  return false;
}

function cooldownActive(until: string | null | undefined, now: Date): boolean {
  if (!until) return false;
  const t = Date.parse(until);
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

function inferredActiveOutreach(p: Prospect, opts?: ContactabilityOpts): boolean {
  if (opts?.activeOutreach === true) return true;
  if (opts?.activeOutreach === false) return false;
  const stage = p.stage || "";
  if (stage === "Contacted" || stage === "Replied") return true;
  const pack = p.outreach as { status?: string } | undefined;
  if (pack?.status && /active|scheduled|sending/i.test(pack.status)) return true;
  return false;
}

/** Usable EMAIL route. Owner-provided counts; never relabeled VERIFIED here. */
export function usableEmailRoute(p: Prospect): ContactField | null {
  return usefulEmail(p);
}

function noEmailStatus(p: Prospect): ContactabilityStatus {
  const researched = p.research_status === "complete" || p.research_status === "partial"
    || p.research_status === "blocked" || p.research_status === "failed";
  const thin = !listingPhone(p) && !verifiedWebsite(p) && namedPeople(p).length === 0;
  if (!researched && thin) return "NEEDS_RESEARCH";
  if (p.research_status === "queued" && thin) return "NEEDS_RESEARCH";
  return "NEEDS_CONTACT_INFORMATION";
}

export function evaluateContactability(p: Prospect, opts: ContactabilityOpts = {}): ContactabilityResult {
  const now = opts.now || new Date();
  const fit = fitHeadline(p);
  const emailRoute = usableEmailRoute(p);
  const real = isRealProspect(p);
  const qualOk = meetsQualThreshold(p);
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (Boolean(p.suppressed) || opts.unsubscribed === true) {
    blockers.push(opts.unsubscribed ? "unsubscribed" : "suppressed");
    return {
      status: "SUPPRESSED",
      ownerLabel: "SUPPRESSED",
      contactable: false,
      reasons: ["This company is suppressed or asked not to be contacted."],
      emailRoute,
      emailProvenance: emailRoute?.status || null,
      qualOk,
      fitHeadline: fit,
      isRealProspect: real,
      blockers,
    };
  }

  if ((p.stage || "") === "Do Not Contact") {
    blockers.push("do_not_contact");
    return {
      status: "BLOCKED",
      ownerLabel: "BLOCKED",
      contactable: false,
      reasons: ["Do Not Contact."],
      emailRoute,
      emailProvenance: emailRoute?.status || null,
      qualOk,
      fitHeadline: fit,
      isRealProspect: real,
      blockers,
    };
  }

  if (opts.hardBounced) {
    blockers.push("hard_bounce");
    return {
      status: "SUPPRESSED",
      ownerLabel: "SUPPRESSED",
      contactable: false,
      reasons: ["The email route hard-bounced. We will not keep sending to this address."],
      emailRoute,
      emailProvenance: emailRoute?.status || null,
      qualOk,
      fitHeadline: fit,
      isRealProspect: real,
      blockers,
    };
  }

  if (!emailRoute) {
    blockers.push("no_email");
    const status = noEmailStatus(p);
    return {
      status,
      ownerLabel: ownerLabelFor(status),
      contactable: false,
      reasons: [
        status === "NEEDS_RESEARCH"
          ? "No usable email yet; more research is needed before outreach."
          : "No usable email. Phone, LinkedIn, and contact forms do not count without a real send integration.",
      ],
      emailRoute: null,
      emailProvenance: null,
      qualOk,
      fitHeadline: fit,
      isRealProspect: real,
      blockers,
    };
  }

  if (emailRoute.status === "OWNER PROVIDED") {
    reasons.push("Email is OWNER PROVIDED (not marked VERIFIED). Saving it does not send mail.");
  }

  if (!real) {
    blockers.push(p.is_demo ? "demo" : "test");
    return {
      status: "BLOCKED",
      ownerLabel: "BLOCKED",
      contactable: false,
      reasons: ["Test/demo records are not autonomously contactable."],
      emailRoute,
      emailProvenance: emailRoute.status,
      qualOk,
      fitHeadline: fit,
      isRealProspect: false,
      blockers,
    };
  }

  if (!qualOk) {
    blockers.push("qual_threshold");
    return {
      status: "NEEDS_RESEARCH",
      ownerLabel: "NEEDS RESEARCH",
      contactable: false,
      reasons: ["Fit is below the contactability threshold."],
      emailRoute,
      emailProvenance: emailRoute.status,
      qualOk: false,
      fitHeadline: fit,
      isRealProspect: real,
      blockers,
    };
  }

  if (cooldownActive(opts.cooldownUntil, now)) {
    blockers.push("cooldown");
    reasons.push("Cooldown is active.");
  }
  if (inferredActiveOutreach(p, opts)) {
    blockers.push("active_outreach");
    reasons.push("Outreach is already active — not eligible for a new first contact.");
  }

  const contactable = blockers.length === 0;
  if (contactable) {
    reasons.push("Real prospect, meets fit threshold, usable email route, not suppressed.");
  }

  return {
    status: "CONTACTABLE",
    ownerLabel: "READY TO CONTACT",
    contactable,
    reasons,
    emailRoute,
    emailProvenance: emailRoute.status,
    qualOk: true,
    fitHeadline: fit,
    isRealProspect: real,
    blockers,
  };
}

export function reachKindFromContactability(status: ContactabilityStatus):
  | "READY_TO_CONTACT"
  | "NEEDS_CONTACT_INFO"
  | "NEEDS_RESEARCH"
  | "BLOCKED"
  | "SUPPRESSED" {
  switch (status) {
    case "CONTACTABLE": return "READY_TO_CONTACT";
    case "NEEDS_CONTACT_INFORMATION": return "NEEDS_CONTACT_INFO";
    case "NEEDS_RESEARCH": return "NEEDS_RESEARCH";
    case "BLOCKED": return "BLOCKED";
    case "SUPPRESSED": return "SUPPRESSED";
  }
}

export function isActivePipelineStage(stage: string): boolean {
  return ACTIVE_STAGES.has(stage);
}

export function isArchiveStage(stage: string): boolean {
  return ARCHIVE_STAGES.has(stage);
}

/**
 * Part 3: qualified prospects without email route into Needs Contact Information.
 * Pure helper — does not mutate storage by itself.
 */
export function routeQualifiedWithoutEmail(p: Prospect): {
  queue: "NEEDS_CONTACT_INFORMATION" | "NEEDS_RESEARCH" | null;
  reason: string;
} {
  const c = evaluateContactability(p);
  if (c.status === "NEEDS_CONTACT_INFORMATION") {
    return { queue: "NEEDS_CONTACT_INFORMATION", reason: c.reasons[0] || "Needs contact information." };
  }
  if (c.status === "NEEDS_RESEARCH" && c.qualOk) {
    return { queue: "NEEDS_RESEARCH", reason: c.reasons[0] || "Needs research." };
  }
  if (meetsQualThreshold(p) && !usableEmailRoute(p) && c.status !== "SUPPRESSED" && c.status !== "BLOCKED") {
    return { queue: "NEEDS_CONTACT_INFORMATION", reason: "Qualified without a usable email." };
  }
  return { queue: null, reason: "" };
}
