/**
 * Select campaign members via EMAIL-only contactability + filters.
 * Fail closed. LinkedIn ≠ email contactability. Never invents emails.
 */
import type { Prospect } from "../review-brief.ts";
import { evaluateContactability, type ContactabilityResult } from "../prospects/contactability.ts";
import { fitHeadline } from "../prospects/qualify.ts";
import type { CampaignMemberStatus } from "./types.ts";

export type MembershipInput = {
  prospects: Prospect[];
  verticals?: string[];
  locations?: string[];
  requireUsableEmail?: boolean;
  minFit?: string;
  /** Cooldown map prospect_uid → ISO until */
  cooldowns?: Map<string, string>;
  /** Active outreach sequence uids */
  activeOutreachUids?: Set<string>;
  unsubscribedUids?: Set<string>;
  hardBouncedUids?: Set<string>;
  now?: Date;
};

export type MembershipRow = {
  prospectUid: string;
  status: CampaignMemberStatus;
  skipReason: string;
  recipient: string;
  eligibilitySnapshot: Record<string, unknown>;
  contactability: ContactabilityResult;
};

function norm(s: string): string {
  return (s || "").trim().toLowerCase();
}

function fitsMinFit(p: Prospect, minFit: string): boolean {
  const fit = fitHeadline(p);
  const m = norm(minFit);
  if (m === "strong" || m === "good") return fit === "GOOD FIT";
  // possible (default): GOOD or POSSIBLE
  return fit === "GOOD FIT" || fit === "POSSIBLE FIT";
}

function matchesFilters(p: Prospect, verticals: string[], locations: string[]): boolean {
  if (verticals.length) {
    const v = norm(p.vertical || "");
    if (!verticals.some((x) => v.includes(norm(x)) || norm(x).includes(v))) return false;
  }
  if (locations.length) {
    const city = norm(p.city || "");
    if (!locations.some((x) => city.includes(norm(x)) || norm(x).includes(city))) return false;
  }
  return true;
}

/** Pure membership builder — no DB, no sends. */
export function buildMembership(input: MembershipInput): MembershipRow[] {
  const verticals = (input.verticals || []).map(norm).filter(Boolean);
  const locations = (input.locations || []).map(norm).filter(Boolean);
  const requireEmail = input.requireUsableEmail !== false;
  const minFit = input.minFit || "possible";
  const cooldowns = input.cooldowns || new Map();
  const active = input.activeOutreachUids || new Set<string>();
  const unsub = input.unsubscribedUids || new Set<string>();
  const bounced = input.hardBouncedUids || new Set<string>();
  const now = input.now || new Date();
  const out: MembershipRow[] = [];

  for (const p of input.prospects) {
    const uid = (p.uid || "").trim();
    if (!uid) continue;

    if (!matchesFilters(p, verticals, locations)) {
      out.push({
        prospectUid: uid,
        status: "skipped",
        skipReason: "Outside campaign vertical/location filters.",
        recipient: "",
        eligibilitySnapshot: { filter: false },
        contactability: evaluateContactability(p),
      });
      continue;
    }

    if (!fitsMinFit(p, minFit)) {
      out.push({
        prospectUid: uid,
        status: "skipped",
        skipReason: "Below campaign min fit threshold.",
        recipient: "",
        eligibilitySnapshot: { minFit: false, fit: fitHeadline(p) },
        contactability: evaluateContactability(p),
      });
      continue;
    }

    const c = evaluateContactability(p, {
      cooldownUntil: cooldowns.get(uid) || null,
      activeOutreach: active.has(uid),
      unsubscribed: unsub.has(uid),
      hardBounced: bounced.has(uid),
      now,
    });

    const recipient = c.emailRoute?.value || "";

    if (requireEmail && !recipient) {
      out.push({
        prospectUid: uid,
        status: "skipped",
        skipReason: "No usable email. Phone/LinkedIn/form do not count.",
        recipient: "",
        eligibilitySnapshot: {
          status: c.status,
          contactable: false,
          blockers: c.blockers,
          reasons: c.reasons,
        },
        contactability: c,
      });
      continue;
    }

    if (!c.contactable) {
      const reason =
        c.blockers.includes("demo") || c.blockers.includes("test")
          ? "DEMO/TEST excluded from live campaign contact."
          : c.blockers.includes("cooldown")
            ? "Cooldown active."
            : c.blockers.includes("active_outreach")
              ? "Outreach already active."
              : c.reasons[0] || `Not contactable (${c.status}).`;
      out.push({
        prospectUid: uid,
        status: c.status === "SUPPRESSED" ? "suppressed" : "skipped",
        skipReason: reason,
        recipient,
        eligibilitySnapshot: {
          status: c.status,
          contactable: false,
          blockers: c.blockers,
          reasons: c.reasons,
          emailProvenance: c.emailProvenance,
        },
        contactability: c,
      });
      continue;
    }

    out.push({
      prospectUid: uid,
      status: "eligible",
      skipReason: "",
      recipient,
      eligibilitySnapshot: {
        status: c.status,
        contactable: true,
        blockers: c.blockers,
        reasons: c.reasons,
        emailProvenance: c.emailProvenance,
        fitHeadline: c.fitHeadline,
      },
      contactability: c,
    });
  }

  return out;
}

export function countByStatus(rows: MembershipRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  return counts;
}
