import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { inspectCode } from "./query.ts";

const AUDIT: Record<string, string> = {
  codebase_search: "ARA_CODE_SEARCH",
  codebase_read_file: "ARA_CODE_FILE_READ",
  codebase_find_symbol: "ARA_CODE_SYMBOL_LOOKUP",
  codebase_find_references: "ARA_CODE_SYMBOL_LOOKUP",
  codebase_trace: "ARA_CODE_TRACE",
  codebase_diff: "ARA_CODE_DIFF",
  codebase_tree: "ARA_CODE_SEARCH",
  codebase_status: "ARA_CODE_SEARCH",
};

export const inspectCodebaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { action: string; args?: Record<string, unknown>; expectSha?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { loadCodeIndex } = await import("./load.server.ts");
    const index = loadCodeIndex();
    const result = inspectCode(index, data.action, data.args || {}, data.expectSha);
    try {
      const { logActivity } = await import("@/lib/prospects/repo.server");
      const path = String(data.args?.path || data.args?.name || data.args?.query || data.args?.topic || "");
      await logActivity(context.userId, AUDIT[data.action] || "ARA_CODE_SEARCH", `${index.sha} ${path}`.slice(0, 180), undefined, "VOICE");
    } catch {
      /* audit must not block a read */
    }
    return result;
  });
