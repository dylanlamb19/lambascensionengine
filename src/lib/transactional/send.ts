import { randomBytes } from "node:crypto";
import type { TransactionalKind, TransactionalMail } from "../account/types.ts";

/**
 * Transactional mail for verification, password reset, and workspace invites.
 * This module does not import the sales outreach sender, send caps, or suppression list.
 * The default sender writes a dry-run row and does not open a network connection.
 */
export type TransactionalDraft = {
  kind: TransactionalKind;
  to: string;
  subject: string;
  body: string;
  tenantId: string | null;
  at: string;
};

export interface TransactionalSender {
  readonly channel: "transactional";
  send(input: TransactionalDraft): TransactionalMail;
}

export function createDryRunSender(): TransactionalSender {
  return {
    channel: "transactional",
    send(input) {
      return {
        id: randomBytes(16).toString("hex"),
        channel: "transactional",
        kind: input.kind,
        to: input.to,
        subject: input.subject,
        body: input.body,
        mode: "dry_run",
        tenantId: input.tenantId,
        at: input.at,
      };
    },
  };
}

export const dryRunTransactionalSender: TransactionalSender = createDryRunSender();

export function deliverTransactional(
  log: readonly TransactionalMail[],
  input: TransactionalDraft,
  sender: TransactionalSender = dryRunTransactionalSender,
): { log: TransactionalMail[]; message: TransactionalMail } {
  if (sender.channel !== "transactional") {
    throw new Error("Refusing a sender that is not the transactional channel.");
  }
  const message = sender.send(input);
  if (message.mode !== "dry_run" || message.channel !== "transactional") {
    throw new Error("The transactional sender recorded a row that is not a dry run.");
  }
  return { message, log: [...log, message] };
}
