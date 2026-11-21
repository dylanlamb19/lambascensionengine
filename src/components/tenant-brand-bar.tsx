import { clientFacingBrand, shellBrandStyle } from "@/lib/account/brand";
import { FLAGS } from "@/lib/flags";
import type { FulfillmentState } from "@/lib/packages/types";

/** Client-facing brand for one tenant. Hidden while self-serve signup is off. */
export function TenantBrandBar(props: { state: FulfillmentState; tenantId: string }) {
  if (!FLAGS.SELF_SERVE_SIGNUP) return null;
  const brand = clientFacingBrand(props.state, props.tenantId);
  if (!brand) return null;
  const style = shellBrandStyle(props.state, props.tenantId, true);
  const mark = brand.senderDisplayName.slice(0, 2).toUpperCase();
  return (
    <div className="mb-4 flex items-center gap-3" data-client-brand={props.tenantId} style={style}>
      <span className="la-mark" style={brand.primary ? { background: brand.primary, color: "#fff" } : undefined}>{mark}</span>
      <div>
        <div className="font-display text-xl">{brand.senderDisplayName}</div>
        <div className="text-sm text-muted">{brand.name} · {brand.timezone}</div>
      </div>
    </div>
  );
}
