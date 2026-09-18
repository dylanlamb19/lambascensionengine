import type { AdObservation } from "./types.ts";

function has(findings: { id: string; result: string; status: string }[] | undefined, id: string): boolean {
  const f = findings?.find((x) => x.id === id);
  if (!f) return false;
  const r = (f.result || "").toLowerCase();
  return !r.startsWith("no ") && f.status !== "ERROR" && f.status !== "UNKNOWN";
}

/** Pixel/GTM is tracking, not proof of ads. Never invert a miss into "doesn't advertise." */
export function adsFromFindings(findings: { id: string; result: string; status: string }[] | undefined, now: string): AdObservation[] {
  const out: AdObservation[] = [];
  if (!findings?.length) {
    return [
      { network: "meta", label: "UNKNOWN", detail: "No ad-library check ran. We did not look at Meta’s ad library.", source: "none", checked_at: now },
      { network: "google", label: "UNKNOWN", detail: "No Google Ads Transparency check ran.", source: "none", checked_at: now },
    ];
  }
  const pixel = has(findings, "meta_pixel");
  const gtm = has(findings, "gtm") || has(findings, "gtag");
  const adsTag = has(findings, "ads_conversion_tag");
  out.push({
    network: "tracking",
    label: "UNKNOWN",
    detail: pixel || gtm
      ? "A tracking snippet is on a page we checked. That is not the same as seeing an ad."
      : "No common tracking snippet on pages we checked. That is not proof they don’t advertise.",
    source: "website HTML",
    checked_at: now,
  });
  out.push({
    network: "meta",
    label: "UNKNOWN",
    detail: "Meta Ad Library was not queried. Status stays UNKNOWN.",
    source: "not checked",
    checked_at: now,
  });
  out.push({
    network: "google",
    label: adsTag ? "UNKNOWN" : "UNKNOWN",
    detail: adsTag
      ? "A Google Ads conversion tag was on a checked page. That still is not a live ad we viewed."
      : "Google advertising was not confirmed in an ad library. Status stays UNKNOWN.",
    source: adsTag ? "website HTML" : "not checked",
    checked_at: now,
  });
  return out;
}
