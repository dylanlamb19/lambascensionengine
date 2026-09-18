/**
 * Local email/password for this app's Better Auth DB — not the broker.
 *
 * This is a private single-owner desk:
 * - sign-in is enabled
 * - public sign-up is DISABLED (Better Auth `disableSignUp`)
 * - the first owner is created only by server-side bootstrap from
 *   OWNER_EMAIL + OWNER_PASSWORD (never from a public form, never from
 *   frontend JavaScript)
 *
 * Do NOT flip `disableSignUp` off. Do NOT add a sign-up form.
 */
export const emailAndPasswordEnabled = true;

export const emailAndPasswordConfig = {
  enabled: true as const,
  disableSignUp: true as const,
};

export const EMAIL_PASSWORD_SIGN_UP_DISABLED = true;
