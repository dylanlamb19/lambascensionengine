/** Last completed Find Clients result. View-only identity — never a new Places search. */

export type LastDiscovery = {
  query: string;
  vertical: string;
  location: string;
  requested: number;
  matched: number;
  prospectUids: string[];
  placeIds: string[];
  timestamp: string;
};

const STORE = "la_last_discovery_v1";

export function emptyLastDiscovery(): LastDiscovery {
  return {
    query: "",
    vertical: "",
    location: "",
    requested: 0,
    matched: 0,
    prospectUids: [],
    placeIds: [],
    timestamp: "",
  };
}

export function isLastDiscovery(v: unknown): v is LastDiscovery {
  if (!v || typeof v !== "object") return false;
  const d = v as LastDiscovery;
  return Array.isArray(d.prospectUids) && Array.isArray(d.placeIds);
}

export function loadLastDiscovery(): LastDiscovery | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isLastDiscovery(parsed) && parsed.prospectUids.length ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLastDiscovery(d: LastDiscovery | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (!d || !d.prospectUids.length) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, JSON.stringify(d));
  } catch {
    /* quota / private mode */
  }
}

export function lastDiscoveryFromMatch(opts: {
  vertical: string;
  location: string;
  requested: number;
  prospectUids: string[];
  placeIds: string[];
}): LastDiscovery {
  const vertical = (opts.vertical || "").trim();
  const location = (opts.location || "").trim();
  return {
    query: [vertical, location].filter(Boolean).join(" in ") || "Find Clients",
    vertical,
    location,
    requested: Math.max(0, Math.floor(opts.requested || 0)),
    matched: opts.prospectUids.length,
    prospectUids: opts.prospectUids.filter(Boolean),
    placeIds: opts.placeIds.filter(Boolean),
    timestamp: new Date().toISOString(),
  };
}
