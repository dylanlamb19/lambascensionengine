import { EMPTY_FULFILLMENT, type FulfillmentState } from "../packages/types.ts";

export type DeskRole = "owner" | "admin" | "member";

export type AccountUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  emailVerified: boolean;
  createdAt: string;
};

export type PendingSignup = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  workspaceName: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type PasswordReset = {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
};

export type AccountSession = {
  id: string;
  userId: string;
  tenantId: string;
  role: DeskRole;
  csrfToken: string;
  createdAt: string;
  rotatedFrom: string | null;
};

export type Attempt = { key: string; at: string };

export type CsrfChallenge = { token: string; expiresAt: string };

export type AccountMail = {
  id: string;
  kind: "verify" | "reset";
  to: string;
  subject: string;
  body: string;
  mode: "dry_run";
  at: string;
};

export type LogoContentType = "image/png" | "image/jpeg" | "image/webp";

export type StoredLogo = {
  tenantId: string;
  contentType: LogoContentType;
  dataBase64: string;
  updatedAt: string;
};

export type AccountState = {
  users: AccountUser[];
  pending: PendingSignup[];
  resets: PasswordReset[];
  sessions: AccountSession[];
  attempts: Attempt[];
  challenges: CsrfChallenge[];
  mail: AccountMail[];
  logos: StoredLogo[];
};

/** In-memory account records plus the fulfillment rows they open. */
export type AccountBundle = {
  accounts: AccountState;
  fulfillment: FulfillmentState;
};

export function emptyAccounts(): AccountState {
  return {
    users: [],
    pending: [],
    resets: [],
    sessions: [],
    attempts: [],
    challenges: [],
    mail: [],
    logos: [],
  };
}

export function emptyBundle(): AccountBundle {
  return { accounts: emptyAccounts(), fulfillment: { ...EMPTY_FULFILLMENT } };
}
