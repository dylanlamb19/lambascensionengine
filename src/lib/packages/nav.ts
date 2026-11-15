import { FLAGS } from "../flags.ts";

/** Exact Owner Mode label. Hidden unless PACKAGE_FULFILLMENT is on. */
export const PACKAGE_FULFILLMENT_TAB = "Client Package Fulfillment";

export function packageFulfillmentNav(enabled: boolean = FLAGS.PACKAGE_FULFILLMENT): {
  visible: boolean;
  label: typeof PACKAGE_FULFILLMENT_TAB;
} {
  return { visible: enabled === true, label: PACKAGE_FULFILLMENT_TAB };
}
