export type EmailState = "DRAFT" | "READY FOR REVIEW" | "APPROVED" | "SENDING" | "SENT" | "REPLIED" | "BOUNCED" | "UNSUBSCRIBED" | "FAILED" | "UNKNOWN_DELIVERY";

export type FactKind = "VERIFIED FACT" | "CLIENT-PROVIDED FACT" | "AI RECOMMENDATION" | "UNKNOWN";

export type OutreachMessage = {
  kind: "email" | "followup1" | "followup2" | "followup3" | "linkedin" | "call_opener" | "reply";
  subject?: string;
  body: string;
  state: EmailState;
  angle: string;
  angle_why: string;
  evidence_used: string[];
};

export type OutreachPack = {
  fingerprint: string;
  generated_at: string;
  generator: "evidence" | "llm+evidence";
  estimated_cents: number;
  brief: {
    who: string;
    why: string;
    decision_maker: string;
    help: string;
    angle: string;
    unknown: string[];
  };
  messages: OutreachMessage[];
  call: {
    who: string;
    why: string;
    point: string;
    opener: string;
    next_question: string;
  };
};

export type ContactEvent = {
  at: string;
  action: string;
  detail: string;
};

export type DiscoveryAnswers = {
  customer_value?: string;
  gross_margin?: string;
  monthly_ad_budget?: string;
  capacity?: string;
  close_rate?: string;
  lead_handling?: string;
  target_growth?: string;
  current_channels?: string;
};

export type ValueFit =
  | "HIGH-VALUE OFFER MAY MAKE SENSE"
  | "STANDARD OFFER MAY FIT BETTER"
  | "NEED MORE INFORMATION"
  | "NOT A FIT";

export type ReplyClass = "POSITIVE" | "QUESTION" | "NOT NOW" | "OBJECTION" | "NOT INTERESTED" | "UNSUBSCRIBE" | "OTHER";
