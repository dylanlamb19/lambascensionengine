import type { CompanyKind } from "../research/company-type.ts";

export type ClaimKind = "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";

export type Claim = {
  label: string;
  value: string;
  kind: ClaimKind;
  source?: string;
};

export type AttackStatus = "researching" | "ready" | "building_list" | "active" | "paused";

export type OpportunityCode =
  | "HIGH-INTENT SEARCH OPPORTUNITY"
  | "CONVERSION RATE OPPORTUNITY"
  | "LANDING PAGE OPPORTUNITY"
  | "META DEMAND GENERATION OPPORTUNITY"
  | "TRACKING / ATTRIBUTION GAP"
  | "FOLLOW-UP SYSTEM OPPORTUNITY"
  | "LEAD HANDLING OPPORTUNITY"
  | "NO CLEAR OPPORTUNITY YET";

export type ProspectPriority =
  | "STRONG CANDIDATE FOR OUTREACH"
  | "WORTH REVIEWING"
  | "NEEDS MORE RESEARCH"
  | "LOW PRIORITY"
  | "DO NOT CONTACT";

export type IcpConfig = {
  kind: CompanyKind;
  places_vertical: string;
  target_customer: string;
  review_count_matters: boolean;
  likely_channels: Claim[];
  qualification_signals: string[];
  disqualifying_signals: string[];
  questions_to_verify: string[];
};

export type IndustryEconomics = {
  customer_value: Claim;
  sales_cycle: Claim;
  google_ads: Claim;
  meta_ads: Claim;
  funnel: Claim;
  maturity: Claim;
};

export type IndustryAttack = {
  id: string;
  industry: string;
  geography: string;
  target_count: number;
  status: AttackStatus;
  spoken: string;
  offer: string;
  outreach_angle: string;
  icp: IcpConfig;
  economics: IndustryEconomics;
  claims: Claim[];
  research_notes: string;
  plain_summary: string;
  sources: { title: string; url: string; domain: string }[];
  created_at: string;
  updated_at: string;
};

export type OwnerGoal = {
  monthly_mrr_target: number | null;
  average_retainer_target: number | null;
};

export type ProposalDoc = {
  status: "draft" | "ready" | "sent";
  monthly_fee: number | null;
  ad_spend_note: string;
  body: string;
  generated_at: string;
};

export type RevenueLane =
  | "researching"
  | "ready"
  | "contacted"
  | "replied"
  | "qualified"
  | "calls"
  | "proposals"
  | "won"
  | "lost";

export type RevenueSnapshot = {
  researching: number;
  ready: number;
  contacted: number;
  replied: number;
  qualified: number;
  calls: number;
  proposals: number;
  won: number;
  lost: number;
  verified_mrr: number;
  clients_needed: number | null;
  goal: OwnerGoal;
};

export type OpportunityHypothesis = {
  code: OpportunityCode;
  title: string;
  plain: string;
  evidence: string;
};

export type PriorityResult = {
  priority: ProspectPriority;
  why: string[];
};

export type GetClientsItem = {
  uid: string;
  name: string;
  priority: ProspectPriority;
  why: string[];
  codes: OpportunityCode[];
  unknown: string[];
  stage: string;
  research_status: string;
};

export type GetClientsBriefing = {
  found: number;
  researched: number;
  attention: number;
  outreachReady: number;
  replies: number;
  calls: number;
  spoken: string;
  items: GetClientsItem[];
};

export type LearningInsight = {
  ready: boolean;
  text: string;
  sample: { contacted: number; replies: number; calls: number; won: number };
};

export type CallPrepDoc = {
  company: string;
  what_we_know: string[];
  why_contacted: string;
  marketing: string[];
  opportunities: string[];
  unknown_economics: string[];
  questions: string[];
  objections: string[];
  offer: string;
  next_step: string;
};
