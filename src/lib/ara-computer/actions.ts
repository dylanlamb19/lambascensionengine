import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { ComputerActInput, ComputerSnapshot } from "./types";

/** Legacy computer session is retired. Ara shares the Owner Mode screen. */
function disabled(): ComputerSnapshot {
  return {
    ok: false,
    reason: "Ara shares this Lamb Ascension screen. There is no separate computer.",
    driver: "stopped",
    controls: [],
    width: 0,
    height: 0,
    lookingAt: "Ara is looking at Lamb Ascension",
  };
}

export const computerStartFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { origin?: string; bearer?: string }) => data)
  .handler(async () => disabled());

export const computerSnapshotFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => disabled());

export const computerActFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: ComputerActInput) => data)
  .handler(async () => disabled());

export const computerStopFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => disabled());
