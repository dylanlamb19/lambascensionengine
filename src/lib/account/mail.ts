import { newId } from "./crypto.ts";
import type { AccountMail, AccountState } from "./types.ts";

/**
 * Account mail is a dry-run log. It does not import a sender,
 * does not read send caps, and does not open a network connection.
 */
export function logAccountMail(
  accounts: AccountState,
  input: { kind: AccountMail["kind"]; to: string; subject: string; body: string; at: string },
): { accounts: AccountState; mail: AccountMail } {
  const mail: AccountMail = {
    id: newId(),
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    body: input.body,
    mode: "dry_run",
    at: input.at,
  };
  return { mail, accounts: { ...accounts, mail: [...accounts.mail, mail] } };
}

export function verificationNote(token: string, workspaceName: string): { subject: string; body: string } {
  return {
    subject: "Verify your workspace",
    body: [
      `Confirm ${workspaceName}.`,
      "This note was recorded in dry-run mode. Nothing was sent.",
      `code: ${token}`,
    ].join("\n"),
  };
}

export function resetNote(token: string): { subject: string; body: string } {
  return {
    subject: "Reset your password",
    body: [
      "A password reset was recorded in dry-run mode. Nothing was sent.",
      `code: ${token}`,
    ].join("\n"),
  };
}
