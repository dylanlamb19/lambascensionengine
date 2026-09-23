/**
 * Owner / Ara server actions for bounded email enrich.
 * Stored payload only. Max 3. Never invent. No LinkedIn scrape.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const enrichMissingEmailsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { maxAttempts?: number; limit?: number } = {}) => data)
  .handler(async ({ data, context }) => {
    const { listProspects, upsertProspects } = await import("./repo.server");
    const {
      applyEmailHit,
      applyEmailEnrichMiss,
      needsEmailEnrichment,
      planEmailEnrichAttempt,
      MAX_EMAIL_ENRICH_ATTEMPTS_DEFAULT,
    } = await import("./email-enrich");

    const maxAttempts = Math.max(1, Math.min(5, data.maxAttempts || MAX_EMAIL_ENRICH_ATTEMPTS_DEFAULT));
    const limit = Math.max(1, Math.min(100, data.limit || 40));
    const prospects = await listProspects(context.userId);
    const targets = prospects.filter(needsEmailEnrichment).slice(0, limit);

    let enriched = 0;
    let unresolved = 0;
    let skipped = 0;
    const notes: Array<{ uid: string; note: string; hit: boolean }> = [];

    for (const p of targets) {
      const plan = planEmailEnrichAttempt(p, undefined, maxAttempts);
      if (!plan.eligible) {
        skipped += 1;
        continue;
      }
      if (plan.hit) {
        await upsertProspects(context.userId, [applyEmailHit(p, plan.hit)]);
        enriched += 1;
        notes.push({ uid: plan.uid, note: plan.note, hit: true });
      } else {
        await upsertProspects(context.userId, [applyEmailEnrichMiss(p, plan)]);
        if (plan.unresolved) unresolved += 1;
        notes.push({ uid: plan.uid, note: plan.note, hit: false });
      }
    }

    return {
      ok: true as const,
      inspected: targets.length,
      enriched,
      unresolved,
      skipped,
      maxAttempts,
      invented: false as const,
      linkedInScraped: false as const,
      notes: notes.slice(0, 25),
    };
  });
