import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Prospect } from "@/lib/review-brief";

export const listProspectsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listProspects } = await import("./repo.server");
    const prospects = await listProspects(context.userId);
    return { ok: true as const, prospects };
  });

export const importProspectsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { prospects: Prospect[] }) => data)
  .handler(async ({ data, context }) => {
    const { importProspects, logActivity } = await import("./repo.server");
    const result = await importProspects(context.userId, data.prospects || []);
    await logActivity(context.userId, "import", `imported ${result.imported}, merged ${result.merged}`);
    return { ok: true as const, ...result };
  });

export const upsertProspectsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { prospects: Prospect[] }) => data)
  .handler(async ({ data, context }) => {
    const { upsertProspects } = await import("./repo.server");
    const prospects = await upsertProspects(context.userId, data.prospects || []);
    return { ok: true as const, prospects };
  });
