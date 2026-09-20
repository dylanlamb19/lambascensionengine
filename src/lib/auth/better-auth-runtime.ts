/**
 * How this app's Better Auth instance picks its public URL and signing secret.
 * Production must use the configured env values — never a preview fallback.
 * Never log the secret.
 */

export type BetterAuthRuntime = {
  baseURL: string | undefined;
  secret: string;
  usesConfiguredUrl: boolean;
  usesConfiguredSecret: boolean;
};

export function resolveBetterAuthRuntime(input: {
  betterAuthUrl?: string | null;
  betterAuthSecret?: string | null;
  previewSecret: string;
}): BetterAuthRuntime {
  const baseURL = input.betterAuthUrl?.trim() || undefined;
  const configuredSecret = input.betterAuthSecret?.trim() || undefined;
  return {
    baseURL,
    secret: configuredSecret ?? input.previewSecret,
    usesConfiguredUrl: Boolean(baseURL),
    usesConfiguredSecret: Boolean(configuredSecret),
  };
}
