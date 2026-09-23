import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { markCallOutcome, markRescheduleWaiting, markSalesOutcome, type BillingType } from "./outcomes.ts";

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
        });
    if (!applied.ok) return applied;
    await upsertProspects(context.userId, [applied.prospect]);
    if (data.kind === "NO_SHOW" || data.kind === "WON" || data.kind === "LOST" || data.kind === "SHOWED") {
      const { stopSequencesForProspect } = await import("../mail/sql.server");
      await stopSequencesForProspect(context.userId, data.uid);
    }
    return { ok: true as const, prospect: applied.prospect };
  });
