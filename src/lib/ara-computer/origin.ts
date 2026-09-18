const FORBIDDEN_HOSTS = [
  /(^|\.)x\.ai$/i,
  /(^|\.)grok\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)grok-sandbox\.com$/i,
  /(^|\.)cloudflare\.com$/i,
];

const BLOCKED_HEADING =
  /sorry,\s*you have been blocked|unable to access x\.ai|access denied|attention required|cloudflare|just a moment/i;

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isForbiddenOrigin(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const host = hostOf(raw.includes("://") ? raw : `https://${raw}`);
  if (!host) return false;
  return FORBIDDEN_HOSTS.some((re) => re.test(host));
}

export function isBlockedHeading(text: string | null | undefined): boolean {
  return BLOCKED_HEADING.test(text || "");
}

export function loopbackOrigin(port?: string): string {
  const p = (port || process.env.PORT || "8080").toString().replace(/^:/, "");
  return `http://127.0.0.1:${p}`;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/**
 * Origin Ara’s isolated browser may load. Never x.ai / grok.com / Grok preview.
 * Playwright talks to the running Lamb Ascension process on loopback so the
 * visible computer is Owner Mode, not the consumer Grok website.
 */
export function operatorAppOrigin(opts: {
  clientOrigin?: string;
  requestOrigin?: string;
  preview?: boolean;
  port?: string;
}): string {
  const loopback = loopbackOrigin(opts.port);
  if (opts.preview !== false) return loopback;
  for (const raw of [opts.requestOrigin, opts.clientOrigin]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (isForbiddenOrigin(u.origin)) continue;
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (isLoopbackHost(u.hostname.replace(/^www\./, ""))) return u.origin;
      // Deployed first-party hosts only. Grok/x.ai preview hosts are forbidden above.
      return u.origin;
    } catch {
      continue;
    }
  }
  return loopback;
}

export function operatorUrl(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/?ara_computer=1`;
}

export function lookingAtLabel(meta: {
  view?: string;
  companyName?: string;
  evidence?: boolean;
  heading?: string;
  url?: string;
}): string {
  if (isForbiddenOrigin(meta.url) || isBlockedHeading(meta.heading) || isBlockedHeading(meta.view)) {
    return "Ara is looking at Lamb Ascension";
  }
  const company = (meta.companyName || "").trim();
  const view = (meta.view || "").trim();
  if (view === "pipe") return "Ara is looking at Pipeline";
  if (view === "calendar") return "Ara is looking at Calendar";
  if (view === "settings") return "Ara is looking at Settings";
  if (view === "find") return "Ara is looking at Find Clients";
  if (view === "add") return "Ara is looking at Add Client";
  if (view === "outreach") return company ? `Ara is looking at outreach for ${company}` : "Ara is looking at Outreach";
  if (view === "call") return company ? `Ara is looking at the call opener for ${company}` : "Ara is looking at the call opener";
  if (view === "prep") return company ? `Ara is looking at call prep for ${company}` : "Ara is looking at call prep";
  if (view === "detail") {
    if (meta.evidence && company) return `Ara is looking at evidence for ${company}`;
    if (company) return `Ara is reviewing ${company}`;
    return "Ara is looking at Prospect Review";
  }
  if (view === "home" || view === "") return "Ara is looking at Home";
  return "Ara is looking at Lamb Ascension";
}

export function safeLookingAt(text: string | null | undefined): string {
  const t = (text || "").trim();
  if (!t || isBlockedHeading(t) || /x\.ai|grok\.com/i.test(t)) {
    return "Ara is looking at Lamb Ascension";
  }
  return t;
}
