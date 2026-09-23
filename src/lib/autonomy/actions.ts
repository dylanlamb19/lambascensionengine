import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { markCallOutcome, markRescheduleWaiting, markSalesOutcome, type BillingType } from "./outcomes.ts";
import type { CallNotes } from "./sales.ts";

export const bookingSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { readAutonomy } = await import("./run.server");
    const settings = await readAutonomy(context.userId);
    return { ok: true as const, bookingUrl: settings.bookingUrl };
  });

export const saveBookingLinkFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { url: string }) => data)
  .handler(async ({ data, context }) => {
    const raw = (data.url || "").trim();
    if (raw && !/^https:\/\//i.test(raw)) {
      return { ok: false as const, reason: "Use a full https link, or leave it blank. Nothing was invented." };
    }
    const { saveAutonomy } = await import("./run.server");
    const saved = await saveAutonomy(context.userId, { bookingUrl: raw });
    return { ok: true as const, bookingUrl: saved.bookingUrl };
  });

export const recordOutcomeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    uid: string;
    kind: "SHOWED" | "NO_SHOW" | "RESCHEDULE" | "WON" | "LOST" | "FOLLOW_UP_NEEDED";
    clientValue?: number | null;
    billing?: BillingType;
    note?: string;
    lostReason?: string;
    followUpAt?: string;
    followUpReason?: string;
  }) => data)
  .handler(async ({ data, context }) => {
    const { getProspectByUid, upsertProspects } = await import("../prospects/repo.server");
    const prospect = await getProspectByUid(context.userId, data.uid);
    if (!prospect) return { ok: false as const, reason: "That company is not on your list." };
    const now = new Date();
    const applied = data.kind === "SHOWED" || data.kind === "NO_SHOW"
      ? markCallOutcome(prospect, data.kind, now)
      : data.kind === "RESCHEDULE"
        ? markRescheduleWaiting(prospect)
        : markSalesOutcome(prospect, {
          outcome: data.kind,
          clientValue: data.clientValue,
          billing: data.billing,
          note: data.note,
          lostReason: data.lostReason,
          followUpAt: data.followUpAt,
          followUpReason: data.followUpReason,
        });
    if (!applied.ok) return applied;
    await upsertProspects(context.userId, [applied.prospect]);
    if (data.kind === "NO_SHOW" || data.kind === "WON" || data.kind === "LOST" || data.kind === "SHOWED" || data.kind === "FOLLOW_UP_NEEDED") {
      const { stopSequencesForProspect } = await import("../mail/sql.server");
      await stopSequencesForProspect(context.userId, data.uid);
    }
    return { ok: true as const, prospect: applied.prospect };
  });

export const saveCallSupportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { uid: string; notes?: CallNotes; makeDraft?: boolean; makeProposal?: boolean; price?: number | null; billing?: BillingType }) => data)
  .handler(async ({ data, context }) => {
    const { getProspectByUid, upsertProspects } = await import("../prospects/repo.server");
    const { followupDraft, proposalDraft } = await import("./sales");
    const { opportunities, recommendOffer } = await import("../review-brief");
    const prospect = await getProspectByUid(context.userId, data.uid);
    if (!prospect) return { ok: false as const, reason: "That company is not on your list." };
    const notes = data.notes || prospect.call_notes || {};
    const offer = recommendOffer(prospect);
    const input = {
      company: prospect.name,
      contact: prospect.contacts?.[0]?.name || "",
      website: prospect.website,
      vertical: prospect.vertical,
      city: prospect.city,
      gaps: opportunities(prospect).map((o) => o.code),
      angle: prospect.outreach?.brief.angle || "",
      replySummary: (prospect.history || []).filter((h) => h.action === "reply" || h.action === "autonomy_replied").map((h) => h.detail).join(" "),
      emailsSent: (prospect.history || []).some((h) => h.action === "autonomy_sent" || h.action === "email_sent") ? 1 : 0,
      researchDone: prospect.research_status === "complete" || prospect.research_status === "partial",
      offerName: offer.name,
      offerWhy: offer.why,
      notes,
    };
    const next = { ...prospect, call_notes: notes };
    if (data.makeDraft) {
      next.followup_draft = followupDraft(input);
      next.history = [...(next.history || []), { at: new Date().toISOString(), action: "followup_draft", detail: "Post-call draft saved. Not sent." }];
    }
    if (data.makeProposal) {
      const proposal = proposalDraft({ ...input, price: data.price, billing: data.billing });
      if (!proposal.ok) return proposal;
      next.proposal_draft = proposal.text;
      next.history = [...(next.history || []), { at: new Date().toISOString(), action: "proposal_draft", detail: "Proposal draft saved. Not sent." }];
    }
    if (!data.makeDraft && !data.makeProposal) {
      next.history = [...(next.history || []), { at: new Date().toISOString(), action: "call_notes", detail: "Call notes saved." }];
    }
    await upsertProspects(context.userId, [next]);
    return { ok: true as const, prospect: next, draft: next.followup_draft || "", proposal: next.proposal_draft || "" };
  });
