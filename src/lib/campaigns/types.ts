/** Email Campaigns OS — campaign-level auth, never invents emails/metrics. */

export type CampaignStatus =
  | "draft"
  | "armed"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

export type CampaignMemberStatus =
  | "queued"
  | "eligible"
  | "skipped"
  | "authorized"
  | "sent"
  | "replied"
  | "suppressed"
  | "failed";

export type CampaignFilters = {
  verticals: string[];
  locations: string[];
  requireUsableEmail: boolean;
  minFit: "possible" | "strong" | "good";
  maxFirstContactsPerDay: number;
};

export type EmailCampaign = {
  id: string;
  userId: string;
  name: string;
  status: CampaignStatus;
  verticals: string[];
  locations: string[];
  requireUsableEmail: boolean;
  minFit: string;
  maxFirstContactsPerDay: number;
  /** When true, worker never sends outside Test Mode allowlist path. Default true. */
  testModeOnly: boolean;
  /** Explicit live toggle. Default false. Requires owner action; never inferred. */
  liveEnabled: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
  createdAt: string;
  updatedAt: string;
};

export type CampaignMember = {
  campaignId: string;
  prospectUid: string;
  status: CampaignMemberStatus;
  skipReason: string;
  messageSubject: string;
  messageBody: string;
  messageHash: string;
  eligibilitySnapshot: Record<string, unknown>;
  authorizedAt: string | null;
  sendKey: string;
  recipient: string;
  sentAt: string | null;
  lastError: string;
};

export type CampaignReport = {
  campaignId: string;
  name: string;
  status: CampaignStatus;
  testModeOnly: boolean;
  liveEnabled: boolean;
  counts: {
    total: number;
    queued: number;
    eligible: number;
    skipped: number;
    authorized: number;
    sent: number;
    replied: number;
    suppressed: number;
    failed: number;
  };
};

export const DEFAULT_SUBJECT =
  "Quick note for {{company}}";

export const DEFAULT_BODY =
  "Hi{{#decision_maker}} {{decision_maker}}{{/decision_maker}},\n\n" +
  "I help {{vertical}} businesses in {{city}} book more of the right conversations without guessing contact info.\n\n" +
  "Worth a short look?\n\n— Dylan";
