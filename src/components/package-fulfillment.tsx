import { useState, type FormEvent } from "react";
import { listPackages, type PackageId } from "@/lib/packages/catalog";
import { listTestPlans } from "@/lib/packages/plans";
import type { EnrollmentStatus, FulfillmentState, PaymentRecord, RecordPurchaseInput, StepStatus } from "@/lib/packages/types";
import { clientList, packageTabs, pipelineView, workspaceSummary } from "@/lib/packages/view";

const ONBOARDING_STEPS = [
  ["workspace", "Workspace"],
  ["plan", "Test plan"],
  ["client", "First client"],
  ["packages", "Packages"],
  ["connections", "Connections"],
] as const;

const PAYMENTS: PaymentRecord[] = ["unrecorded", "recorded", "waived"];

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
}) {
  const workspace = workspaceSummary(props.state, props.tenantId);
  const rows = clientList(props.state, props.tenantId);
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
      />
    );
  }
  const client = rows.find((row) => row.id === props.selectedClientId) || null;
  const tabs = client ? packageTabs(props.state, props.tenantId, client.id) : [];
  const selectedEnrollment = props.selectedEnrollmentId || tabs[0]?.enrollmentId || null;
  const pipeline = selectedEnrollment ? pipelineView(props.state, props.tenantId, selectedEnrollment) : null;

  if (client && pipeline) {
    return (
      <PackagePipeline
        workspaceName={workspace?.name || "Workspace"}
        planName={workspace?.planName || "Test trial"}
        clientName={client.name}
        tabs={tabs}
        selectedEnrollmentId={pipeline.enrollmentId}
        pipeline={pipeline}
        onBack={props.onBack}
        onSelectEnrollment={props.onSelectEnrollment}
        onStatus={props.onStatus}
        onKill={props.onKill}
        onPayment={props.onPayment}
      />
    );
  }

  return (
    <section data-fulfillment-root="1" data-tenant-id={props.tenantId}>
      <p className="la-kicker">Client Package Fulfillment</p>
      <h1 className="font-display mt-2 mb-2 text-3xl">Clients and packages</h1>
      <p className="mb-4 text-sm text-muted">
        {workspace
          ? `${workspace.name} · ${workspace.planName} · test mode. This workspace only. No card and no charge.`
          : "This workspace is not open yet."}
      </p>
      {workspace ? <ConnectionChecklist workspace={workspace} onConnect={props.onConnect} onDisconnect={props.onDisconnect} /> : null}
      <RecordForm onRecord={props.onRecord} />
      <div className="la-card">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No clients recorded in this workspace yet.</p>
        ) : (
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
      <h1 className="font-display mt-2 mb-2 text-3xl">Set up this workspace</h1>
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
  onBack: () => void;
  onSelectEnrollment: (id: string) => void;
  onStatus: (enrollmentId: string, status: EnrollmentStatus) => void;
  onKill: (enrollmentId: string, on: boolean) => void;
  onPayment: (enrollmentId: string, which: "setup" | "monthly", value: PaymentRecord) => void;
}) {
  const pipeline = props.pipeline;
  let lastGroup = "";
  return (
    <section data-fulfillment-root="1" data-pipeline="1">
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
            <p className="mt-1 text-sm">{step.statusLabel}</p>
            <p className="mt-1 text-sm text-muted">
              Started {step.startedAt || "—"} · Finished {step.finishedAt || "—"} · Next {step.nextRunAt || "—"}
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
    </section>
  );
}
