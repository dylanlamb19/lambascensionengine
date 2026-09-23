const GAP_WEIGHT: Record<string, number> = {
  NO_HOMEPAGE_FORM: 28,
  NO_HOMEPAGE_CTA: 22,
  NO_CLICK_TO_CALL: 16,
  NO_TRACKING: 14,
  NO_ADS_CONVERSION_TAG: 10,
  SLOW_MOBILE: 12,
  testimonials: 8,
};

export function priorityScore(input: {
  gaps: string[];
  reviewCount: number;
  hasEmail: boolean;
  fit: string;
  jobValue: number;
  industryNudge: number;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const gaps = [...new Set(input.gaps)];
  const best = gaps.map((g) => GAP_WEIGHT[g] || 0).sort((a, b) => b - a)[0] || 0;
  if (best) {
    score += best;
    reasons.push("verified acquisition gap");
  }
  if (input.reviewCount >= 20 && input.reviewCount <= 400) {
    score += 8;
    reasons.push("established public reputation");
  }
  if (input.hasEmail) {
    score += 12;
    reasons.push("usable email");
  }
  if (input.fit === "strong" || input.fit === "GOOD FIT") {
    score += 10;
    reasons.push("clear fit");
  }
  if (input.jobValue >= 2500) {
    score += Math.min(12, Math.round(input.jobValue / 2500));
    reasons.push("higher typical job value for this category");
  }
  score += input.industryNudge;
  if (input.industryNudge > 0) reasons.push("this industry has been replying");
  if (input.industryNudge < 0) reasons.push("this industry has not been replying");
  return { score: Math.max(0, score), reasons };
}
