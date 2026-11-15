import { useState, type FormEvent, type ReactNode } from "react";
import { SUBSCRIPTION_EDGES } from "@/lib/packages/billing";
import { demoSeedAllowed, loadDemoSeed } from "@/lib/packages/demo-seed";
import { formatUsd, listPackages, type PackageId } from "@/lib/packages/catalog";
import { getTestPlan, listTestPlans } from "@/lib/packages/plans";
import { usageFor } from "@/lib/packages/usage";
import { workspaceFor } from "@/lib/packages/tenancy";
import type { EnrollmentStatus, FulfillmentState, PaymentRecord, RecordPurchaseInput, StepStatus, SubscriptionLifecycle } from "@/lib/packages/types";
import { clientList, leadFollowUpView, packageTabs, pipelineView, workspaceSummary, type LeadView } from "@/lib/packages/view";

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

  if (client && pipeline) {
    return (
      <PackagePipeline
        workspaceName={workspace?.name || "Workspace"}
        planName={workspace?.planName || "Test trial"}
        clientName={client.name}
        tabs={tabs}
        selectedEnrollmentId={pipeline.enrollmentId}
        pipeline={pipeline}
        leads={leads}
        workspaceKill={workspace?.leadFollowUpKillSwitch === true}
        onBack={props.onBack}
        onSelectEnrollment={props.onSelectEnrollment}
        onStatus={props.onStatus}
        onKill={props.onKill}
        onPayment={props.onPayment}
        onCaptureLead={props.onCaptureLead}
        onLeadReply={props.onLeadReply}
        onWorkspaceKill={props.onWorkspaceKill}
        billing={<WorkspaceBilling {...props} />}
      />
    );
  }

  return (
    <section data-fulfillment-root="1" data-tenant-id={props.tenantId}>
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
      </p>
      {workspace ? (
        <div className="mb-4">
          <button type="button" className="la-btn la-btn-ghost" onClick={() => props.onWorkspaceKill(!workspace.leadFollowUpKillSwitch)}>
            {workspace.leadFollowUpKillSwitch ? "Clear workspace kill switch" : "Stop lead follow-up for this workspace"}
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
  clientName: string;
  tabs: { enrollmentId: string; name: string; status: EnrollmentStatus }[];
  selectedEnrollmentId: string;
  pipeline: NonNullable<ReturnType<typeof pipelineView>>;
  leads: LeadView[] | null;
  workspaceKill: boolean;
  onCaptureLead: (input: { enrollmentId: string; contactName: string; contactEmail: string }) => { ok: boolean; reason?: string };
  onLeadReply: (leadId: string) => void;
  onWorkspaceKill: (on: boolean) => void;
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
    </section>
  );
}
