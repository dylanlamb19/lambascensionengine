/**
 * Pure owner-bootstrap decision. Production creates the owner once from
 * OWNER_EMAIL / OWNER_PASSWORD, then never resets credentials from env.
 */

export type OwnerBootstrapAction =
  | "no_env"
  | "default_password_blocked"
  | "insert_owner"
  | "owner_exists"
  | "preview_reset";

export function ownerBootstrapPlan(input: {
  email?: string;
  password?: string;
  ownerExists: boolean;
  workspacePreview: boolean;
  vercelProduction: boolean;
  productionLike: boolean;
}): OwnerBootstrapAction {
  const email = input.email?.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) return "no_env";
  if (input.productionLike && (password === "changeme" || password === "change-me")) {
    return "default_password_blocked";
  }
  if (!input.ownerExists) return "insert_owner";
  // Belt and suspenders: Vercel Production never resets, even if preview
  // detection were wrong.
  if (input.vercelProduction || !input.workspacePreview) return "owner_exists";
  return "preview_reset";
}
