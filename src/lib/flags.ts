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
} as const;

export type FlagName = keyof typeof FLAGS;
