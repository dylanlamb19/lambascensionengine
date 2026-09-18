export function parseIndustryAsk(spoken: string): { industry: string; geography: string; count?: number } {
  const text = (spoken || "").trim();
  return { industry: text.slice(0, 80) || "unspecified", geography: "" };
}
