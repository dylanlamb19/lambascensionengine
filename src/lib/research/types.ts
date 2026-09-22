export type FactStatus = "VERIFIED" | "OBSERVED" | "UNKNOWN" | "ERROR";

export type EvidenceFact = {
  key: string;
  value: string;
  source: string;
  checked_at: string;
  confidence: "high" | "medium" | "low";
  status: FactStatus;
};

export type DecisionMaker = {
  name: string;
  title: string;
  email: string;
  email_status: "verified" | "unverified" | "unknown" | "none";
  profile_url: string;
  source: string;
  last_verified: string;
  phone?: string;
  phone_source?: string;
  name_source?: string;
  title_source?: string;
  email_source?: string;
  profile_source?: string;
};

export type AdObservation = {
  network: "meta" | "google" | "tracking";
  label: "ADVERTISING DETECTED" | "NO ADVERTISING DETECTED IN CHECKED SOURCE" | "UNKNOWN";
  detail: string;
  source: string;
  checked_at: string;
};

export type Readiness =
  | "STRONG CANDIDATE FOR FURTHER QUALIFICATION"
  | "POSSIBLE CANDIDATE"
  | "NOT ENOUGH INFORMATION"
  | "LOW PRIORITY";

export type DeepInput = {
  name: string;
  website: string;
  vertical: string;
  city: string;
  phone: string;
  google_rating: string;
  review_count: number;
  locations_count?: number;
  years_in_business?: number;
  score: number;
  research_status: string;
  findings?: { id: string; result: string; status: string }[];
};

export type Caps = {
  minScoreForEnrichment: number;
  dailyEnrichmentUsed: number;
  dailyEnrichmentCap: number;
  hunterKey?: string;
};

export type PaidHunter = (domain: string) => Promise<{
  ran: boolean;
  skipped_reason: string;
  contacts: DecisionMaker[];
  cents: number;
}>;

export type DeepResult = {
  facts: EvidenceFact[];
  contacts: DecisionMaker[];
  ads: AdObservation[];
  socials: { network: string; url: string; source: string }[];
  readiness: Readiness;
  website_note: string;
  hunter_ran: boolean;
  hunter_skipped_reason: string;
  estimated_cents: number;
  pages_fetched: number;
  readiness_why: string[];
  company_kind: string;
  findings: import("../review-brief.ts").Finding[];
};
