import { companyKind } from "../research/company-type.ts";
import type { IcpConfig, IndustryEconomics } from "./types.ts";

export function emptyEconomics(): IndustryEconomics {
  const unknown = (label: string): IndustryEconomics[keyof IndustryEconomics] => ({
    label,
    value: "UNKNOWN — MUST VERIFY ON SALES CALL",
    kind: "UNKNOWN",
  });
  return {
    customer_value: unknown("Customer value"),
    sales_cycle: unknown("Sales cycle"),
    google_ads: unknown("Google Ads"),
    meta_ads: unknown("Meta Ads"),
    funnel: unknown("Funnel"),
    maturity: unknown("Marketing maturity"),
  };
}

export function defaultOffer(industry: string): string {
  const name = (industry || "this industry").trim() || "this industry";
  return `A paid acquisition system for ${name} companies that already get inbound demand but leak it.`;
}

export function defaultAngle(industry: string): string {
  const name = (industry || "this industry").trim() || "this industry";
  return `${name}: find companies with a public offer, then verify economics on the call. Do not invent ad spend.`;
}

export function icpFor(industry: string, geography: string): IcpConfig {
  const kind = companyKind(industry);
  const geo = geography.trim();
  return {
    kind,
    places_vertical: industry.trim() || "High-ticket local service",
    target_customer: geo
      ? `${industry.trim() || "High-ticket"} businesses in ${geo}`
      : `${industry.trim() || "High-ticket"} businesses`,
    review_count_matters: kind === "local_service" || kind === "medical",
    likely_channels: [
      { label: "Likely channels", value: "Google Ads, Google Maps, Meta, and referral — UNKNOWN until verified", kind: "UNKNOWN" },
    ],
    qualification_signals: ["Public offer", "Working website", "A way to inquire"],
    disqualifying_signals: ["No website", "Do Not Contact", "Already a client"],
    questions_to_verify: ["Average job / case value", "Close rate", "Monthly ad budget"],
  };
}
