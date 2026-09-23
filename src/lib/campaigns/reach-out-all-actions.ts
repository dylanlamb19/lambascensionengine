import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Ara / Owner: reach out to all EMAIL-contactable prospects.
 * Creates + arms a Test Mode campaign with tailored drafts.
 * Does NOT turn Test Mode off. Does NOT enable live.
 */
export const reachOutToAllContactableFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { softCap?: number; name?: string } = {}) => data)
  .handler(async ({ data, context }) => {
    const { reachOutToAllContactable } = await import("./reach-out-all.server");
    return reachOutToAllContactable(context.userId, data);
  });
