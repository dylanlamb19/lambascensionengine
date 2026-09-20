import type { DecisionMaker } from "./types.ts";

const TITLE_RE =
  /\b(owner|co-?owner|founder|co-?founder|ceo|president|principal|marketing director|director of marketing|marketing manager|general manager|gm|managing partner)\b/i;

const STOP = /\b(our team|about us|meet the|company|services|repair|roofing|foundation|welcome)\b/i;
const NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+))\b/g;

export function extractEmails(html: string): string[] {
  const out = new Set<string>();
  const re = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.add(m[1].toLowerCase());
  return [...out].slice(0, 8);
}

export function extractSocials(html: string, pageUrl: string): { network: string; url: string; source: string }[] {
  const out: { network: string; url: string; source: string }[] = [];
  const re = /href=["'](https?:\/\/(?:www\.)?(facebook|instagram|linkedin)\.com\/[^"'#?\s]+)["']/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const url = m[1].split("?")[0];
    const net = m[2].toLowerCase();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ network: net, url, source: pageUrl });
  }
  return out.slice(0, 8);
}

export function extractPeople(html: string, pageUrl: string, now: string): DecisionMaker[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const people: DecisionMaker[] = [];
  const seen = new Set<string>();
  const titleRe = new RegExp(TITLE_RE.source, "gi");
  let titleMatch: RegExpExecArray | null;
  while ((titleMatch = titleRe.exec(text))) {
    const before = text.slice(Math.max(0, titleMatch.index - 80), titleMatch.index);
    const names = [...before.matchAll(new RegExp(NAME_RE.source, "g"))].map((x) => x[1].trim());
    const name = [...names].reverse().find((n) => n.split(" ").length >= 2 && !STOP.test(n));
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({
      name,
      title: titleMatch[1].replace(/\b\w/g, (c) => c.toUpperCase()),
      email: "",
      email_status: "none",
      profile_url: "",
      source: pageUrl,
      last_verified: now,
    });
    if (people.length >= 5) break;
  }
  return people;
}

export function attachPublishedEmails(people: DecisionMaker[], emails: string[]): DecisionMaker[] {
  if (people.length === 1 && emails.length === 1) {
    return [{ ...people[0], email: emails[0], email_status: "unverified" }];
  }
  return people.map((p) => {
    const first = p.name.split(" ")[0]?.toLowerCase();
    const hit = emails.find((e) => first && e.split("@")[0].includes(first));
    if (!hit) return p;
    return { ...p, email: hit, email_status: "unverified" as const };
  });
}
