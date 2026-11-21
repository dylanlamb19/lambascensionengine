import { useState, type FormEvent, type ReactNode } from "react";
import { TenantBrandBar } from "@/components/tenant-brand-bar";
import { SUBSCRIPTION_EDGES } from "@/lib/packages/billing";
import { demoSeedAllowed, loadDemoSeed } from "@/lib/packages/demo-seed";
import { formatUsd, listPackages, type PackageId } from "@/lib/packages/catalog";
import { getTestPlan, listTestPlans } from "@/lib/packages/plans";
import { usageFor } from "@/lib/packages/usage";
import { workspaceFor } from "@/lib/packages/tenancy";
import type { EnrollmentStatus, FulfillmentState, PaymentRecord, RecordPurchaseInput, StepStatus, SubscriptionLifecycle } from "@/lib/packages/types";
import { appointmentViews, clientList, clientPackageOverview, estimateViews, leadFollowUpView, packageRunViews, packageTabs, pipelineView, reviewsView, workspaceSummary, type AppointmentItemView, type EstimateItemView, type LeadView, type PackageOverviewRow, type PackageRunView, type ReviewsView } from "@/lib/packages/view";

const ONBOARDING_STEPS = [
  ["workspace", "Workspace"],
  ["plan", "Test plan"],
  ["client", "First client"],
  ["packages", "Packages"],
  ["connections", "Connections"],
] as const;

const PAYMENTS: PaymentRecord[] = ["unrecorded", "recorded", "waived"];

function StepFacts(props: { statusLabel: string; attempts: number; lastError: string | null; nextRunAt: string | null }) {
  return (
    <>
      <p className="mt-1 text-sm">{props.statusLabel}</p>
      <p className="mt-1 text-sm text-muted" data-step-facts="1">
        Attempts {props.attempts} · Last error {props.lastError || "—"} · Next {props.nextRunAt || "—"}
      </p>
    </>
  );
}

function LeadCaptureForm(props: {
  enrollmentId: string;
  onCapture: (input: { enrollmentId: string; contactName: string; contactEmail: string }) => { ok: boolean; reason?: string };
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onCapture({ enrollmentId: props.enrollmentId, contactName: name, contactEmail: email });
        if (!result.ok) {
          setMessage(result.reason || "That lead was not captured.");
          return;
        }
        setName("");
        setEmail("");
        setMessage("Lead captured. The draft stays in the log. Nothing was sent.");
      }}
    >
      <p className="la-kicker">New lead</p>
      <label className="la-label mt-3" htmlFor="lead-name">Name</label>
      <input id="lead-name" className="la-field mb-3" value={name} onChange={(event) => setName(event.target.value)} />
      <label className="la-label" htmlFor="lead-email">Email</label>
      <input id="lead-email" className="la-field mb-3" value={email} onChange={(event) => setEmail(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Capture lead</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function LeadCadence(props: {
  leads: LeadView[] | null;
  workspaceKill: boolean;
  enrollmentId: string;
  onCaptureLead?: (input: { enrollmentId: string; contactName: string; contactEmail: string }) => { ok: boolean; reason?: string };
  onLeadReply?: (leadId: string) => void;
  onWorkspaceKill?: (on: boolean) => void;
}) {
  if (!props.leads) return null;
  return (
    <div data-lead-cadence="1">
      <h2 className="font-display mt-4 mb-2 text-2xl">Lead follow-up</h2>
      <p className="mb-3 text-sm text-muted">
        Speed-to-lead, then day 1, day 3, and day 7. Each draft is written here. Nothing is sent.
        {props.workspaceKill ? " The workspace kill switch is on." : ""}
      </p>
      {props.onWorkspaceKill ? (
        <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onWorkspaceKill?.(!props.workspaceKill)}>
          {props.workspaceKill ? "Clear workspace kill switch" : "Stop lead follow-up for this workspace"}
        </button>
      ) : null}
      {props.onCaptureLead ? <LeadCaptureForm enrollmentId={props.enrollmentId} onCapture={props.onCaptureLead} /> : null}
      {props.leads.length === 0 ? <p className="text-sm text-muted">No leads captured yet.</p> : null}
      {props.leads.map((lead) => (
        <section key={lead.id} data-lead={lead.id} className="mb-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-xl">{lead.contactName}</h3>
            <span className="text-sm text-muted">{lead.status}{lead.repliedAt ? " · replied" : ""}</span>
          </div>
          {props.onLeadReply && !lead.repliedAt ? (
            <button type="button" className="la-btn la-btn-quiet mb-3" onClick={() => props.onLeadReply?.(lead.id)}>Lead replied</button>
          ) : null}
          {lead.steps.map((step) => (
            <article key={step.id} className="la-card" data-lead-step={step.id} data-step-status={step.status}>
              <h4 className="text-lg font-display">{step.title}</h4>
              <StepFacts statusLabel={step.statusLabel} attempts={step.attempts} lastError={step.lastError} nextRunAt={step.nextRunAt} />
              {step.draftedMessage ? <p className="mt-2 text-sm">Draft: {step.draftedMessage}</p> : null}
              {step.output ? <p className="mt-2 text-sm">{step.output}</p> : null}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function IntakeForm(props: {
  clientId: string;
  intake: PackageRunView["intake"];
  onSave?: (input: { clientId: string; businessName: string; phone: string; address: string; website: string; offer: string; serviceArea: string }) => { ok: boolean; reason?: string };
}) {
  const [businessName, setBusinessName] = useState(props.intake?.businessName || "");
  const [phone, setPhone] = useState(props.intake?.phone || "");
  const [address, setAddress] = useState(props.intake?.address || "");
  const [website, setWebsite] = useState(props.intake?.website || "");
  const [offer, setOffer] = useState(props.intake?.offer || "");
  const [serviceArea, setServiceArea] = useState(props.intake?.serviceArea || "");
  const [message, setMessage] = useState("");
  if (!props.onSave) {
    if (!props.intake) return <p className="mb-3 text-sm text-muted">No intake is stored for this client.</p>;
    return (
      <p className="mb-3 text-sm text-muted">
        Intake on file: {props.intake.businessName || "name missing"} · {props.intake.phone || "phone missing"} · {props.intake.address || "address missing"} · {props.intake.website || "site missing"}
      </p>
    );
  }
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onSave?.({ clientId: props.clientId, businessName, phone, address, website, offer, serviceArea });
        setMessage(result?.ok ? "Intake saved for this client. Nothing was published." : result?.reason || "Intake was not saved.");
      }}
    >
      <p className="la-kicker">Client intake</p>
      <p className="mt-2 mb-3 text-sm text-muted">Stored on this workspace. Briefs and profile audits read only this. No outside page is read.</p>
      <label className="la-label" htmlFor="intake-business">Business name</label>
      <input id="intake-business" className="la-field mb-3" value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
      <label className="la-label" htmlFor="intake-phone">Phone</label>
      <input id="intake-phone" className="la-field mb-3" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <label className="la-label" htmlFor="intake-address">Address</label>
      <input id="intake-address" className="la-field mb-3" value={address} onChange={(event) => setAddress(event.target.value)} />
      <label className="la-label" htmlFor="intake-site">Website</label>
      <input id="intake-site" className="la-field mb-3" value={website} onChange={(event) => setWebsite(event.target.value)} />
      <label className="la-label" htmlFor="intake-offer">Offer</label>
      <input id="intake-offer" className="la-field mb-3" value={offer} onChange={(event) => setOffer(event.target.value)} />
      <label className="la-label" htmlFor="intake-area">Service area</label>
      <input id="intake-area" className="la-field mb-3" value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Save intake</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function GeneratedLeadForm(props: {
  enrollmentId: string;
  onCapture: (input: { enrollmentId: string; contactName: string; contactEmail: string; contactPhone: string }) => { ok: boolean; reason?: string };
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onCapture({ enrollmentId: props.enrollmentId, contactName: name, contactEmail: email, contactPhone: phone });
        if (!result.ok) {
          setMessage(result.reason || "That lead was not captured.");
          return;
        }
        setName("");
        setEmail("");
        setPhone("");
        setMessage("Lead captured for this client. If Lead Follow-Up is active, it was handed there. Nothing was sent.");
      }}
    >
      <p className="la-kicker">Captured lead</p>
      <label className="la-label mt-3" htmlFor="gen-lead-name">Name</label>
      <input id="gen-lead-name" className="la-field mb-3" value={name} onChange={(event) => setName(event.target.value)} />
      <label className="la-label" htmlFor="gen-lead-email">Email</label>
      <input id="gen-lead-email" className="la-field mb-3" value={email} onChange={(event) => setEmail(event.target.value)} />
      <label className="la-label" htmlFor="gen-lead-phone">Phone</label>
      <input id="gen-lead-phone" className="la-field mb-3" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Capture lead</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function runBlurb(packageId: PackageRunView["packageId"]): string {
  if (packageId === "lead-generation") {
    return "Brief, landing page, Google and Meta copy, then a launch that waits for a person. No ad account is used and no spend is set.";
  }
  if (packageId === "reviews-gbp") {
    return "Profile audit, up to two post drafts, and reply drafts from stored data. Replies wait for a person. No Google API is called.";
  }
  if (packageId === "google-ads") {
    return "Campaign plan, weekly report, and a change proposal from stored intake and stored figures. The proposal waits for a person. No Google Ads API is called and no spend is made.";
  }
  if (packageId === "meta-ads") {
    return "Creative and audience plans from stored intake. The budget is checked against this workspace's test plan and is not spent. Approval waits for a person. No Meta API is called.";
  }
  if (packageId === "office-automation") {
    return "Intake, a schedule, a reminder, and an invoice reminder. Invoices stay on the test billing record at $0. An unnamed workflow waits for a person. Nothing is sent and nothing is charged.";
  }
  return "Profile audit and schema draft from stored data, then a recommendation check that waits for a person. No live model or search call is made.";
}

function statusWord(status: string): string {
  return status === "needs_human" ? "needs human" : status;
}

function AllPackages(props: { rows: PackageOverviewRow[] | null }) {
  if (!props.rows) return null;
  return (
    <div className="la-card mb-4" data-all-packages="1">
      <p className="la-kicker">All packages</p>
      <ul className="mt-2 space-y-1 text-sm">
        {props.rows.map((row) => (
          <li key={row.packageId} data-package-overview={row.packageId}>
            {row.name} · {row.purchased ? row.status : "not purchased"}
            {row.viaBundle ? " · included in the bundle" : ""}
            {row.detail ? ` · ${statusWord(row.detail)}` : ""}
            {row.killSwitch ? " · kill switch on" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdsMetricsForm(props: {
  enrollmentId: string;
  onRecord: (input: { enrollmentId: string; periodLabel: string; impressions: number | null; clicks: number | null; conversions: number | null; spendCents: number | null }) => { ok: boolean; reason?: string };
}) {
  const [periodLabel, setPeriodLabel] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [message, setMessage] = useState("");
  function blank(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return Number(trimmed);
  }
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onRecord({
          enrollmentId: props.enrollmentId,
          periodLabel,
          impressions: blank(impressions),
          clicks: blank(clicks),
          conversions: blank(conversions),
          spendCents: null,
        });
        if (!result.ok) {
          setMessage(result.reason || "Those figures were not stored.");
          return;
        }
        setPeriodLabel("");
        setImpressions("");
        setClicks("");
        setConversions("");
        setMessage("Stored for this workspace. No Google Ads API was called and no spend was made.");
      }}
    >
      <p className="la-kicker">Stored figures</p>
      <p className="mt-2 mb-3 text-sm text-muted">These stay in this workspace. Blank fields stay UNKNOWN. Nothing is spent.</p>
      <label className="la-label" htmlFor="ads-period">Period</label>
      <input id="ads-period" className="la-field mb-3" value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} />
      <label className="la-label" htmlFor="ads-impressions">Impressions</label>
      <input id="ads-impressions" className="la-field mb-3" value={impressions} onChange={(event) => setImpressions(event.target.value)} />
      <label className="la-label" htmlFor="ads-clicks">Clicks</label>
      <input id="ads-clicks" className="la-field mb-3" value={clicks} onChange={(event) => setClicks(event.target.value)} />
      <label className="la-label" htmlFor="ads-conversions">Conversions</label>
      <input id="ads-conversions" className="la-field mb-3" value={conversions} onChange={(event) => setConversions(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Store figures</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function MetaBudgetForm(props: {
  enrollmentId: string;
  onSave: (input: { enrollmentId: string; proposedCents: number | null; ambiguous: boolean }) => { ok: boolean; reason?: string };
}) {
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = amount.trim();
        const proposedCents = trimmed ? Number(trimmed) : null;
        const result = props.onSave({ enrollmentId: props.enrollmentId, proposedCents, ambiguous: false });
        if (!result.ok) {
          setMessage(result.reason || "That budget was not stored.");
          return;
        }
        setAmount("");
        setMessage("Stored for this workspace. Nothing was spent.");
      }}
    >
      <p className="la-kicker">Proposed budget</p>
      <p className="mt-2 mb-3 text-sm text-muted">Cents, checked against this workspace's test plan. Nothing is spent.</p>
      <label className="la-label" htmlFor="meta-budget">Proposed cents</label>
      <input id="meta-budget" className="la-field mb-3" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Store budget proposal</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function OfficeWorkflowForm(props: {
  enrollmentId: string;
  onSave: (input: { enrollmentId: string; kind: string; scheduleNote: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
}) {
  const [kind, setKind] = useState("document-collection");
  const [scheduleNote, setScheduleNote] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onSave({ enrollmentId: props.enrollmentId, kind, scheduleNote, ambiguous: false });
        if (!result.ok) {
          setMessage(result.reason || "That workflow was not stored.");
          return;
        }
        setMessage("Workflow stored. Nothing was sent and nothing was charged.");
      }}
    >
      <p className="la-kicker">One workflow</p>
      <label className="la-label mt-3" htmlFor="office-kind">Workflow</label>
      <select id="office-kind" className="la-field mb-3" value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="document-collection">Document collection</option>
        <option value="sold-job-handoff">Hand a sold job to the office</option>
        <option value="invoice-reminders">Invoice reminders</option>
      </select>
      <label className="la-label" htmlFor="office-when">Schedule note</label>
      <input id="office-when" className="la-field mb-3" value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Store workflow</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function PackageRunPanel(props: {
  clientId: string;
  enrollmentId: string;
  runs: PackageRunView[] | null;
  leadGenKill: boolean;
  aiKill: boolean;
  reviewsKill: boolean;
  adsKill?: boolean;
  metaKill?: boolean;
  officeKill?: boolean;
  onSaveIntake?: (input: { clientId: string; businessName: string; phone: string; address: string; website: string; offer: string; serviceArea: string }) => { ok: boolean; reason?: string };
  onCaptureGeneratedLead?: (input: { enrollmentId: string; contactName: string; contactEmail: string; contactPhone: string }) => { ok: boolean; reason?: string };
  onLeadGenKill?: (on: boolean) => void;
  onAiKill?: (on: boolean) => void;
  onReviewsKill?: (on: boolean) => void;
  onAdsKill?: (on: boolean) => void;
  onMetaKill?: (on: boolean) => void;
  onOfficeKill?: (on: boolean) => void;
  onRecordAdsMetrics?: (input: { enrollmentId: string; periodLabel: string; impressions: number | null; clicks: number | null; conversions: number | null; spendCents: number | null }) => { ok: boolean; reason?: string };
  onApproveAdsChange?: (enrollmentId: string) => { ok: boolean; reason?: string };
  onMarkAdsAmbiguous?: (enrollmentId: string) => { ok: boolean; reason?: string };
  onSaveMetaBudget?: (input: { enrollmentId: string; proposedCents: number | null; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onApproveMeta?: (enrollmentId: string) => { ok: boolean; reason?: string };
  onMarkMetaAmbiguous?: (enrollmentId: string) => { ok: boolean; reason?: string };
  onSaveOfficeWorkflow?: (input: { enrollmentId: string; kind: string; scheduleNote: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onMarkOfficeAmbiguous?: (enrollmentId: string) => { ok: boolean; reason?: string };
}) {
  if (!props.runs || props.runs.length === 0) return null;
  const intake = props.runs.find((run) => run.intake)?.intake || props.runs[0]?.intake || null;
  return (
    <div data-package-runs="1">
      <IntakeForm key={props.clientId} clientId={props.clientId} intake={intake} onSave={props.onSaveIntake} />
      {props.runs.map((run) => {
        const stopped = run.packageId === "lead-generation"
          ? props.leadGenKill
          : run.packageId === "reviews-gbp"
            ? props.reviewsKill
            : run.packageId === "google-ads"
              ? props.adsKill === true
              : run.packageId === "meta-ads"
                ? props.metaKill === true
                : run.packageId === "office-automation"
                  ? props.officeKill === true
                  : props.aiKill;
        return (
          <section key={run.runId} data-package-run={run.packageId} className="mb-4">
            <h2 className="font-display mt-4 mb-2 text-2xl">{run.packageName}</h2>
            <p className="mb-3 text-sm text-muted">
              {runBlurb(run.packageId)}
              {stopped ? " The workspace kill switch is on." : ""}
              {run.deduped ? " Already purchased separately. This bundle did not open a second run." : ""}
            </p>
            {run.packageId === "lead-generation" && props.onLeadGenKill ? (
              <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onLeadGenKill?.(!props.leadGenKill)}>
                {props.leadGenKill ? "Clear lead generation kill switch" : "Stop lead generation for this workspace"}
              </button>
            ) : null}
            {run.packageId === "ai-visibility" && props.onAiKill ? (
              <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onAiKill?.(!props.aiKill)}>
                {props.aiKill ? "Clear AI visibility kill switch" : "Stop AI visibility for this workspace"}
              </button>
            ) : null}
            {run.packageId === "reviews-gbp" && props.onReviewsKill ? (
              <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onReviewsKill?.(!props.reviewsKill)}>
                {props.reviewsKill ? "Clear reviews kill switch" : "Stop reviews for this workspace"}
              </button>
            ) : null}
            {run.packageId === "google-ads" && props.onAdsKill ? (
              <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onAdsKill?.(!props.adsKill)}>
                {props.adsKill ? "Clear Google Ads kill switch" : "Stop Google Ads drafts for this workspace"}
              </button>
            ) : null}
            {run.packageId === "google-ads" && props.onRecordAdsMetrics ? (
              <AdsMetricsForm enrollmentId={run.enrollmentId} onRecord={props.onRecordAdsMetrics} />
            ) : null}
            {run.packageId === "google-ads" && run.metrics.length > 0 ? (
              <ul className="mb-3 text-sm">
                {run.metrics.map((metric) => (
                  <li key={metric.id} data-ads-metric={metric.id}>{metric.periodLabel}: {metric.line}. Stored only. No spend was made.</li>
                ))}
              </ul>
            ) : null}
            {run.packageId === "google-ads" && (props.onApproveAdsChange || props.onMarkAdsAmbiguous) ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {props.onMarkAdsAmbiguous ? (
                  <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onMarkAdsAmbiguous?.(run.enrollmentId)}>Mark change ambiguous</button>
                ) : null}
                {props.onApproveAdsChange ? (
                  <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onApproveAdsChange?.(run.enrollmentId)}>Approve change</button>
                ) : null}
                {run.changeNote?.ambiguous ? <p className="text-sm text-muted">This change is ambiguous and stays with a person.</p> : null}
              </div>
            ) : null}
            {run.packageId === "meta-ads" && props.onMetaKill ? (
              <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onMetaKill?.(!props.metaKill)}>
                {props.metaKill ? "Clear Meta Ads kill switch" : "Stop Meta Ads drafts for this workspace"}
              </button>
            ) : null}
            {run.packageId === "meta-ads" && props.onSaveMetaBudget ? (
              <MetaBudgetForm enrollmentId={run.enrollmentId} onSave={props.onSaveMetaBudget} />
            ) : null}
            {run.packageId === "meta-ads" && run.budget ? (
              <p className="mb-3 text-sm" data-meta-budget={run.enrollmentId}>{run.budget.line}</p>
            ) : null}
            {run.packageId === "meta-ads" && (props.onApproveMeta || props.onMarkMetaAmbiguous) ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {props.onMarkMetaAmbiguous ? (
                  <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onMarkMetaAmbiguous?.(run.enrollmentId)}>Mark budget ambiguous</button>
                ) : null}
                {props.onApproveMeta ? (
                  <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onApproveMeta?.(run.enrollmentId)}>Approve Meta plan</button>
                ) : null}
              </div>
            ) : null}
            {run.packageId === "office-automation" && props.onOfficeKill ? (
              <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onOfficeKill?.(!props.officeKill)}>
                {props.officeKill ? "Clear office kill switch" : "Stop office drafts for this workspace"}
              </button>
            ) : null}
            {run.packageId === "office-automation" && props.onSaveOfficeWorkflow ? (
              <OfficeWorkflowForm enrollmentId={run.enrollmentId} onSave={props.onSaveOfficeWorkflow} />
            ) : null}
            {run.packageId === "office-automation" && props.onMarkOfficeAmbiguous ? (
              <button type="button" className="la-btn la-btn-quiet mb-3" onClick={() => props.onMarkOfficeAmbiguous?.(run.enrollmentId)}>Mark workflow ambiguous</button>
            ) : null}
            {run.packageId === "office-automation" && run.office?.kind ? (
              <p className="mb-3 text-sm" data-office-workflow={run.enrollmentId}>{run.office.kind}{run.office.ambiguous ? " · ambiguous" : ""}</p>
            ) : null}
            {run.packageId === "lead-generation" && props.onCaptureGeneratedLead ? (
              <GeneratedLeadForm key={run.enrollmentId} enrollmentId={run.enrollmentId} onCapture={props.onCaptureGeneratedLead} />
            ) : null}
            {run.steps.map((step) => (
              <article key={step.id} className="la-card" data-package-step={step.id} data-step-status={step.status}>
                <h3 className="text-lg font-display">{step.title}</h3>
                <StepFacts statusLabel={step.statusLabel} attempts={step.attempts} lastError={step.lastError} nextRunAt={step.nextRunAt} />
                {step.draft ? <p className="mt-2 text-sm">{step.draft}</p> : null}
                {step.output && step.output !== step.draft ? <p className="mt-2 text-sm">{step.output}</p> : null}
                {step.logs.length ? (
                  <ul className="mt-2 text-sm text-muted">
                    {step.logs.map((log, index) => (
                      <li key={`${log.at}-${index}`}>{log.at} — {log.message}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {run.packageId === "lead-generation" ? (
              run.leads.length === 0 ? <p className="mt-2 text-sm text-muted">No leads captured on this package yet.</p> : run.leads.map((lead) => (
                <p key={lead.id} className="mt-2 text-sm" data-generated-lead={lead.id}>
                  {lead.contactName} · {lead.handoffNote}
                </p>
              ))
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function CompletedJobForm(props: {
  enrollmentId: string;
  onRecord: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; jobLabel: string; completedAt: string; completed: boolean }) => { ok: boolean; reason?: string };
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [jobLabel, setJobLabel] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onRecord({
          enrollmentId: props.enrollmentId,
          customerName,
          customerEmail,
          customerPhone,
          jobLabel,
          completedAt: completedAt ? new Date(completedAt).toISOString() : "",
          completed,
        });
        if (!result.ok) {
          setMessage(result.reason || "That job was not recorded.");
          return;
        }
        setCustomerName("");
        setCustomerEmail("");
        setCustomerPhone("");
        setJobLabel("");
        setCompletedAt("");
        setCompleted(false);
        setMessage("Completed job recorded. The review request is a dry run and asks every customer the same way. Nothing was sent.");
      }}
    >
      <p className="la-kicker">Completed job</p>
      <p className="mt-2 mb-3 text-sm text-muted">A review request opens only after the job is marked completed. Reviews are not purchased or filtered.</p>
      <label className="la-label" htmlFor="job-customer">Customer</label>
      <input id="job-customer" className="la-field mb-3" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
      <label className="la-label" htmlFor="job-email">Email</label>
      <input id="job-email" className="la-field mb-3" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
      <label className="la-label" htmlFor="job-phone">Phone</label>
      <input id="job-phone" className="la-field mb-3" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
      <label className="la-label" htmlFor="job-label">Job</label>
      <input id="job-label" className="la-field mb-3" value={jobLabel} onChange={(event) => setJobLabel(event.target.value)} />
      <label className="la-label" htmlFor="job-done">Completed on</label>
      <input id="job-done" className="la-field mb-3" type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />
        This job is completed
      </label>
      <button className="la-btn la-btn-primary" type="submit">Record completed job</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function StoredReviewForm(props: {
  enrollmentId: string;
  onRecord: (input: { enrollmentId: string; reviewerName: string; body: string }) => { ok: boolean; reason?: string };
}) {
  const [reviewerName, setReviewerName] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onRecord({ enrollmentId: props.enrollmentId, reviewerName, body });
        if (!result.ok) {
          setMessage(result.reason || "That review was not stored.");
          return;
        }
        setReviewerName("");
        setBody("");
        setMessage("Review stored from what you already have. No Google API was called. A reply still needs a person.");
      }}
    >
      <p className="la-kicker">Stored review</p>
      <label className="la-label mt-3" htmlFor="review-name">Reviewer</label>
      <input id="review-name" className="la-field mb-3" value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} />
      <label className="la-label" htmlFor="review-body">Review text</label>
      <textarea id="review-body" className="la-field mb-3" value={body} onChange={(event) => setBody(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Store review</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function ReviewsPanel(props: {
  enrollmentId: string;
  reviews: ReviewsView | null;
  onRecordJob?: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; jobLabel: string; completedAt: string; completed: boolean }) => { ok: boolean; reason?: string };
  onRecordStoredReview?: (input: { enrollmentId: string; reviewerName: string; body: string }) => { ok: boolean; reason?: string };
}) {
  if (!props.reviews) return null;
  return (
    <div data-reviews="1">
      <h2 className="font-display mt-4 mb-2 text-2xl">Review requests</h2>
      <p className="mb-3 text-sm text-muted">Each request waits for a real completed job. The draft is not sent. Every customer is asked the same way.</p>
      {props.onRecordJob ? <CompletedJobForm enrollmentId={props.enrollmentId} onRecord={props.onRecordJob} /> : null}
      {props.onRecordStoredReview ? <StoredReviewForm enrollmentId={props.enrollmentId} onRecord={props.onRecordStoredReview} /> : null}
      {props.reviews.jobs.length === 0 ? <p className="text-sm text-muted">No completed jobs recorded yet.</p> : null}
      {props.reviews.jobs.map((job) => (
        <article key={job.jobId} className="la-card" data-review-job={job.jobId} data-step-status={job.step.status}>
          <h3 className="text-lg font-display">{job.customerName} · {job.jobLabel}</h3>
          <p className="mt-1 text-sm text-muted">Completed {job.completedAt}</p>
          <p className="mt-2 text-sm">{job.step.title}</p>
          <StepFacts statusLabel={job.step.statusLabel} attempts={job.step.attempts} lastError={job.step.lastError} nextRunAt={job.step.nextRunAt} />
          {job.step.draftedMessage ? <p className="mt-2 text-sm">Draft: {job.step.draftedMessage}</p> : null}
          {job.step.logs.length ? (
            <ul className="mt-2 text-sm text-muted">
              {job.step.logs.map((log, index) => <li key={`${log.at}-${index}`}>{log.at} — {log.message}</li>)}
            </ul>
          ) : null}
        </article>
      ))}
      {props.reviews.storedReviews.length ? (
        <div className="mt-3">
          {props.reviews.storedReviews.map((review) => (
            <p key={review.id} className="mt-2 text-sm" data-stored-review={review.id}>{review.reviewerName}: {review.body}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AppointmentForm(props: {
  enrollmentId: string;
  onRecord: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; startsAt: string }) => { ok: boolean; reason?: string };
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onRecord({
          enrollmentId: props.enrollmentId,
          customerName,
          customerEmail,
          customerPhone,
          startsAt: startsAt ? new Date(startsAt).toISOString() : "",
        });
        if (!result.ok) {
          setMessage(result.reason || "That appointment was not recorded.");
          return;
        }
        setCustomerName("");
        setCustomerEmail("");
        setCustomerPhone("");
        setStartsAt("");
        setMessage("Appointment recorded on this workspace's booking calendar. Nothing was sent. The sales calendar was not read.");
      }}
    >
      <p className="la-kicker">Booking</p>
      <p className="mt-2 mb-3 text-sm text-muted">Uses the booking calendar connection for this workspace. Reminders are 24 hours and 2 hours before, and they wait through quiet hours.</p>
      <label className="la-label" htmlFor="appt-name">Customer</label>
      <input id="appt-name" className="la-field mb-3" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
      <label className="la-label" htmlFor="appt-email">Email</label>
      <input id="appt-email" className="la-field mb-3" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
      <label className="la-label" htmlFor="appt-phone">Phone</label>
      <input id="appt-phone" className="la-field mb-3" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
      <label className="la-label" htmlFor="appt-start">Starts</label>
      <input id="appt-start" className="la-field mb-3" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
      <button className="la-btn la-btn-primary" type="submit">Record appointment</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function EstimateForm(props: {
  enrollmentId: string;
  onRecord: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; label: string; openedAt: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [label, setLabel] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const [ambiguous, setAmbiguous] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="la-card mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const result = props.onRecord({
          enrollmentId: props.enrollmentId,
          customerName,
          customerEmail,
          customerPhone,
          label,
          openedAt: openedAt ? new Date(openedAt).toISOString() : "",
          ambiguous,
        });
        if (!result.ok) {
          setMessage(result.reason || "That estimate was not recorded.");
          return;
        }
        setCustomerName("");
        setCustomerEmail("");
        setCustomerPhone("");
        setLabel("");
        setOpenedAt("");
        setAmbiguous(false);
        setMessage(ambiguous
          ? "Recorded as ambiguous. It needs a person. Nothing was sent."
          : "Open estimate recorded. Follow-up drafts wait on the cadence. Nothing was sent.");
      }}
    >
      <p className="la-kicker">Open estimate</p>
      <p className="mt-2 mb-3 text-sm text-muted">Day 2, day 5, day 10, then a close-out draft. Quiet hours hold a draft until 8:00. Lead Follow-Up is not copied.</p>
      <label className="la-label" htmlFor="est-name">Customer</label>
      <input id="est-name" className="la-field mb-3" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
      <label className="la-label" htmlFor="est-email">Email</label>
      <input id="est-email" className="la-field mb-3" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
      <label className="la-label" htmlFor="est-phone">Phone</label>
      <input id="est-phone" className="la-field mb-3" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
      <label className="la-label" htmlFor="est-label">Estimate</label>
      <input id="est-label" className="la-field mb-3" value={label} onChange={(event) => setLabel(event.target.value)} />
      <label className="la-label" htmlFor="est-opened">Opened</label>
      <input id="est-opened" className="la-field mb-3" type="datetime-local" value={openedAt} onChange={(event) => setOpenedAt(event.target.value)} />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ambiguous} onChange={(event) => setAmbiguous(event.target.checked)} />
        The outcome is ambiguous
      </label>
      <button className="la-btn la-btn-primary" type="submit">Record estimate</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function EstimatePanel(props: {
  enrollmentId: string;
  estimates: EstimateItemView[] | null;
  estimatesKill: boolean;
  onRecord?: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; label: string; openedAt: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onDecide?: (input: { estimateId: string; decision: "won" | "lost" | "replied" | "ambiguous" }) => { ok: boolean; reason?: string };
  onKill?: (on: boolean) => void;
}) {
  const [note, setNote] = useState("");
  if (!props.estimates) return null;
  function decide(estimateId: string, decision: "won" | "lost" | "replied" | "ambiguous") {
    const result = props.onDecide?.({ estimateId, decision });
    if (!props.onDecide) return;
    setNote(result?.ok ? "Noted. Nothing was sent." : result?.reason || "That was not recorded.");
  }
  return (
    <div data-estimates="1">
      <h2 className="font-display mt-4 mb-2 text-2xl">Estimate follow-ups</h2>
      <p className="mb-3 text-sm text-muted">
        Drafts go out on day 2, day 5, and day 10, then a close-out. Won, lost, or replied stops the rest. Quiet hours hold a draft until 8:00. Nothing is sent.
        {props.estimatesKill ? " The workspace kill switch is on." : ""}
      </p>
      {props.onKill ? (
        <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onKill?.(!props.estimatesKill)}>
          {props.estimatesKill ? "Clear estimate kill switch" : "Stop estimate follow-ups for this workspace"}
        </button>
      ) : null}
      {props.onRecord ? <EstimateForm enrollmentId={props.enrollmentId} onRecord={props.onRecord} /> : null}
      {props.estimates.length === 0 ? <p className="text-sm text-muted">No open estimates recorded yet.</p> : null}
      {props.estimates.map((estimate) => (
        <section key={estimate.id} data-estimate={estimate.id} className="mb-4">
          <h3 className="font-display text-xl">{estimate.customerName}</h3>
          <p className="mt-1 text-sm text-muted">{estimate.label} · opened {estimate.openedAt} · {estimate.outcome} · {estimate.status}</p>
          {estimate.lastNote ? <p className="mt-2 text-sm">{estimate.lastNote}</p> : null}
          {props.onDecide ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="la-btn la-btn-quiet" onClick={() => decide(estimate.id, "won")}>Won</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => decide(estimate.id, "lost")}>Lost</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => decide(estimate.id, "replied")}>Replied</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => decide(estimate.id, "ambiguous")}>Ambiguous</button>
            </div>
          ) : null}
          {estimate.steps.map((step) => (
            <article key={step.id} className="la-card" data-estimate-step={step.id} data-step-status={step.status}>
              <h3 className="text-lg font-display">{step.title}</h3>
              <StepFacts statusLabel={step.statusLabel} attempts={step.attempts} lastError={step.lastError} nextRunAt={step.nextRunAt} />
              {step.draft ? <p className="mt-2 text-sm">{step.draft}</p> : null}
              {step.output && step.output !== step.draft ? <p className="mt-2 text-sm">{step.output}</p> : null}
            </article>
          ))}
        </section>
      ))}
      {note ? <p className="text-sm text-muted">{note}</p> : null}
    </div>
  );
}

function AppointmentPanel(props: {
  enrollmentId: string;
  appointments: AppointmentItemView[] | null;
  appointmentsKill: boolean;
  onRecord?: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; startsAt: string }) => { ok: boolean; reason?: string };
  onReply?: (input: { appointmentId: string; kind: "confirm" | "reschedule" | "no_show" | "attended"; startsAt?: string }) => { ok: boolean; reason?: string };
  onKill?: (on: boolean) => void;
}) {
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [note, setNote] = useState("");
  if (!props.appointments) return null;
  function reply(appointmentId: string, kind: "confirm" | "reschedule" | "no_show" | "attended") {
    const result = props.onReply?.({
      appointmentId,
      kind,
      startsAt: kind === "reschedule" && rescheduleAt ? new Date(rescheduleAt).toISOString() : undefined,
    });
    if (!props.onReply) return;
    setNote(result?.ok ? "Noted. Nothing was sent. The sales calendar was not read." : result?.reason || "That was not recorded.");
  }
  return (
    <div data-appointments="1">
      <h2 className="font-display mt-4 mb-2 text-2xl">Appointment reminders</h2>
      <p className="mb-3 text-sm text-muted">
        Confirmation, a 24-hour reminder, a 2-hour reminder, and a no-show draft. Quiet hours hold a send until 8:00. The owner sales calendar is not read.
        {props.appointmentsKill ? " The workspace kill switch is on." : ""}
      </p>
      {props.onKill ? (
        <button type="button" className="la-btn la-btn-ghost mb-4" onClick={() => props.onKill?.(!props.appointmentsKill)}>
          {props.appointmentsKill ? "Clear appointment kill switch" : "Stop appointment reminders for this workspace"}
        </button>
      ) : null}
      {props.onRecord ? <AppointmentForm enrollmentId={props.enrollmentId} onRecord={props.onRecord} /> : null}
      {props.appointments.length === 0 ? <p className="text-sm text-muted">No appointments recorded yet.</p> : null}
      {props.appointments.map((appointment) => (
        <section key={appointment.id} data-appointment={appointment.id} className="mb-4">
          <h3 className="font-display text-xl">{appointment.customerName}</h3>
          <p className="mt-1 text-sm text-muted">{appointment.startsAt} · {appointment.status} · {appointment.response} · {appointment.outcome}</p>
          {appointment.lastNote ? <p className="mt-2 text-sm">{appointment.lastNote}</p> : null}
          {props.onReply ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <button type="button" className="la-btn la-btn-quiet" onClick={() => reply(appointment.id, "confirm")}>Confirm</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => reply(appointment.id, "attended")}>Attended</button>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => reply(appointment.id, "no_show")}>No-show</button>
              <label className="text-sm">
                New time
                <input className="la-field mt-1" type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} />
              </label>
              <button type="button" className="la-btn la-btn-quiet" onClick={() => reply(appointment.id, "reschedule")}>Reschedule</button>
            </div>
          ) : null}
          {appointment.steps.map((step) => (
            <article key={step.id} className="la-card" data-appointment-step={step.id} data-step-status={step.status}>
              <h4 className="text-lg font-display">{step.title}</h4>
              <StepFacts statusLabel={step.statusLabel} attempts={step.attempts} lastError={step.lastError} nextRunAt={step.nextRunAt} />
              {step.draft ? <p className="mt-2 text-sm">Draft: {step.draft}</p> : null}
              {step.logs.length ? (
                <ul className="mt-2 text-sm text-muted">
                  {step.logs.map((log, index) => <li key={`${log.at}-${index}`}>{log.at} — {log.message}</li>)}
                </ul>
              ) : null}
            </article>
          ))}
        </section>
      ))}
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

function dotClass(status: StepStatus): string {
  if (status === "done") return "la-dot la-dot-good";
  if (status === "failed") return "la-dot la-dot-bad";
  if (status === "needs_human") return "la-dot la-dot-warn";
  if (status === "running") return "la-dot la-dot-gold";
  return "la-dot";
}

export function PackageFulfillmentPanel(props: {
  tenantId: string;
  state: FulfillmentState;
  selectedClientId: string | null;
  selectedEnrollmentId: string | null;
  onSelectClient: (id: string) => void;
  onSelectEnrollment: (id: string) => void;
  onBack: () => void;
  onRecord: (input: RecordPurchaseInput) => { ok: boolean; reason?: string };
  onStatus: (enrollmentId: string, status: EnrollmentStatus) => void;
  onKill: (enrollmentId: string, on: boolean) => void;
  onPayment: (enrollmentId: string, which: "setup" | "monthly", value: PaymentRecord) => void;
  onPlan: (planId: string) => void;
  onConfirmWorkspace: (name: string) => { ok: boolean; reason?: string };
  onAddClient: (name: string) => { ok: boolean; reason?: string };
  onConnect: (kind: string) => void;
  onDisconnect: (kind: string) => void;
  onFinish: () => { ok: boolean; reason?: string };
  sessionUserId: string;
  sessionEmail: string;
  onInvite: (email: string) => { ok: boolean; reason?: string };
  onAccept: (inviteId: string) => { ok: boolean; reason?: string };
  onTransition: (to: SubscriptionLifecycle) => void;
  onIssueInvoice: () => void;
  onPayInvoice: (invoiceId: string) => void;
  onCheckout: (planId: string) => { ok: boolean; reason?: string };
  onCaptureLead: (input: { enrollmentId: string; contactName: string; contactEmail: string }) => { ok: boolean; reason?: string };
  onLeadReply: (leadId: string) => void;
  onWorkspaceKill: (on: boolean) => void;
  onSaveIntake: (input: { clientId: string; businessName: string; phone: string; address: string; website: string; offer: string; serviceArea: string }) => { ok: boolean; reason?: string };
  onCaptureGeneratedLead: (input: { enrollmentId: string; contactName: string; contactEmail: string; contactPhone: string }) => { ok: boolean; reason?: string };
  onLeadGenKill: (on: boolean) => void;
  onAiKill: (on: boolean) => void;
  onReviewsKill: (on: boolean) => void;
  onAppointmentsKill: (on: boolean) => void;
  onEstimatesKill: (on: boolean) => void;
  onAdsKill: (on: boolean) => void;
  onMetaKill: (on: boolean) => void;
  onOfficeKill: (on: boolean) => void;
  onSaveMetaBudget: (input: { enrollmentId: string; proposedCents: number | null; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onApproveMeta: (enrollmentId: string) => { ok: boolean; reason?: string };
  onMarkMetaAmbiguous: (enrollmentId: string) => { ok: boolean; reason?: string };
  onSaveOfficeWorkflow: (input: { enrollmentId: string; kind: string; scheduleNote: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onMarkOfficeAmbiguous: (enrollmentId: string) => { ok: boolean; reason?: string };
  onRecordJob: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; jobLabel: string; completedAt: string; completed: boolean }) => { ok: boolean; reason?: string };
  onRecordStoredReview: (input: { enrollmentId: string; reviewerName: string; body: string }) => { ok: boolean; reason?: string };
  onRecordAppointment: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; startsAt: string }) => { ok: boolean; reason?: string };
  onAppointmentReply: (input: { appointmentId: string; kind: "confirm" | "reschedule" | "no_show" | "attended"; startsAt?: string }) => { ok: boolean; reason?: string };
  onRecordEstimate: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; label: string; openedAt: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onDecideEstimate: (input: { estimateId: string; decision: "won" | "lost" | "replied" | "ambiguous" }) => { ok: boolean; reason?: string };
  onRecordAdsMetrics: (input: { enrollmentId: string; periodLabel: string; impressions: number | null; clicks: number | null; conversions: number | null; spendCents: number | null }) => { ok: boolean; reason?: string };
  onApproveAdsChange: (enrollmentId: string) => { ok: boolean; reason?: string };
  onMarkAdsAmbiguous: (enrollmentId: string) => { ok: boolean; reason?: string };
}) {
  const workspace = workspaceSummary(props.state, props.tenantId);
  const rows = clientList(props.state, props.tenantId);
  const [pricing, setPricing] = useState(false);
  const [help, setHelp] = useState(false);
  const [demo, setDemo] = useState<FulfillmentState | null>(null);
  const [demoTenant, setDemoTenant] = useState<string | null>(null);
  const allowDemo = demoSeedAllowed({ VERCEL_ENV: typeof process !== "undefined" ? process.env?.VERCEL_ENV : undefined });
  function loadSample() {
    const loaded = loadDemoSeed({ VERCEL_ENV: typeof process !== "undefined" ? process.env?.VERCEL_ENV : undefined });
    if (!loaded.ok) return;
    setDemo(loaded.state);
    setDemoTenant(loaded.state.workspaces[0]?.id || null);
    setPricing(false);
  }
  if (demo && demoTenant) {
    return <DemoSample state={demo} tenantId={demoTenant} onTenant={setDemoTenant} onClose={() => { setDemo(null); setDemoTenant(null); }} />;
  }
  if (pricing) {
    return <PricingPage state={props.state} tenantId={props.tenantId} onCheckout={props.onCheckout} onBack={() => setPricing(false)} />;
  }
  if (workspace && workspace.onboarding !== "desk") {
    return (
      <OnboardingWizard
        tenantId={props.tenantId}
        workspace={workspace}
        rows={rows}
        onConfirmWorkspace={props.onConfirmWorkspace}
        onPlan={props.onPlan}
        onAddClient={props.onAddClient}
        onRecord={props.onRecord}
        onConnect={props.onConnect}
        onDisconnect={props.onDisconnect}
        onFinish={props.onFinish}
        billing={<WorkspaceBilling {...props} />}
        onPricing={() => setPricing(true)}
        guide={<FulfillmentGuide allowDemo={allowDemo} onLoadSample={loadSample} />}
      />
    );
  }
  const client = rows.find((row) => row.id === props.selectedClientId) || null;
  const tabs = client ? packageTabs(props.state, props.tenantId, client.id) : [];
  const selectedEnrollment = props.selectedEnrollmentId || tabs[0]?.enrollmentId || null;
  const pipeline = selectedEnrollment ? pipelineView(props.state, props.tenantId, selectedEnrollment) : null;
  const leads = selectedEnrollment ? leadFollowUpView(props.state, props.tenantId, selectedEnrollment) : null;
  const runs = selectedEnrollment ? packageRunViews(props.state, props.tenantId, selectedEnrollment) : null;

  if (client && pipeline) {
    return (
      <>
      <TenantBrandBar state={props.state} tenantId={props.tenantId} />
      <PackagePipeline
        workspaceName={workspace?.name || "Workspace"}
        planName={workspace?.planName || "Test trial"}
        clientId={client.id}
        clientName={client.name}
        tabs={tabs}
        selectedEnrollmentId={pipeline.enrollmentId}
        pipeline={pipeline}
        leads={leads}
        runs={runs}
        workspaceKill={workspace?.leadFollowUpKillSwitch === true}
        leadGenKill={workspace?.leadGenerationKillSwitch === true}
        aiKill={workspace?.aiVisibilityKillSwitch === true}
        reviewsKill={workspace?.reviewsKillSwitch === true}
        appointmentsKill={workspace?.appointmentRemindersKillSwitch === true}
        estimatesKill={workspace?.estimateFollowUpsKillSwitch === true}
        adsKill={workspace?.googleAdsKillSwitch === true}
        metaKill={workspace?.metaAdsKillSwitch === true}
        officeKill={workspace?.officeAutomationKillSwitch === true}
        overview={clientPackageOverview(props.state, props.tenantId, client.id)}
        reviews={selectedEnrollment ? reviewsView(props.state, props.tenantId, selectedEnrollment) : null}
        appointments={selectedEnrollment ? appointmentViews(props.state, props.tenantId, selectedEnrollment) : null}
        estimates={selectedEnrollment ? estimateViews(props.state, props.tenantId, selectedEnrollment) : null}
        onBack={props.onBack}
        onSelectEnrollment={props.onSelectEnrollment}
        onStatus={props.onStatus}
        onKill={props.onKill}
        onPayment={props.onPayment}
        onCaptureLead={props.onCaptureLead}
        onLeadReply={props.onLeadReply}
        onWorkspaceKill={props.onWorkspaceKill}
        onSaveIntake={props.onSaveIntake}
        onCaptureGeneratedLead={props.onCaptureGeneratedLead}
        onLeadGenKill={props.onLeadGenKill}
        onAiKill={props.onAiKill}
        onReviewsKill={props.onReviewsKill}
        onAppointmentsKill={props.onAppointmentsKill}
        onEstimatesKill={props.onEstimatesKill}
        onAdsKill={props.onAdsKill}
        onRecordJob={props.onRecordJob}
        onRecordStoredReview={props.onRecordStoredReview}
        onRecordAppointment={props.onRecordAppointment}
        onAppointmentReply={props.onAppointmentReply}
        onRecordEstimate={props.onRecordEstimate}
        onDecideEstimate={props.onDecideEstimate}
        onRecordAdsMetrics={props.onRecordAdsMetrics}
        onApproveAdsChange={props.onApproveAdsChange}
        onMarkAdsAmbiguous={props.onMarkAdsAmbiguous}
        onMetaKill={props.onMetaKill}
        onOfficeKill={props.onOfficeKill}
        onSaveMetaBudget={props.onSaveMetaBudget}
        onApproveMeta={props.onApproveMeta}
        onMarkMetaAmbiguous={props.onMarkMetaAmbiguous}
        onSaveOfficeWorkflow={props.onSaveOfficeWorkflow}
        onMarkOfficeAmbiguous={props.onMarkOfficeAmbiguous}
        billing={<WorkspaceBilling {...props} />}
      />
      </>
    );
  }

  return (
    <section data-fulfillment-root="1" data-tenant-id={props.tenantId}>
      <TenantBrandBar state={props.state} tenantId={props.tenantId} />
      <p className="la-kicker">Client Package Fulfillment</p>
      <div className="mt-2 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl">Clients and packages</h1>
        <span className="flex flex-wrap gap-2">
          <button type="button" className="la-btn la-btn-ghost" onClick={() => setHelp((open) => !open)}>How this works</button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => setPricing(true)}>Pricing</button>
        </span>
      </div>
      <WorkspaceBilling {...props} />
      <p className="mb-4 text-sm text-muted">
        {workspace
          ? `${workspace.name} · ${workspace.planName} · test mode. This workspace only. No card and no charge.`
          : "This workspace is not open yet."}
        {workspace?.leadFollowUpKillSwitch ? " Lead follow-up is stopped for this workspace." : ""}
        {workspace?.leadGenerationKillSwitch ? " Lead generation is stopped for this workspace." : ""}
        {workspace?.aiVisibilityKillSwitch ? " AI visibility is stopped for this workspace." : ""}
        {workspace?.reviewsKillSwitch ? " Reviews are stopped for this workspace." : ""}
        {workspace?.appointmentRemindersKillSwitch ? " Appointment reminders are stopped for this workspace." : ""}
        {workspace?.estimateFollowUpsKillSwitch ? " Estimate follow-ups are stopped for this workspace." : ""}
        {workspace?.googleAdsKillSwitch ? " Google Ads drafts are stopped for this workspace." : ""}
        {workspace?.metaAdsKillSwitch ? " Meta Ads drafts are stopped for this workspace." : ""}
        {workspace?.officeAutomationKillSwitch ? " Office drafts are stopped for this workspace." : ""}
      </p>
      {workspace ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onWorkspaceKill(!workspace.leadFollowUpKillSwitch)}>
            {workspace.leadFollowUpKillSwitch ? "Clear lead follow-up kill switch" : "Stop lead follow-up for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onLeadGenKill(!workspace.leadGenerationKillSwitch)}>
            {workspace.leadGenerationKillSwitch ? "Clear lead generation kill switch" : "Stop lead generation for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onAiKill(!workspace.aiVisibilityKillSwitch)}>
            {workspace.aiVisibilityKillSwitch ? "Clear AI visibility kill switch" : "Stop AI visibility for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onReviewsKill(!workspace.reviewsKillSwitch)}>
            {workspace.reviewsKillSwitch ? "Clear reviews kill switch" : "Stop reviews for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onAppointmentsKill(!workspace.appointmentRemindersKillSwitch)}>
            {workspace.appointmentRemindersKillSwitch ? "Clear appointment kill switch" : "Stop appointment reminders for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onEstimatesKill(!workspace.estimateFollowUpsKillSwitch)}>
            {workspace.estimateFollowUpsKillSwitch ? "Clear estimate kill switch" : "Stop estimate follow-ups for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onAdsKill(!workspace.googleAdsKillSwitch)}>
            {workspace.googleAdsKillSwitch ? "Clear Google Ads kill switch" : "Stop Google Ads drafts for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onMetaKill(!workspace.metaAdsKillSwitch)}>
            {workspace.metaAdsKillSwitch ? "Clear Meta Ads kill switch" : "Stop Meta Ads drafts for this workspace"}
          </button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onOfficeKill(!workspace.officeAutomationKillSwitch)}>
            {workspace.officeAutomationKillSwitch ? "Clear office kill switch" : "Stop office drafts for this workspace"}
          </button>
        </div>
      ) : null}
      {workspace ? <ConnectionChecklist workspace={workspace} onConnect={props.onConnect} onDisconnect={props.onDisconnect} /> : null}
      <RecordForm onRecord={props.onRecord} />
      {rows.length === 0 || help ? <FulfillmentGuide allowDemo={allowDemo} onLoadSample={loadSample} /> : null}
      <div className="la-card">
        {rows.length === 0 ? null : (
          rows.map((row) => (
            <button key={row.id} type="button" className="la-list-row" data-client-row={row.id} onClick={() => props.onSelectClient(row.id)}>
              <span className="la-list-name">{row.name}</span>
              <span className="text-sm text-muted">{row.packages.map((pkg) => pkg.name).join(" · ") || "No package"}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function FulfillmentGuide(props: { allowDemo: boolean; onLoadSample: () => void }) {
  return (
    <div className="la-card mb-4" data-walkthrough="1">
      <p className="la-kicker">How this works</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Name this workspace. You only see your own clients.</li>
        <li>Choose a test plan on Pricing. Checkout is $0 and does not charge a card.</li>
        <li>Add the first client, then record one package. That starts its pipeline.</li>
        <li>Connect the mailbox, ads, profile, or calendar the package asks for. Until then the step says which connection is missing.</li>
        <li>Open a client, then a package, to watch each step: status, attempts, last error, and the next run.</li>
      </ol>
      {props.allowDemo ? (
        <button type="button" className="la-btn la-btn-ghost mt-4" onClick={props.onLoadSample}>Load sample workspaces</button>
      ) : (
        <p className="mt-3 text-sm text-muted">Sample workspaces are not loaded in production.</p>
      )}
    </div>
  );
}

function DemoSample(props: { state: FulfillmentState; tenantId: string; onTenant: (id: string) => void; onClose: () => void }) {
  const rows = clientList(props.state, props.tenantId);
  const [clientId, setClientId] = useState<string | null>(null);
  const client = rows.find((row) => row.id === clientId) || null;
  const tabs = client ? packageTabs(props.state, props.tenantId, client.id) : [];
  const pipeline = tabs[0] ? pipelineView(props.state, props.tenantId, tabs[0].enrollmentId) : null;
  return (
    <section data-fulfillment-root="1" data-demo="1" data-tenant-id={props.tenantId}>
      <p className="la-kicker">Sample data · local demo only</p>
      <div className="mt-2 mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl">Client Package Fulfillment</h1>
        <button type="button" className="la-btn la-btn-quiet" onClick={props.onClose}>Leave sample</button>
      </div>
      <p className="mb-3 text-sm text-muted">Two sample marketers. Switching workspaces does not show the other marketer's clients. Nothing is saved and nothing is charged.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {props.state.workspaces.map((row) => (
          <button key={row.id} type="button" className="la-nav-btn la-nav-quiet" data-on={row.id === props.tenantId ? "1" : "0"} onClick={() => { props.onTenant(row.id); setClientId(null); }}>
            {row.name}
          </button>
        ))}
      </div>
      {client && pipeline ? (
        <div>
          <button type="button" className="la-btn la-btn-quiet mb-3" onClick={() => setClientId(null)}>All clients</button>
          <h2 className="font-display text-2xl">{client.name}</h2>
          <p className="mt-1 mb-3 text-sm text-muted">{pipeline.packageName} · {pipeline.status}</p>
          {pipeline.steps.map((step) => (
            <article key={step.id} className="la-card" data-step-status={step.status}>
              <h3 className="text-lg font-display">{step.title}</h3>
              <StepFacts statusLabel={step.statusLabel} attempts={step.attempts} lastError={step.lastError} nextRunAt={step.nextRunAt} />
            </article>
          ))}
          <LeadCadence
            leads={leadFollowUpView(props.state, props.tenantId, pipeline.enrollmentId)}
            workspaceKill={workspaceSummary(props.state, props.tenantId)?.leadFollowUpKillSwitch === true}
            enrollmentId={pipeline.enrollmentId}
          />
          <PackageRunPanel
            clientId={client.id}
            enrollmentId={pipeline.enrollmentId}
            runs={packageRunViews(props.state, props.tenantId, pipeline.enrollmentId)}
            leadGenKill={workspaceSummary(props.state, props.tenantId)?.leadGenerationKillSwitch === true}
            aiKill={workspaceSummary(props.state, props.tenantId)?.aiVisibilityKillSwitch === true}
            reviewsKill={workspaceSummary(props.state, props.tenantId)?.reviewsKillSwitch === true}
            adsKill={workspaceSummary(props.state, props.tenantId)?.googleAdsKillSwitch === true}
          />
          <ReviewsPanel
            enrollmentId={pipeline.enrollmentId}
            reviews={reviewsView(props.state, props.tenantId, pipeline.enrollmentId)}
          />
          <EstimatePanel
            enrollmentId={pipeline.enrollmentId}
            estimates={estimateViews(props.state, props.tenantId, pipeline.enrollmentId)}
            estimatesKill={workspaceSummary(props.state, props.tenantId)?.estimateFollowUpsKillSwitch === true}
          />
          <AppointmentPanel
            enrollmentId={pipeline.enrollmentId}
            appointments={appointmentViews(props.state, props.tenantId, pipeline.enrollmentId)}
            appointmentsKill={workspaceSummary(props.state, props.tenantId)?.appointmentRemindersKillSwitch === true}
          />
        </div>
      ) : (
        <div className="la-card">
          {rows.map((row) => (
            <button key={row.id} type="button" className="la-list-row" data-client-row={row.id} onClick={() => setClientId(row.id)}>
              <span className="la-list-name">{row.name}</span>
              <span className="text-sm text-muted">{row.packages.map((pkg) => pkg.name).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PricingPage(props: {
  state: FulfillmentState;
  tenantId: string;
  onCheckout: (planId: string) => { ok: boolean; reason?: string };
  onBack: () => void;
}) {
  const usage = usageFor(props.state, props.tenantId);
  const workspace = workspaceFor(props.state, props.tenantId);
  const [note, setNote] = useState("");
  return (
    <section data-fulfillment-root="1" data-pricing="1" data-tenant-id={props.tenantId}>
      <button type="button" className="la-btn la-btn-quiet mb-3" onClick={props.onBack}>Back</button>
      <p className="la-kicker">Client Package Fulfillment</p>
      <h1 className="font-display mt-2 mb-2 text-3xl">Pricing</h1>
      <p className="mb-4 text-sm text-muted">
        Test checkout is {formatUsd(0)}. Nothing is charged. This workspace has used {usage.enrollments} packages and {usage.pipelineRuns} pipeline runs.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {listTestPlans().map((plan) => {
          const limits = getTestPlan(plan.id);
          const current = workspace?.planId === plan.id;
          return (
            <article key={plan.id} className="la-card" data-plan={plan.id}>
              <p className="la-kicker">{plan.name}</p>
              <p className="mt-2 font-display text-3xl">{formatUsd(0)}</p>
              <p className="mt-2 text-sm text-muted">{plan.summary}</p>
              <ul className="mt-3 text-sm text-muted">
                <li>{limits.clientLimit == null ? "No client cap" : `${limits.clientLimit} clients`}</li>
                <li>{limits.enrollmentLimit == null ? "No package cap" : `${limits.enrollmentLimit} packages`}</li>
                <li>{limits.pipelineRunLimit == null ? "No pipeline-run cap" : `${limits.pipelineRunLimit} pipeline runs`}</li>
              </ul>
              <button
                type="button"
                className="la-btn la-btn-primary mt-4"
                disabled={current}
                onClick={() => {
                  const result = props.onCheckout(plan.id);
                  setNote(result.ok ? `${plan.name} recorded at $0.` : result.reason || "Checkout was not recorded.");
                }}
              >
                {current ? "Current plan" : "Checkout · $0"}
              </button>
            </article>
          );
        })}
      </div>
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
    </section>
  );
}

function WorkspaceBilling(props: {
  tenantId: string;
  state: FulfillmentState;
  sessionUserId: string;
  sessionEmail: string;
  onInvite: (email: string) => { ok: boolean; reason?: string };
  onAccept: (inviteId: string) => { ok: boolean; reason?: string };
  onTransition: (to: SubscriptionLifecycle) => void;
  onIssueInvoice: () => void;
  onPayInvoice: (invoiceId: string) => void;
}) {
  const workspace = workspaceFor(props.state, props.tenantId);
  const status = workspace?.subscriptionStatus || "trial";
  const invoices = (props.state.invoices || []).filter((row) => row.tenantId === props.tenantId);
  const invites = (props.state.invites || []).filter((row) => row.tenantId === props.tenantId);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const next = SUBSCRIPTION_EDGES[status];
  return (
    <div className="la-card mb-4" data-billing-status={status} data-session-user={props.sessionUserId}>
      <p className="la-kicker">Billing</p>
      <p className="mt-2 text-sm">Subscription {status} · {workspace?.planId || "test_trial"} · $0</p>
      <p className="mt-1 mb-3 text-sm text-muted">Test mode. Invoices are $0. Nothing is charged.</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {next.map((to) => (
          <button key={to} type="button" className="la-btn la-btn-ghost" onClick={() => props.onTransition(to)}>
            {to === "past_due" ? "Mark past due" : to === "canceled" ? "Cancel subscription" : "Mark active"}
          </button>
        ))}
        <button type="button" className="la-btn la-btn-quiet" onClick={props.onIssueInvoice}>Issue $0 invoice</button>
      </div>
      {invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : invoices.map((invoice) => (
        <div key={invoice.id} className="la-list-row" data-invoice={invoice.id} data-invoice-status={invoice.status}>
          <span className="text-sm">$0 · {invoice.status}</span>
          {invoice.status === "open" ? (
            <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onPayInvoice(invoice.id)}>Record $0 payment</button>
          ) : null}
        </div>
      ))}
      <form className="mt-4" onSubmit={(event) => {
        event.preventDefault();
        const result = props.onInvite(email);
        setNote(result.ok ? "Invite recorded. No login was created." : result.reason || "Could not invite.");
        if (result.ok) setEmail("");
      }}>
        <p className="la-kicker">Invite a marketer</p>
        <p className="mt-2 mb-2 text-sm text-muted">Public registration stays closed. The person must already be able to sign in.</p>
        <label className="la-label" htmlFor="invite-email">Email</label>
        <div className="flex flex-wrap gap-2">
          <input id="invite-email" className="la-field" value={email} onChange={(event) => setEmail(event.target.value)} />
          <button className="la-btn la-btn-ghost" type="submit">Send invite</button>
        </div>
      </form>
      {invites.map((invite) => (
        <div key={invite.id} className="la-list-row" data-invite={invite.id} data-invite-status={invite.status}>
          <span className="text-sm">{invite.email} · {invite.status}</span>
          {invite.status === "pending" && invite.email === props.sessionEmail.trim().toLowerCase() ? (
            <button type="button" className="la-btn la-btn-quiet" onClick={() => {
              const result = props.onAccept(invite.id);
              setNote(result.ok ? "Invite accepted for this signed-in user." : result.reason || "Could not accept.");
            }}>Accept invite</button>
          ) : null}
        </div>
      ))}
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

function ConnectionChecklist(props: {
  workspace: NonNullable<ReturnType<typeof workspaceSummary>>;
  onConnect: (kind: string) => void;
  onDisconnect: (kind: string) => void;
}) {
  const feeds = props.workspace.connections.filter((row) => row.kind === "job_feed" || row.kind === "estimate_feed");
  const rest = props.workspace.connections.filter((row) => row.kind !== "job_feed" && row.kind !== "estimate_feed");
  return (
    <div className="la-card mb-4" data-connections="1">
      <p className="la-kicker">Connections</p>
      <p className="mt-2 mb-3 text-sm text-muted">Connect is a test stub. No secret is stored, and nothing is charged.</p>
      {[...rest, ...feeds].map((row) => (
        <div key={row.kind} className="la-list-row" data-connection={row.kind} data-connection-status={row.status}>
          <span>
            <span className="la-list-name">{row.label}</span>
            <span className="ml-2 text-sm text-muted">{row.status === "stub_connected" ? "Connected (test)" : "Missing"}</span>
          </span>
          {row.status === "stub_connected" ? (
            <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onDisconnect(row.kind)}>Disconnect</button>
          ) : (
            <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onConnect(row.kind)}>Connect</button>
          )}
        </div>
      ))}
    </div>
  );
}

function OnboardingWizard(props: {
  tenantId: string;
  workspace: NonNullable<ReturnType<typeof workspaceSummary>>;
  rows: ReturnType<typeof clientList>;
  onConfirmWorkspace: (name: string) => { ok: boolean; reason?: string };
  onPlan: (planId: string) => void;
  onAddClient: (name: string) => { ok: boolean; reason?: string };
  onRecord: (input: RecordPurchaseInput) => { ok: boolean; reason?: string };
  onConnect: (kind: string) => void;
  onDisconnect: (kind: string) => void;
  onFinish: () => { ok: boolean; reason?: string };
  billing: ReactNode;
  onPricing: () => void;
  guide: ReactNode;
}) {
  const step = props.workspace.onboarding;
  const [name, setName] = useState(props.workspace.name);
  const [clientName, setClientName] = useState("");
  const [packageId, setPackageId] = useState<PackageId>("lead-follow-up");
  const [message, setMessage] = useState("");
  const firstClient = props.rows[0]?.name || "";

  function fail(result: { ok: boolean; reason?: string }) {
    setMessage(result.ok ? "" : result.reason || "That step could not be saved.");
  }

  return (
    <section data-fulfillment-root="1" data-onboarding={step} data-tenant-id={props.tenantId}>
      <p className="la-kicker">Client Package Fulfillment</p>
      <div className="mt-2 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl">Set up this workspace</h1>
        <button type="button" className="la-btn la-btn-ghost" onClick={props.onPricing}>Pricing</button>
      </div>
      {props.billing}
      {props.guide}
      <p className="mb-4 text-sm text-muted">Signed-in marketers only. This does not open registration, and it does not charge a card.</p>
      <ol className="mb-4 flex flex-wrap gap-2">
        {ONBOARDING_STEPS.map(([id, label]) => (
          <li key={id} className="la-chip" data-on={id === step ? "1" : "0"}>{label}</li>
        ))}
      </ol>
      {step === "workspace" ? (
        <form className="la-card" onSubmit={(event) => { event.preventDefault(); fail(props.onConfirmWorkspace(name)); }}>
          <p className="la-kicker">Workspace</p>
          <label className="la-label mt-3" htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" className="la-field mb-3" value={name} onChange={(event) => setName(event.target.value)} />
          <button className="la-btn la-btn-primary" type="submit">Continue</button>
        </form>
      ) : null}
      {step === "plan" ? (
        <div className="la-card">
          <p className="la-kicker">Test plan</p>
          <p className="mt-2 mb-3 text-sm text-muted">
            {props.workspace.planName}. Choosing a plan records it. Nothing is billed.
            {props.workspace.clientLimit == null ? " No client cap on this test plan." : ` Up to ${props.workspace.clientLimit} clients.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {listTestPlans().map((plan) => (
              <button key={plan.id} type="button" className="la-btn la-btn-ghost" onClick={() => props.onPlan(plan.id)}>
                {plan.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {step === "client" ? (
        <form className="la-card" onSubmit={(event) => { event.preventDefault(); fail(props.onAddClient(clientName)); }}>
          <p className="la-kicker">First client</p>
          <label className="la-label mt-3" htmlFor="first-client">Client</label>
          <input id="first-client" className="la-field mb-3" value={clientName} onChange={(event) => setClientName(event.target.value)} />
          <button className="la-btn la-btn-primary" type="submit">Save client</button>
        </form>
      ) : null}
      {step === "packages" ? (
        <form
          className="la-card"
          onSubmit={(event) => {
            event.preventDefault();
            fail(props.onRecord({ clientName: firstClient, packageId, setupPayment: "unrecorded", monthlyPayment: "unrecorded" }));
          }}
        >
          <p className="la-kicker">Packages</p>
          <p className="mt-2 mb-3 text-sm text-muted">First package for {firstClient || "this client"}. Payment state stays unrecorded. Nothing is charged.</p>
          <label className="la-label" htmlFor="first-package">Package</label>
          <select id="first-package" className="la-field mb-3" value={packageId} onChange={(event) => setPackageId(event.target.value as PackageId)}>
            {listPackages().map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
          </select>
          <button className="la-btn la-btn-primary" type="submit">Record package</button>
        </form>
      ) : null}
      {step === "connections" ? (
        <div>
          <ConnectionChecklist workspace={props.workspace} onConnect={props.onConnect} onDisconnect={props.onDisconnect} />
          <button type="button" className="la-btn la-btn-primary" onClick={() => fail(props.onFinish())}>Go to clients</button>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </section>
  );
}

function RecordForm(props: { onRecord: (input: RecordPurchaseInput) => { ok: boolean; reason?: string } }) {
  const packages = listPackages();
  const [clientName, setClientName] = useState("");
  const [packageId, setPackageId] = useState<PackageId>(packages[0]?.id || "lead-follow-up");
  const [setupPayment, setSetupPayment] = useState<PaymentRecord>("unrecorded");
  const [monthlyPayment, setMonthlyPayment] = useState<PaymentRecord>("unrecorded");
  const [startedOn, setStartedOn] = useState("");
  const [message, setMessage] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = props.onRecord({
      clientName,
      packageId,
      setupPayment,
      monthlyPayment,
      startedOn: startedOn || undefined,
    });
    if (!result.ok) {
      setMessage(result.reason || "Could not record that purchase.");
      return;
    }
    setClientName("");
    setMessage("Purchase recorded. The pipeline starts on its own. Nothing was charged.");
  }

  return (
    <form className="la-card mb-4" onSubmit={submit}>
      <p className="la-kicker">Record a purchase</p>
      <p className="mt-2 mb-3 text-sm text-muted">Manual payment state only. This does not charge anyone.</p>
      <label className="la-label" htmlFor="pkg-client">Client</label>
      <input id="pkg-client" className="la-field mb-3" value={clientName} onChange={(event) => setClientName(event.target.value)} />
      <label className="la-label" htmlFor="pkg-id">Package</label>
      <select id="pkg-id" className="la-field mb-3" value={packageId} onChange={(event) => setPackageId(event.target.value as PackageId)}>
        {packages.map((pkg) => (
          <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-3 mb-3">
        <label className="text-sm">
          Setup fee
          <select className="la-field mt-1" value={setupPayment} onChange={(event) => setSetupPayment(event.target.value as PaymentRecord)}>
            {PAYMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Monthly
          <select className="la-field mt-1" value={monthlyPayment} onChange={(event) => setMonthlyPayment(event.target.value as PaymentRecord)}>
            {PAYMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Start
          <input className="la-field mt-1" type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} />
        </label>
      </div>
      <button className="la-btn la-btn-primary" type="submit">Record purchase</button>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </form>
  );
}

function PackagePipeline(props: {
  workspaceName: string;
  planName: string;
  clientId: string;
  clientName: string;
  tabs: { enrollmentId: string; name: string; status: EnrollmentStatus }[];
  selectedEnrollmentId: string;
  pipeline: NonNullable<ReturnType<typeof pipelineView>>;
  leads: LeadView[] | null;
  runs: PackageRunView[] | null;
  workspaceKill: boolean;
  leadGenKill: boolean;
  aiKill: boolean;
  reviewsKill: boolean;
  appointmentsKill: boolean;
  estimatesKill: boolean;
  adsKill: boolean;
  metaKill: boolean;
  officeKill: boolean;
  overview: PackageOverviewRow[] | null;
  reviews: ReviewsView | null;
  appointments: AppointmentItemView[] | null;
  estimates: EstimateItemView[] | null;
  onCaptureLead: (input: { enrollmentId: string; contactName: string; contactEmail: string }) => { ok: boolean; reason?: string };
  onLeadReply: (leadId: string) => void;
  onWorkspaceKill: (on: boolean) => void;
  onSaveIntake: (input: { clientId: string; businessName: string; phone: string; address: string; website: string; offer: string; serviceArea: string }) => { ok: boolean; reason?: string };
  onCaptureGeneratedLead: (input: { enrollmentId: string; contactName: string; contactEmail: string; contactPhone: string }) => { ok: boolean; reason?: string };
  onLeadGenKill: (on: boolean) => void;
  onAiKill: (on: boolean) => void;
  onReviewsKill: (on: boolean) => void;
  onAppointmentsKill: (on: boolean) => void;
  onEstimatesKill: (on: boolean) => void;
  onAdsKill: (on: boolean) => void;
  onMetaKill: (on: boolean) => void;
  onOfficeKill: (on: boolean) => void;
  onSaveMetaBudget: (input: { enrollmentId: string; proposedCents: number | null; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onApproveMeta: (enrollmentId: string) => { ok: boolean; reason?: string };
  onMarkMetaAmbiguous: (enrollmentId: string) => { ok: boolean; reason?: string };
  onSaveOfficeWorkflow: (input: { enrollmentId: string; kind: string; scheduleNote: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onMarkOfficeAmbiguous: (enrollmentId: string) => { ok: boolean; reason?: string };
  onRecordJob: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; jobLabel: string; completedAt: string; completed: boolean }) => { ok: boolean; reason?: string };
  onRecordStoredReview: (input: { enrollmentId: string; reviewerName: string; body: string }) => { ok: boolean; reason?: string };
  onRecordAppointment: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; startsAt: string }) => { ok: boolean; reason?: string };
  onAppointmentReply: (input: { appointmentId: string; kind: "confirm" | "reschedule" | "no_show" | "attended"; startsAt?: string }) => { ok: boolean; reason?: string };
  onRecordEstimate: (input: { enrollmentId: string; customerName: string; customerEmail: string; customerPhone: string; label: string; openedAt: string; ambiguous: boolean }) => { ok: boolean; reason?: string };
  onDecideEstimate: (input: { estimateId: string; decision: "won" | "lost" | "replied" | "ambiguous" }) => { ok: boolean; reason?: string };
  onRecordAdsMetrics: (input: { enrollmentId: string; periodLabel: string; impressions: number | null; clicks: number | null; conversions: number | null; spendCents: number | null }) => { ok: boolean; reason?: string };
  onApproveAdsChange: (enrollmentId: string) => { ok: boolean; reason?: string };
  onMarkAdsAmbiguous: (enrollmentId: string) => { ok: boolean; reason?: string };
  onBack: () => void;
  onSelectEnrollment: (id: string) => void;
  onStatus: (enrollmentId: string, status: EnrollmentStatus) => void;
  onKill: (enrollmentId: string, on: boolean) => void;
  onPayment: (enrollmentId: string, which: "setup" | "monthly", value: PaymentRecord) => void;
  billing: ReactNode;
}) {
  const pipeline = props.pipeline;
  let lastGroup = "";
  return (
    <section data-fulfillment-root="1" data-pipeline="1">
      {props.billing}
      <button type="button" className="la-btn la-btn-quiet mb-3" onClick={props.onBack}>All clients</button>
      <p className="la-kicker">{props.workspaceName} · {props.planName}</p>
      <h1 className="font-display mt-2 mb-3 text-3xl">{props.clientName}</h1>
      <AllPackages rows={props.overview} />
      <div className="la-nav mb-4" role="tablist" aria-label="Purchased packages">
        {props.tabs.map((tab) => (
          <button
            key={tab.enrollmentId}
            type="button"
            role="tab"
            className="la-nav-btn la-nav-quiet"
            data-package-tab={tab.enrollmentId}
            aria-selected={tab.enrollmentId === props.selectedEnrollmentId}
            data-on={tab.enrollmentId === props.selectedEnrollmentId ? "1" : "0"}
            onClick={() => props.onSelectEnrollment(tab.enrollmentId)}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div className="la-card mb-4">
        <p className="text-sm">
          {pipeline.packageName} · {pipeline.status}
          {pipeline.killSwitch ? " · kill switch on" : ""}
        </p>
        <p className="mt-1 text-sm text-muted">
          {pipeline.monthlyLabel} · {pipeline.setupFeeLabel} · setup {pipeline.setupPayment} · monthly {pipeline.monthlyPayment}
        </p>
        <p className="mt-1 text-sm text-muted">Started {pipeline.startedOn} · renews {pipeline.renewsOn}</p>
        <p className="mt-1 text-sm text-muted">Next scheduled run: {pipeline.nextRunAt || "none queued"}</p>
        <p className="mt-2 text-sm text-muted">This view refreshes every 2 seconds while the desk is open. Due steps advance on their own.</p>
        {pipeline.bundle ? (
          <div className="mt-3" data-bundle-status={pipeline.bundle.status}>
            <p className="text-sm">Aggregated status: {statusWord(pipeline.bundle.status)}</p>
            <ul className="mt-2 text-sm">
              {pipeline.bundle.members.map((member) => (
                <li key={member.packageId} data-bundle-member={member.packageId}>
                  {member.name} · {statusWord(member.status)}
                  {member.deduped ? " · already purchased separately" : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onStatus(pipeline.enrollmentId, "paused")}>Pause</button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onStatus(pipeline.enrollmentId, "active")}>Resume</button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onStatus(pipeline.enrollmentId, "cancelled")}>Cancel</button>
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onKill(pipeline.enrollmentId, !pipeline.killSwitch)}>
            {pipeline.killSwitch ? "Clear kill switch" : "Kill switch"}
          </button>
          <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onPayment(pipeline.enrollmentId, "setup", "recorded")}>Mark setup recorded</button>
          <button type="button" className="la-btn la-btn-quiet" onClick={() => props.onPayment(pipeline.enrollmentId, "monthly", "recorded")}>Mark monthly recorded</button>
        </div>
      </div>
      {pipeline.steps.map((step) => {
        const showGroup = step.group !== lastGroup;
        lastGroup = step.group;
        return (
          <article key={step.id} className="la-card" data-step-status={step.status}>
            {showGroup ? <p className="la-kicker mb-2">{step.group}</p> : null}
            <h2 className="text-lg font-display flex items-center gap-2">
              <span className={dotClass(step.status)} />
              {step.title}
            </h2>
            <StepFacts statusLabel={step.statusLabel} attempts={step.attempts} lastError={step.lastError} nextRunAt={step.nextRunAt} />
            <p className="mt-1 text-sm text-muted">
              Started {step.startedAt || "—"} · Finished {step.finishedAt || "—"}
            </p>
            {step.output ? <p className="mt-2 text-sm">{step.output}</p> : null}
            {step.logs.length ? (
              <ul className="mt-2 text-sm text-muted">
                {step.logs.map((log, index) => (
                  <li key={`${log.at}-${index}`}>{log.at} — {log.message}</li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
      <LeadCadence
        leads={props.leads}
        workspaceKill={props.workspaceKill}
        enrollmentId={pipeline.enrollmentId}
        onCaptureLead={props.onCaptureLead}
        onLeadReply={props.onLeadReply}
        onWorkspaceKill={props.onWorkspaceKill}
      />
      <PackageRunPanel
        clientId={props.clientId}
        enrollmentId={pipeline.enrollmentId}
        runs={props.runs}
        leadGenKill={props.leadGenKill}
        aiKill={props.aiKill}
        reviewsKill={props.reviewsKill}
        adsKill={props.adsKill}
        metaKill={props.metaKill}
        officeKill={props.officeKill}
        onSaveIntake={props.onSaveIntake}
        onCaptureGeneratedLead={props.onCaptureGeneratedLead}
        onLeadGenKill={props.onLeadGenKill}
        onAiKill={props.onAiKill}
        onReviewsKill={props.onReviewsKill}
        onAdsKill={props.onAdsKill}
        onRecordAdsMetrics={props.onRecordAdsMetrics}
        onApproveAdsChange={props.onApproveAdsChange}
        onMarkAdsAmbiguous={props.onMarkAdsAmbiguous}
        onMetaKill={props.onMetaKill}
        onOfficeKill={props.onOfficeKill}
        onSaveMetaBudget={props.onSaveMetaBudget}
        onApproveMeta={props.onApproveMeta}
        onMarkMetaAmbiguous={props.onMarkMetaAmbiguous}
        onSaveOfficeWorkflow={props.onSaveOfficeWorkflow}
        onMarkOfficeAmbiguous={props.onMarkOfficeAmbiguous}
      />
      <ReviewsPanel
        enrollmentId={pipeline.enrollmentId}
        reviews={props.reviews}
        onRecordJob={props.onRecordJob}
        onRecordStoredReview={props.onRecordStoredReview}
      />
      <EstimatePanel
        enrollmentId={pipeline.enrollmentId}
        estimates={props.estimates}
        estimatesKill={props.estimatesKill}
        onRecord={props.onRecordEstimate}
        onDecide={props.onDecideEstimate}
        onKill={props.onEstimatesKill}
      />
      <AppointmentPanel
        enrollmentId={pipeline.enrollmentId}
        appointments={props.appointments}
        appointmentsKill={props.appointmentsKill}
        onRecord={props.onRecordAppointment}
        onReply={props.onAppointmentReply}
        onKill={props.onAppointmentsKill}
      />
    </section>
  );
}
