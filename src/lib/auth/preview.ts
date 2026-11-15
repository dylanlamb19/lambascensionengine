/**
 * Shared LIVE-PREVIEW OAuth client (server-only — NEVER import from the client).
 *
 * The sandbox serves each live preview on a dynamic `https://*.grok-sandbox.com`
 * URL, which can't be pre-registered per app. The broker instead exposes ONE
 * shared "preview" client that accepts any
 * `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`
 * (broker: `app-builder-deployer/auth/src/preview-oauth.ts`).
 *
 * The client id is public. The client secret is NOT in source: set
 * `GROK_PREVIEW_CLIENT_SECRET` in the host environment (Vercel). Deployed apps
 * inject a per-app `GROK_AUTH_CLIENT_SECRET`, which takes precedence. If neither
 * secret is set, preview sign-in stays off — there is no built-in fallback.
 *
 * The secret must match the broker's `GROK_PREVIEW_CLIENT_SECRET` (the broker
 * stores only `base64url(SHA-256)` of it). This is a dedicated, low-privilege
 * client (preview-only, `*.grok-sandbox.com`). Rotate it on the broker and set
 * the new value in the deploy env; do not commit it.
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/** Env var that carries the shared preview client secret. Never commit a value. */
export const PREVIEW_CLIENT_SECRET_ENV = "GROK_PREVIEW_CLIENT_SECRET";

/** Env var the deployer injects for a per-app client. Takes precedence. */
export const DEPLOYED_CLIENT_SECRET_ENV = "GROK_AUTH_CLIENT_SECRET";

/**
 * Logged when federated preview sign-in cannot start. Static text only —
 * never include a secret value.
 */
export const PREVIEW_SIGN_IN_DISABLED_MESSAGE =
  "[auth] Preview sign-in is disabled: GROK_PREVIEW_CLIENT_SECRET is unset " +
  "and GROK_AUTH_CLIENT_SECRET is unset. Set GROK_PREVIEW_CLIENT_SECRET for " +
  "live preview, or GROK_AUTH_CLIENT_SECRET when deployed. No fallback secret is used.";

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * `https://<preview-host>/api/auth/oauth2/callback/...` the broker allows.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;

export type GrokClientSecretSource =
  | typeof DEPLOYED_CLIENT_SECRET_ENV
  | typeof PREVIEW_CLIENT_SECRET_ENV
  | null;

export type GrokClientCredentials = {
  clientId: string;
  /** Present only when an env var supplied it. Never a built-in default. */
  clientSecret: string | undefined;
  secretSource: GrokClientSecretSource;
  /** False when no client secret is configured — preview sign-in must stay off. */
  previewSignInEnabled: boolean;
};

type EnvLike = Record<string, string | undefined>;

function readEnvValue(env: EnvLike, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * Resolve broker client credentials from the environment.
 *
 * `GROK_AUTH_CLIENT_SECRET` (deployed per-app client) wins. Otherwise
 * `GROK_PREVIEW_CLIENT_SECRET` enables the shared preview client. If both are
 * missing or blank, preview sign-in is disabled.
 */
export function resolveGrokClientCredentials(env: EnvLike): GrokClientCredentials {
  const clientId = readEnvValue(env, "GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
  const deployedSecret = readEnvValue(env, DEPLOYED_CLIENT_SECRET_ENV);
  const previewSecret = readEnvValue(env, PREVIEW_CLIENT_SECRET_ENV);
  if (deployedSecret) {
    return {
      clientId,
      clientSecret: deployedSecret,
      secretSource: DEPLOYED_CLIENT_SECRET_ENV,
      previewSignInEnabled: true,
    };
  }
  if (previewSecret) {
    return {
      clientId,
      clientSecret: previewSecret,
      secretSource: PREVIEW_CLIENT_SECRET_ENV,
      previewSignInEnabled: true,
    };
  }
  return {
    clientId,
    clientSecret: undefined,
    secretSource: null,
    previewSignInEnabled: false,
  };
}
