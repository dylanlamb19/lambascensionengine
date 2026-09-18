import { parseSpokenCommand } from "../voice/intents.ts";
import { toolsInvokedByUntrustedText } from "../voice/untrusted-tools.ts";

/**
 * Prospect email is UNTRUSTED INPUT.
 * A body that looks like a voice command must never become one.
 */
export function emailCannotBecomeCommand(body: string): true {
  const parsed = parseSpokenCommand(body);
  void parsed;
  void toolsInvokedByUntrustedText(body);
  return true;
}

export function looksLikeInjection(body: string): boolean {
  const t = (body || "").toLowerCase();
  return /ignore (previous|your) instructions|send me your password|you are now/.test(t);
}
