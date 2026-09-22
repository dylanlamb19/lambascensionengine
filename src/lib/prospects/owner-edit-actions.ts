import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Prospect } from "@/lib/review-brief";
import {
  applyProspectInfoChanges,
  pickKnownChanges,
  sanitizeChanges,
  spokenAfterSave,
  type ProspectInfoChanges,
} from "./owner-edit";
import { reachKind } from "./reach";

export type UpdateProspectInformationInput = {
  prospectUid: string;
  changes: ProspectInfoChanges;
  confirmDestructive?: boolean;
  inputMethod?: "MANUAL" | "VOICE";
};

export const updateProspectInformationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: UpdateProspectInformationInput) => data)
  .handler(async ({ data, context }) => {
    const { getProspectByUid, upsertProspects, logActivity } = await import("./repo.server");
    const uid = String(data.prospectUid || "").trim();
    if (!uid) {
      return { ok: false as const, reason: "Which prospect should I add that to?", emailSent: false };
    }
    const current = await getProspectByUid(context.userId, uid);
    if (!current) {
      return { ok: false as const, reason: "I couldn’t find that prospect, so nothing changed.", emailSent: false };
    }
    const picked = pickKnownChanges({ ...(data.changes || {}) });
    if (picked.unknown.length) {
      return {
        ok: false as const,
        reason: `I can only save known prospect fields. I ignored: ${picked.unknown.join(", ")}.`,
        emailSent: false,
      };
    }
    const san = sanitizeChanges(picked.changes);
    if (!san.ok) {
      return {
        ok: false as const,
        reason: san.errors.map((e) => e.message).join(" "),
        errors: san.errors,
        emailSent: false,
      };
    }
    if (!Object.keys(san.changes).length) {
      return { ok: false as const, reason: "Nothing to save.", emailSent: false };
    }
    const applied = applyProspectInfoChanges(current, san.changes, { actor: "owner" });
    const saved = await upsertProspects(context.userId, [applied.prospect]);
    const prospect: Prospect = saved.find((p) => p.uid === uid) || applied.prospect;
    const detail = applied.history.map((h) => h.detail).join(" ");
    await logActivity(
      context.userId,
      "PROSPECT_INFORMATION_UPDATED",
      detail.slice(0, 1800),
      uid,
      data.inputMethod || "MANUAL",
    );
    return {
      ok: true as const,
      prospect,
      audits: applied.audits,
      spoken: spokenAfterSave(applied.audits, prospect.name),
      reach: reachKind(prospect),
      emailSent: false,
      outreachAuthorized: false,
    };
  });
