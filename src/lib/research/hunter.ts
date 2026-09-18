import type { DecisionMaker } from "./types.ts";

export type HunterResult = {
  ran: boolean;
  skipped_reason: string;
  contacts: DecisionMaker[];
  cents: number;
};

export async function hunterDomainSearch(domain: string, apiKey: string | undefined, now: string): Promise<HunterResult> {
  if (!apiKey) {
    return { ran: false, skipped_reason: "Hunter is turned off (no key). We will not invent emails.", contacts: [], cents: 0 };
  }
  if (!domain || domain.includes("localhost")) {
    return { ran: false, skipped_reason: "No public domain to search.", contacts: [], cents: 0 };
  }
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5&api_key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      return { ran: true, skipped_reason: "Hunter rejected the key.", contacts: [], cents: 1 };
    }
    if (!res.ok) {
      return { ran: true, skipped_reason: `Hunter returned ${res.status}. No emails invented.`, contacts: [], cents: 1 };
    }
    const data = (await res.json()) as {
      data?: { emails?: { value?: string; first_name?: string; last_name?: string; position?: string; linkedin?: string; verification?: { status?: string } }[] };
    };
    const contacts: DecisionMaker[] = [];
    for (const row of data.data?.emails || []) {
      const name = `${row.first_name || ""} ${row.last_name || ""}`.trim();
      if (!name || !row.value) continue;
      const st = (row.verification?.status || "").toLowerCase();
      contacts.push({
        name,
        title: row.position || "UNKNOWN",
        email: row.value,
        email_status: st === "valid" ? "verified" : st ? "unverified" : "unknown",
        profile_url: row.linkedin || "",
        source: "hunter.io domain-search",
        last_verified: now,
      });
    }
    return { ran: true, skipped_reason: contacts.length ? "" : "Hunter returned no people for this domain.", contacts, cents: 2 };
  } catch {
    return { ran: true, skipped_reason: "Hunter request failed. No emails invented.", contacts: [], cents: 0 };
  }
}
