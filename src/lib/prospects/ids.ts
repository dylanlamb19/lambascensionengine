import type { Prospect } from "../review-brief.ts";

export function newUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ensureUid(p: Prospect): Prospect {
  return p.uid ? p : { ...p, uid: newUid() };
}

export function websiteDomain(website: string | undefined): string {
  if (!website || website === "UNKNOWN") return "";
  try {
    const raw = website.includes("://") ? website : `https://${website}`;
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function nextClientId(rows: { id: number }[]): number {
  return Math.max(0, ...rows.map((r) => r.id || 0)) + 1;
}

export function normalizeName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
