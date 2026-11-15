import { getPackage, type PackageId } from "./catalog.ts";

export type StepTemplate = {
  id: string;
  title: string;
  schedule: "immediate" | "weekly" | "monthly";
  mode: "bookkeeping" | "external";
  integration: string | null;
  doneOutput: string;
  missingOutput: string;
  unwiredOutput: string;
};

const LEAD: StepTemplate[] = [
  {
    id: "capture-route",
    title: "Record the inquiry route",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Inquiry route is on file for this client. No message was sent.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "acknowledge",
    title: "Acknowledge the inquiry",
    schedule: "immediate",
    mode: "external",
    integration: "client_mailbox",
    doneOutput: "",
    missingOutput: "Needs a client mailbox before an acknowledgment can send. Nothing was sent. Sales outreach was not used.",
    unwiredOutput: "A client mailbox is marked connected, but the send adapter is not wired. Nothing was sent.",
  },
  {
    id: "notify-team",
    title: "Notify the team",
    schedule: "immediate",
    mode: "external",
    integration: "client_mailbox",
    doneOutput: "",
    missingOutput: "Needs a client mailbox before the team can be notified. Nothing was sent.",
    unwiredOutput: "Team notification stayed in the queue. The mailbox adapter is not wired. Nothing was sent.",
  },
  {
    id: "schedule-followups",
    title: "Schedule follow-ups for unresponsive leads",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Follow-up cadence is recorded. Sends stay blocked until a client mailbox is connected. The sales follow-up sequence was not started.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "weekly-summary",
    title: "Weekly activity summary",
    schedule: "weekly",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Weekly summary drafted from this pipeline's log. It was not emailed.",
    missingOutput: "",
    unwiredOutput: "",
  },
];

const AI: StepTemplate[] = [
  {
    id: "monthly-audit",
    title: "Monthly service, FAQ, and structured-data check",
    schedule: "monthly",
    mode: "external",
    integration: "client_site",
    doneOutput: "",
    missingOutput: "Needs access to the client's site before the monthly check can run. No page was fetched.",
    unwiredOutput: "Site access is marked connected, but the audit adapter is not wired. No page was fetched.",
  },
  {
    id: "draft-updates",
    title: "Draft up to 2 page updates",
    schedule: "monthly",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Draft budget for this month: 2 targeted page updates. Nothing was published.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "publish",
    title: "Publish approved page updates",
    schedule: "monthly",
    mode: "external",
    integration: "client_cms",
    doneOutput: "",
    missingOutput: "Needs the client's CMS before a page update can publish. Nothing was published.",
    unwiredOutput: "CMS is marked connected, but the publish adapter is not wired. Nothing was published.",
  },
];

const GOOGLE: StepTemplate[] = [
  {
    id: "setup-checklist",
    title: "Google Ads setup checklist",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Checklist opened for one Google Ads account: access, conversion action, keywords, geo. No API call was made.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "conversion-tracking",
    title: "Check conversion tracking",
    schedule: "immediate",
    mode: "external",
    integration: "google_ads_api",
    doneOutput: "",
    missingOutput: "Needs the Google Ads API before conversion tracking can be verified. No account was changed.",
    unwiredOutput: "Google Ads credentials are marked present, but the API adapter is not wired. No account was changed.",
  },
  {
    id: "keyword-plan",
    title: "Keyword plan shell",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Keyword plan shell is ready for review. No keywords were added in Google Ads.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "monthly-optimization",
    title: "Monthly campaign adjustments",
    schedule: "monthly",
    mode: "external",
    integration: "google_ads_api",
    doneOutput: "",
    missingOutput: "Needs the Google Ads API before campaigns can be adjusted. No budget or keyword was changed.",
    unwiredOutput: "Google Ads credentials are marked present, but the API adapter is not wired. No change was pushed.",
  },
  {
    id: "monthly-report",
    title: "Monthly Google Ads report",
    schedule: "monthly",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Report shell opened. Spend, clicks, and conversions are UNKNOWN until the Google Ads API returns them.",
    missingOutput: "",
    unwiredOutput: "",
  },
];

const META: StepTemplate[] = [
  {
    id: "setup-checklist",
    title: "Meta ads setup checklist",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Checklist opened for one Facebook and Instagram ad account. No API call was made.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "audience-copy",
    title: "Audience and copy shell",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Audience and copy notes are ready. Nothing was published to Meta.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "creative-variations",
    title: "Creative variations from existing assets",
    schedule: "immediate",
    mode: "external",
    integration: "meta_marketing_api",
    doneOutput: "",
    missingOutput: "Needs the Meta Marketing API and the client's existing assets. No ad was created.",
    unwiredOutput: "Meta credentials are marked present, but the API adapter is not wired. No ad was created.",
  },
  {
    id: "monthly-optimization",
    title: "Monthly Meta adjustments",
    schedule: "monthly",
    mode: "external",
    integration: "meta_marketing_api",
    doneOutput: "",
    missingOutput: "Needs the Meta Marketing API before ads can be adjusted. No campaign was changed.",
    unwiredOutput: "Meta credentials are marked present, but the API adapter is not wired. No change was pushed.",
  },
  {
    id: "monthly-report",
    title: "Monthly Meta report",
    schedule: "monthly",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Report shell opened. Spend and results are UNKNOWN until the Meta Marketing API returns them.",
    missingOutput: "",
    unwiredOutput: "",
  },
];

const LEADS: StepTemplate[] = [
  {
    id: "landing-draft",
    title: "Draft one landing page",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Landing-page draft slot opened. The page was not published. Ad spend was not set.",
    missingOutput: "",
    unwiredOutput: "",
  },
  {
    id: "form-routing",
    title: "Inquiry form and routing",
    schedule: "immediate",
    mode: "external",
    integration: "landing_host",
    doneOutput: "",
    missingOutput: "Needs a landing-page host before the inquiry form can go live. No form was published.",
    unwiredOutput: "A host is marked connected, but the page adapter is not wired. No form was published.",
  },
  {
    id: "tracking-check",
    title: "Lead tracking check",
    schedule: "immediate",
    mode: "external",
    integration: "tracking",
    doneOutput: "",
    missingOutput: "Needs tracking access before lead routing can be verified. No pixel or tag was installed.",
    unwiredOutput: "Tracking access is marked present, but the check adapter is not wired.",
  },
  {
    id: "test-log",
    title: "Ongoing test log",
    schedule: "monthly",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Test log opened for this month. No lead count was guaranteed. Ad spend stays with the client.",
    missingOutput: "",
    unwiredOutput: "",
  },
];

const ESTIMATES: StepTemplate[] = [
  {
    id: "outstanding-list",
    title: "List outstanding estimates",
    schedule: "immediate",
    mode: "external",
    integration: "estimate_source",
    doneOutput: "",
    missingOutput: "Needs an estimate source. Lead Follow-Up was not duplicated.",
    unwiredOutput: "An estimate source is marked connected, but the adapter is not wired. Lead Follow-Up was not duplicated.",
  },
  {
    id: "reminder",
    title: "Reminder for an outstanding estimate",
    schedule: "immediate",
    mode: "external",
    integration: "client_mailbox",
    doneOutput: "",
    missingOutput: "Needs a client mailbox before an estimate reminder can send. Nothing was sent.",
    unwiredOutput: "Mailbox is marked connected, but the send adapter is not wired. Nothing was sent.",
  },
  {
    id: "personal-alert",
    title: "Alert when a personal response is needed",
    schedule: "immediate",
    mode: "bookkeeping",
    integration: null,
    doneOutput: "Personal-response alert is armed. No message was sent, and the lead follow-up cadence was left alone.",
    missingOutput: "",
    unwiredOutput: "",
  },
];

const REVIEWS: StepTemplate[] = [
  {
    id: "job-trigger",
    title: "Wait for a completed job",
    schedule: "immediate",
    mode: "external",
    integration: "job_feed",
    doneOutput: "",
    missingOutput: "Needs a job-complete feed before a review request can be tied to a real job.",
    unwiredOutput: "A job feed is marked connected, but the adapter is not wired.",
  },
  {
    id: "review-request",
    title: "Request a review after the job",
    schedule: "immediate",
    mode: "external",
    integration: "client_mailbox",
    doneOutput: "",
    missingOutput: "Needs a client mailbox. Reviews are not purchased and are not filtered. Nothing was sent.",
    unwiredOutput: "Mailbox is marked connected, but the send adapter is not wired. Reviews are not purchased and are not filtered.",
  },
  {
    id: "gbp-info",
    title: "Check Google Business Profile info",
    schedule: "monthly",
    mode: "external",
    integration: "gbp_api",
    doneOutput: "",
    missingOutput: "Needs the Google Business Profile API before business info can be checked. Nothing was published.",
    unwiredOutput: "Google Business Profile credentials are marked present, but the API adapter is not wired.",
  },
  {
    id: "gbp-updates",
    title: "Up to 2 profile updates",
    schedule: "monthly",
    mode: "external",
    integration: "gbp_api",
    doneOutput: "",
    missingOutput: "Needs the Google Business Profile API. Cap is 2 updates this month. None were published.",
    unwiredOutput: "Google Business Profile credentials are marked present, but the API adapter is not wired. None were published.",
  },
];

const APPOINTMENTS: StepTemplate[] = [
  {
    id: "bind-calendar",
    title: "Bind one booking calendar",
    schedule: "immediate",
    mode: "external",
    integration: "client_booking_calendar",
    doneOutput: "",
    missingOutput: "Needs the client's booking calendar. The owner sales calendar was not changed.",
    unwiredOutput: "A booking calendar is marked connected, but the adapter is not wired. The owner sales calendar was not changed.",
  },
  {
    id: "confirmation",
    title: "Send confirmations",
    schedule: "immediate",
    mode: "external",
    integration: "client_booking_calendar",
    doneOutput: "",
    missingOutput: "Confirmations wait for the booking calendar. Nothing was sent.",
    unwiredOutput: "The booking calendar is marked connected, but the adapter is not wired. Nothing was sent.",
  },
  {
    id: "reminder",
    title: "Send reminders",
    schedule: "immediate",
    mode: "external",
    integration: "client_booking_calendar",
    doneOutput: "",
    missingOutput: "Reminders wait for the booking calendar. Nothing was sent.",
    unwiredOutput: "The booking calendar is marked connected, but the adapter is not wired. Nothing was sent.",
  },
];

const OFFICE: StepTemplate[] = [
  {
    id: "agree-workflow",
    title: "Agree the one workflow",
    schedule: "immediate",
    mode: "external",
    integration: "workflow_definition",
    doneOutput: "",
    missingOutput: "Needs the one agreed workflow (for example document collection, or handing a sold job to the office) before it can run.",
    unwiredOutput: "A workflow name is marked on file, but the runner for that workflow is not wired.",
  },
  {
    id: "run-workflow",
    title: "Run the agreed workflow",
    schedule: "immediate",
    mode: "external",
    integration: "workflow_definition",
    doneOutput: "",
    missingOutput: "The workflow cannot run until it is agreed. No office system was changed.",
    unwiredOutput: "The workflow is named, but its adapter is not wired. No office system was changed.",
  },
];

const TEMPLATES: Record<PackageId, StepTemplate[]> = {
  "lead-follow-up": LEAD,
  "ai-visibility": AI,
  "google-ads": GOOGLE,
  "meta-ads": META,
  "lead-generation": LEADS,
  "estimate-follow-ups": ESTIMATES,
  "reviews-gbp": REVIEWS,
  "appointment-reminders": APPOINTMENTS,
  "office-automation": OFFICE,
  "google-meta-ai": [],
};

export function stepTemplates(id: PackageId): { sourcePackageId: PackageId; group: string; step: StepTemplate }[] {
  const pkg = getPackage(id);
  if (pkg.includes.length === 0) {
    return (TEMPLATES[id] || []).map((step) => ({ sourcePackageId: id, group: pkg.name, step }));
  }
  return pkg.includes.flatMap((part) => {
    const child = getPackage(part);
    return (TEMPLATES[part] || []).map((step) => ({ sourcePackageId: part, group: child.name, step }));
  });
}

export function stepIds(id: PackageId): string[] {
  return stepTemplates(id).map((row) => `${row.sourcePackageId}:${row.step.id}`);
}
