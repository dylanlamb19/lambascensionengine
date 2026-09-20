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
} as const;

export type FlagName = keyof typeof FLAGS;
