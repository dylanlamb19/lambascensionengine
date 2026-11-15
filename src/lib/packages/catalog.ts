export const PACKAGE_IDS = [
  "lead-follow-up",
  "ai-visibility",
  "google-ads",
  "meta-ads",
  "lead-generation",
  "estimate-follow-ups",
  "reviews-gbp",
  "appointment-reminders",
  "office-automation",
  "google-meta-ai",
] as const;

export type PackageId = (typeof PACKAGE_IDS)[number];

export type PackageAutonomy = "needs_integration";

export type ServicePackage = {
  id: PackageId;
  name: string;
  monthlyCents: number;
  setupCents: number;
  pricingKind: "fixed" | "from";
  summary: string;
  features: readonly string[];
  includes: readonly PackageId[];
  addonOf: PackageId | null;
  autonomy: PackageAutonomy;
  autonomyNote: string;
};

const LEAD_FOLLOW_UP: ServicePackage = {
  id: "lead-follow-up",
  name: "Lead Follow-Up",
  monthlyCents: 35000,
  setupCents: 50000,
  pricingKind: "fixed",
  summary: "Website inquiry capture, acknowledgments, team notices, follow-ups, and a weekly activity summary.",
  features: [
    "Website inquiry capture",
    "Automatic acknowledgments",
    "Team notifications",
    "Follow-ups for unresponsive leads",
    "Weekly activity summary",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "Cadence bookkeeping runs on its own. Acknowledgments and follow-up sends need a client mailbox and do not use the sales outreach worker.",
};

const AI_VISIBILITY: ServicePackage = {
  id: "ai-visibility",
  name: "AI Visibility Optimization",
  monthlyCents: 60000,
  setupCents: 0,
  pricingKind: "fixed",
  summary: "Review service info, FAQs, and structured data so search engines and AI tools can understand the business.",
  features: [
    "Review service info, FAQs, and structured data",
    "Monthly checks",
    "Up to 2 targeted page updates",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "The monthly check is scheduled automatically. Reading and publishing pages needs site or CMS access.",
};

const GOOGLE_ADS: ServicePackage = {
  id: "google-ads",
  name: "Google Advertising",
  monthlyCents: 75000,
  setupCents: 0,
  pricingKind: "fixed",
  summary: "Setup and management of one Google Ads account, conversion tracking, keywords, adjustments, and a monthly report.",
  features: [
    "One Google Ads account",
    "Conversion tracking",
    "Keyword targeting",
    "Campaign adjustments",
    "Monthly reporting",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "The setup checklist and report shell run without the API. Live account changes need the Google Ads API.",
};

const META_ADS: ServicePackage = {
  id: "meta-ads",
  name: "Meta Advertising",
  monthlyCents: 65000,
  setupCents: 0,
  pricingKind: "fixed",
  summary: "Facebook and Instagram ads: audiences, copy, and basic creative variations from assets the client already has.",
  features: [
    "Facebook and Instagram ads management",
    "Audience targeting",
    "Ad copy",
    "Basic creative variations from existing assets",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "The checklist runs without the API. Campaign changes need the Meta Marketing API.",
};

const LEAD_GENERATION: ServicePackage = {
  id: "lead-generation",
  name: "Lead Generation",
  monthlyCents: 50000,
  setupCents: 50000,
  pricingKind: "fixed",
  summary: "One focused landing page with an inquiry form, lead tracking and routing, and ongoing testing. Ad spend is separate.",
  features: [
    "One focused landing page",
    "Inquiry form",
    "Lead tracking and routing",
    "Ongoing testing",
    "Ad spend is separate",
    "No guaranteed lead count",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "A page draft and test log can be opened locally. Publishing the page and verifying tracking need a host.",
};

const ESTIMATE_FOLLOW_UPS: ServicePackage = {
  id: "estimate-follow-ups",
  name: "Estimate Follow-Ups",
  monthlyCents: 20000,
  setupCents: 25000,
  pricingKind: "fixed",
  summary: "Reminders for outstanding estimates and an alert when a personal reply is needed. Add-on to Lead Follow-Up.",
  features: [
    "Reminders for outstanding estimates",
    "Alert when a personal response is needed",
    "Add-on to Lead Follow-Up",
    "Does not create a second lead follow-up sequence",
  ],
  includes: [],
  addonOf: "lead-follow-up",
  autonomy: "needs_integration",
  autonomyNote: "Requires an active Lead Follow-Up enrollment and an estimate source. It does not copy the lead follow-up steps.",
};

const REVIEWS_GBP: ServicePackage = {
  id: "reviews-gbp",
  name: "Review Requests & Google Business Profile Care",
  monthlyCents: 15000,
  setupCents: 0,
  pricingKind: "fixed",
  summary: "Post-job review requests, business-info updates, and up to two Google Business Profile updates a month.",
  features: [
    "Post-job review requests",
    "Business-info updates",
    "Up to 2 Google Business Profile updates per month",
    "No purchased reviews",
    "No review filtering",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "Needs a job-complete feed, a client mailbox, and the Google Business Profile API. Reviews are never purchased or filtered.",
};

const APPOINTMENTS: ServicePackage = {
  id: "appointment-reminders",
  name: "Appointment Reminders",
  monthlyCents: 10000,
  setupCents: 15000,
  pricingKind: "fixed",
  summary: "Confirmations and reminders tied to one supported booking calendar.",
  features: [
    "Confirmations",
    "Reminders",
    "One supported booking calendar",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "Needs the client's booking calendar. The owner sales calendar is not written.",
};

const OFFICE: ServicePackage = {
  id: "office-automation",
  name: "Office Automation",
  monthlyCents: 40000,
  setupCents: 50000,
  pricingKind: "from",
  summary: "One agreed office workflow, such as document collection or handing a sold job to the office.",
  features: [
    "One agreed workflow",
    "Example: document collection",
    "Example: handing sold jobs to the office",
  ],
  includes: [],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "The slot opens automatically. The workflow itself stays with a person until one workflow is agreed.",
};

const BUNDLE: ServicePackage = {
  id: "google-meta-ai",
  name: "Google, Meta & AI Package",
  monthlyCents: 250000,
  setupCents: 0,
  pricingKind: "fixed",
  summary: "Bundles AI Visibility Optimization, Google Advertising, Meta Advertising, and Lead Generation. No setup fee.",
  features: [
    "Includes AI Visibility Optimization",
    "Includes Google Advertising",
    "Includes Meta Advertising",
    "Includes Lead Generation",
    "No setup fee",
  ],
  includes: ["ai-visibility", "google-ads", "meta-ads", "lead-generation"],
  addonOf: null,
  autonomy: "needs_integration",
  autonomyNote: "Runs the four included pipelines under one purchase. Each part still needs its own connection.",
};

export const PACKAGE_CATALOG: Record<PackageId, ServicePackage> = {
  "lead-follow-up": LEAD_FOLLOW_UP,
  "ai-visibility": AI_VISIBILITY,
  "google-ads": GOOGLE_ADS,
  "meta-ads": META_ADS,
  "lead-generation": LEAD_GENERATION,
  "estimate-follow-ups": ESTIMATE_FOLLOW_UPS,
  "reviews-gbp": REVIEWS_GBP,
  "appointment-reminders": APPOINTMENTS,
  "office-automation": OFFICE,
  "google-meta-ai": BUNDLE,
};

export function isPackageId(value: string): value is PackageId {
  return (PACKAGE_IDS as readonly string[]).includes(value);
}

export function getPackage(id: PackageId): ServicePackage {
  return PACKAGE_CATALOG[id];
}

export function listPackages(): ServicePackage[] {
  return PACKAGE_IDS.map((id) => PACKAGE_CATALOG[id]);
}

export function includedPackages(id: PackageId): ServicePackage[] {
  const pkg = getPackage(id);
  return pkg.includes.map((part) => getPackage(part));
}

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatMonthly(pkg: ServicePackage): string {
  const amount = formatUsd(pkg.monthlyCents);
  return pkg.pricingKind === "from" ? `from ${amount}/mo` : `${amount}/mo`;
}

export function formatSetup(pkg: ServicePackage): string {
  if (pkg.setupCents === 0) return "No setup fee";
  return `${formatUsd(pkg.setupCents)} setup`;
}
