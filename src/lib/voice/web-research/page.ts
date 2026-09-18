import type { ResearchResult } from "./types.ts";
import { htmlToText, sourceDomain, spokenFromAnswer } from "./parse.ts";

export async function readPublicPage(url: string): Promise<ResearchResult> {
  const { fetchPublicPage } = await import("@/lib/research/fetch-page");
  const page = await fetchPublicPage(url, 12000);
  if (page.blocked) {
    return {
      ok: false, mode: "page", answer: "", spoken: "That page is blocked, private, or behind a login. I won’t try to bypass it.",
      sources: [], cached: false, reason: page.error || "blocked", provider: "page", untrusted: true,
    };
  }
  if (!page.ok) {
    const timeout = page.error === "timeout";
    return {
      ok: false, mode: "page", answer: "", spoken: timeout ? "That page didn’t load in time." : "I couldn’t read that page.",
      sources: [], cached: false, reason: page.error || "fetch_failed", provider: "page", untrusted: true,
    };
  }
  const text = htmlToText(page.html);
  const domain = sourceDomain(page.final_url || url);
  const answer = text ? text.slice(0, 4000) : "The page loaded, but I couldn’t extract readable text.";
  return {
    ok: true,
    mode: "page",
    answer,
    spoken: spokenFromAnswer(answer.slice(0, 400), 1),
    sources: [{ title: domain || "Web page", url: page.final_url || url, domain, publisher: domain, published: "" }],
    cached: false,
    reason: "",
    provider: "page",
    untrusted: true,
  };
}
