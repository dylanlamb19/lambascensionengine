export type ResearchMode = "quick" | "deep" | "page";

export type ClaimKind = "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";

export type AraSource = {
  title: string;
  url: string;
  domain: string;
  publisher: string;
  published: string;
};

export type ResearchResult = {
  ok: boolean;
  mode: ResearchMode;
  answer: string;
  spoken: string;
  sources: AraSource[];
  cached: boolean;
  reason: string;
  provider: string;
  untrusted: true;
};

export type ResearchRequest = {
  query: string;
  mode: ResearchMode;
  url?: string;
  prospectUid?: string;
  prospectContext?: string;
};

export type WebResearchProvider = {
  id: string;
  research(req: ResearchRequest): Promise<ResearchResult>;
};
