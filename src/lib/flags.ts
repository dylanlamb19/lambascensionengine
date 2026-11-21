/**
 * Recovery flags for LambAscensionEngine.
 * Experimental systems stay in the tree (see git tag broken-post-last-night-backup)
 * but are OFF until Dylan confirms the recovered core feels stable.
 *
 * These are compile-time product switches, not secrets.
 */
export const FLAGS = {
  AI_IMAGE_GENERATION: false,
  ARA_DEVELOPER_MODE: false,
  EXPERIMENTAL_VOICE_FEATURES: false,
  DESIGN_DIRECTOR: false,
  /** Client package tracker, fulfillment tab, and pipelines. Off until explicitly enabled. */
  PACKAGE_FULFILLMENT: false,
  /**
   * Marketer self-serve signup, verification, password reset, and workspace settings.
   * Off until explicitly enabled. Better Auth public registration stays disabled.
   */
  SELF_SERVE_SIGNUP: false,
  /**
   * Test-mode subscription scaffold: plan catalog, checkout, portal stub, and webhooks.
   * Off until explicitly enabled. It does not call a payment provider and it does not charge.
   */
  BILLING_SCAFFOLD: false,
  /**
   * Workspace seats: email invites, accept, roles, and ownership transfer.
   * Off until explicitly enabled. Invites are recorded by the transactional dry-run sender.
   */
  TEAM_SEATS: false,
  /**
   * Export a workspace and close it, with a 30 day restore.
   * Off until explicitly enabled. Closing is limited to the owner.
   */
  WORKSPACE_LIFECYCLE: false,
} as const;

export type FlagName = keyof typeof FLAGS;
