import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { IndustryAttack, OwnerGoal } from "./types.ts";

export const listAttacksFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listAttacks } = await import("./sql.server");
    const attacks = await listAttacks(context.userId);
    return { ok: true as const, attacks };
  });

export const upsertAttackFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { attack: IndustryAttack }) => data)
  .handler(async ({ data, context }) => {
    const { upsertAttack } = await import("./sql.server");
    const attack = await upsertAttack(context.userId, data.attack);
    return { ok: true as const, attack };
  });

export const ownerGoalFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getGoal } = await import("./sql.server");
    const goal = await getGoal(context.userId);
    return { ok: true as const, goal };
  });

export const setOwnerGoalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: OwnerGoal) => data)
  .handler(async ({ data, context }) => {
    const monthly = data.monthly_mrr_target == null ? null : Math.max(0, Math.round(Number(data.monthly_mrr_target) || 0));
    const retainer = data.average_retainer_target == null ? null : Math.max(0, Math.round(Number(data.average_retainer_target) || 0));
    const goal: OwnerGoal = {
      monthly_mrr_target: monthly === 0 ? null : monthly,
      average_retainer_target: retainer === 0 ? null : retainer,
    };
    const { setGoal } = await import("./sql.server");
    const saved = await setGoal(context.userId, goal);
    return { ok: true as const, goal: saved };
  });
