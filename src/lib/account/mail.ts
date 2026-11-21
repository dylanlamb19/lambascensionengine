import { deliverTransactional } from "../transactional/send.ts";
import type { AccountMail, AccountState } from "./types.ts";

/**
 * Account mail goes through the transactional dry-run sender.
 * It does not import the sales outreach sender, send caps, or suppression list.
 */
export function logAccountMail(
  accounts: AccountState,
  input: { kind: AccountMail["kind"]; to: string; subject: string; body: string; at: string; tenantId?: string | null },
): { accounts: AccountState; mail: AccountMail } {
  const delivered = deliverTransactional(accounts.transactional || [], {
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    body: input.body,
    tenantId: input.tenantId ?? null,
    at: input.at,
  });
  const mail: AccountMail = {
    id: delivered.message.id,
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    body: input.body,
    mode: "dry_run",
    at: input.at,
  };
  return {
    mail,
    accounts: { ...accounts, mail: [...accounts.mail, mail], transactional: delivered.log },
  };
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
