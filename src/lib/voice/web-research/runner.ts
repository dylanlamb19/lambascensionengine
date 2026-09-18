import type { ResearchMode, ResearchRequest, ResearchResult } from "./types.ts";
import { dedupeInflight, queryHash, readCache, tryReserveResearch, writeCache } from "./limits.ts";
import { getWebResearchProvider } from "./xai-responses.ts";
import { readPublicPage } from "./page.ts";

function fail(mode: ResearchMode, spoken: string, reason: string): ResearchResult {
  return { ok: false, mode, answer: "", spoken, sources: [], cached: false, reason, provider: "none", untrusted: true };
}

export async function runAraResearch(userId: string, req: ResearchRequest): Promise<ResearchResult> {
  const query = (req.query || req.url || "").trim().slice(0, 1500);
  const mode: ResearchMode = req.mode === "deep" || req.mode === "page" ? req.mode : "quick";
  if (!query) return fail(mode, "What should I look up?", "empty");
  const hash = queryHash(query, mode, req.url);
  const cached = await readCache(userId, hash, mode);
  if (cached) return cached;

  return dedupeInflight(`${userId}:${hash}`, async () => {
    const again = await readCache(userId, hash, mode);
    if (again) return again;
    const reserved = await tryReserveResearch(userId, mode);
    if (!reserved.ok) return fail(mode, reserved.reason, "cap");

    let result: ResearchResult;
    if (mode === "page" && req.url) {
      result = await readPublicPage(req.url);
    } else {
      result = await getWebResearchProvider().research({ ...req, query, mode });
    }
    if (result.ok) await writeCache(userId, hash, mode, result);
    return result;
  });
}
