import { workspaceFor } from "./tenancy.ts";
import type { ConnectionKind, CredentialPort, FulfillmentState, WorkspaceConnection } from "./types.ts";

export const CONNECTION_KINDS = [
  "mailbox",
  "google_ads",
  "meta",
  "gbp",
  "cms",
  "booking_calendar",
  "job_feed",
  "estimate_feed",
  "tracking",
] as const satisfies readonly ConnectionKind[];

const LABELS: Record<ConnectionKind, string> = {
  mailbox: "Mailbox",
  google_ads: "Google Ads",
  meta: "Meta",
  gbp: "Google Business Profile",
  cms: "CMS",
  booking_calendar: "Booking calendar",
  job_feed: "Job feed",
  estimate_feed: "Estimate feed",
  tracking: "Tracking",
};

const INTEGRATION_KIND: Record<string, ConnectionKind> = {
  client_mailbox: "mailbox",
  google_ads_api: "google_ads",
  meta_marketing_api: "meta",
  gbp_api: "gbp",
  client_cms: "cms",
  client_site: "cms",
  landing_host: "cms",
  client_booking_calendar: "booking_calendar",
  job_feed: "job_feed",
  estimate_source: "estimate_feed",
  tracking: "tracking",
};

export function isConnectionKind(value: string): value is ConnectionKind {
  return (CONNECTION_KINDS as readonly string[]).includes(value);
}

export function connectionLabel(kind: ConnectionKind): string {
  return LABELS[kind];
}

export function connectionForIntegration(integration: string): ConnectionKind | null {
  return INTEGRATION_KIND[integration] || null;
}

export function listConnections(state: FulfillmentState, tenantId: string): WorkspaceConnection[] {
  if (!workspaceFor(state, tenantId)) return [];
  return CONNECTION_KINDS.map((kind) => {
    const row = (state.connections || []).find((item) => item.tenantId === tenantId && item.kind === kind);
    return row || { tenantId, kind, label: LABELS[kind], status: "missing" as const, connectedAt: null };
  });
}

export type ConnectResult =
  | { ok: true; state: FulfillmentState; connection: WorkspaceConnection }
  | { ok: false; state: FulfillmentState; reason: string };

/**
 * Record a test connection for this workspace only.
 * Stores a status flag. It does not accept or persist a credential.
 */
export function stubConnect(state: FulfillmentState, tenantId: string, kind: string, now: string): ConnectResult {
  if (!workspaceFor(state, tenantId)) return { ok: false, state, reason: "Open this workspace before connecting anything." };
  if (!isConnectionKind(kind)) return { ok: false, state, reason: "Unknown connection." };
  const connection: WorkspaceConnection = {
    tenantId,
    kind,
    label: LABELS[kind],
    status: "stub_connected",
    connectedAt: now,
  };
  const connections = [
    ...(state.connections || []).filter((row) => !(row.tenantId === tenantId && row.kind === kind)),
    connection,
  ];
  return { ok: true, connection, state: { ...state, connections } };
}

export function stubDisconnect(state: FulfillmentState, tenantId: string, kind: string): ConnectResult {
  if (!workspaceFor(state, tenantId)) return { ok: false, state, reason: "Open this workspace before changing a connection." };
  if (!isConnectionKind(kind)) return { ok: false, state, reason: "Unknown connection." };
  const connection: WorkspaceConnection = {
    tenantId,
    kind,
    label: LABELS[kind],
    status: "missing",
    connectedAt: null,
  };
  const connections = [
    ...(state.connections || []).filter((row) => !(row.tenantId === tenantId && row.kind === kind)),
    connection,
  ];
  return { ok: true, connection, state: { ...state, connections } };
}

export function credentialsFor(state: FulfillmentState, tenantId: string): CredentialPort {
  const connected = new Set(
    listConnections(state, tenantId).filter((row) => row.status === "stub_connected").map((row) => row.kind),
  );
  return {
    has(integration: string) {
      const kind = connectionForIntegration(integration);
      return kind != null && connected.has(kind);
    },
  };
}

export function missingConnectionLine(kind: ConnectionKind, detail: string): string {
  const extra = detail.trim();
  return extra ? `Missing connection: ${connectionLabel(kind)}. ${extra}` : `Missing connection: ${connectionLabel(kind)}.`;
}
