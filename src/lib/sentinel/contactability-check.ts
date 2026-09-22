/** Inspect-only Acquisition OS contactability checks. Never auto-fix. */
import type { Prospect } from "../review-brief.ts";
import { evaluateContactability } from "../prospects/contactability.ts";
import { reachKind } from "../prospects/reach.ts";
import { makeFinding } from "./ledger.ts";
import type { SentinelFinding } from "./types.ts";

export function evaluateContactabilityInvariants(prospects: Prospect[]): SentinelFinding[] {
  const out: SentinelFinding[] = [];
  for (const p of prospects) {
    const c = evaluateContactability(p);
    const reach = reachKind(p);
    if (reach === "READY_TO_CONTACT" && !c.emailRoute) {
      out.push(makeFinding(
        "CONTACTABLE_WITHOUT_EMAIL",
        `${p.name} is marked ready to contact without a usable email route.`,
        { uid: p.uid, reach },
        { extraKey: p.uid || p.name, affected: [{ uid: p.uid }] },
      ));
    }
    const mapped = c.status === "CONTACTABLE" ? "READY_TO_CONTACT"
      : c.status === "NEEDS_CONTACT_INFORMATION" ? "NEEDS_CONTACT_INFO"
        : c.status === "NEEDS_RESEARCH" ? "NEEDS_RESEARCH"
          : c.status === "SUPPRESSED" ? "SUPPRESSED"
            : "BLOCKED";
    if (mapped !== reach && !(c.status === "CONTACTABLE" && reach === "READY_TO_CONTACT")) {
      out.push(makeFinding(
        "CONTACTABILITY_MISMATCH",
        `${p.name}: reach=${reach} vs contactability=${c.status}.`,
        { uid: p.uid, reach, status: c.status },
        { extraKey: p.uid || p.name, affected: [{ uid: p.uid }] },
      ));
    }
  }
  return out;
}
