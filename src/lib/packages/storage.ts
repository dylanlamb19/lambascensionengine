import { replaceTenant, sliceTenant } from "./tenancy.ts";
import { EMPTY_FULFILLMENT, type FulfillmentState } from "./types.ts";

const KEY_PREFIX = "la_package_fulfillment_v1";

export function fulfillmentStorageKey(tenantId: string): string {
  return `${KEY_PREFIX}:${tenantId}`;
}

export function loadFulfillmentLocal(tenantId: string): FulfillmentState {
  if (typeof window === "undefined" || !tenantId) return { ...EMPTY_FULFILLMENT };
  try {
    const raw = window.localStorage.getItem(fulfillmentStorageKey(tenantId));
    if (!raw) return { ...EMPTY_FULFILLMENT };
    const parsed = JSON.parse(raw) as { version?: number; state?: FulfillmentState };
    if (parsed.version !== 1 || !parsed.state) return { ...EMPTY_FULFILLMENT };
    return sliceTenant(parsed.state, tenantId);
  } catch {
    return { ...EMPTY_FULFILLMENT };
  }
}

export function saveFulfillmentLocal(tenantId: string, state: FulfillmentState): void {
  if (typeof window === "undefined" || !tenantId) return;
  const isolated = sliceTenant(state, tenantId);
  window.localStorage.setItem(
    fulfillmentStorageKey(tenantId),
    JSON.stringify({ version: 1, state: replaceTenant(EMPTY_FULFILLMENT, tenantId, isolated) }),
  );
}
