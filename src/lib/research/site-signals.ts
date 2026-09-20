export type SiteSignals = {
  case_studies: boolean;
  client_logos: boolean;
  enterprise_language: boolean;
  national_reach: boolean;
  hiring: boolean;
  team_page: boolean;
  commercial_positioning: boolean;
};

const EMPTY: SiteSignals = {
  case_studies: false,
  client_logos: false,
  enterprise_language: false,
  national_reach: false,
  hiring: false,
  team_page: false,
  commercial_positioning: false,
};

export function emptySignals(): SiteSignals {
  return { ...EMPTY };
}

export function mergeSignals(a: SiteSignals, b: SiteSignals): SiteSignals {
  return {
    case_studies: a.case_studies || b.case_studies,
    client_logos: a.client_logos || b.client_logos,
    enterprise_language: a.enterprise_language || b.enterprise_language,
    national_reach: a.national_reach || b.national_reach,
    hiring: a.hiring || b.hiring,
    team_page: a.team_page || b.team_page,
    commercial_positioning: a.commercial_positioning || b.commercial_positioning,
  };
}

/** Observed wording on pages we opened. Not proof of actual Fortune 500 clients or headcount. */
export function extractSiteSignals(html: string): SiteSignals {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return {
    case_studies: /case stud(?:y|ies)|client stor(?:y|ies)|success stor(?:y|ies)/.test(text),
    client_logos: /trusted by|our clients|our customers|as seen (?:in|on)|brands (?:we|that) (?:work|trust)/.test(text),
    enterprise_language: /enterprise|fortune 500|for (?:businesses|companies|teams)|b2b\b/.test(text),
    national_reach: /nationwide|nationally|all 50 states|across the (?:us|u\.s\.|united states)|global (?:reach|clients|company)/.test(text),
    hiring: /we(?:'|’)re hiring|join our team|careers\b|job openings/.test(text),
    team_page: /our team|leadership team|meet the (?:team|founders)/.test(text),
    commercial_positioning: /commercial (?:clients|accounts|projects|construction)|enterprise (?:clients|sales)/.test(text),
  };
}

export function signalFacts(s: SiteSignals): { key: string; on: boolean; plain: string }[] {
  return [
    { key: "case_studies", on: s.case_studies, plain: "Case-study / client-story language on a page we opened" },
    { key: "client_logos", on: s.client_logos, plain: "Client / ‘trusted by’ language on a page we opened" },
    { key: "enterprise_language", on: s.enterprise_language, plain: "Enterprise / B2B wording on a page we opened" },
    { key: "national_reach", on: s.national_reach, plain: "Nationwide / national wording on a page we opened" },
    { key: "hiring", on: s.hiring, plain: "Hiring / careers wording on a page we opened" },
    { key: "team_page", on: s.team_page, plain: "Team / leadership wording on a page we opened" },
    { key: "commercial_positioning", on: s.commercial_positioning, plain: "Commercial-client wording on a page we opened" },
  ];
}
