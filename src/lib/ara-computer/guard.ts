import type { ComputerDriver } from "./types.ts";

const HIGH_RISK = [
  /approve\s*&\s*send/i,
  /approve and send/i,
  /^send$/i,
  /send (the |that )?(email|message)/i,
  /confirm send/i,
  /approve sequence/i,
  /approve (the )?follow-?ups/i,
  /schedule/i,
  /book (a |the )?call/i,
  /disable test mode/i,
  /turn off test mode/i,
  /billing/i,
  /ad spend/i,
  /budget/i,
];

export function controlRisk(name: string): "LOW" | "MEDIUM" | "HIGH" {
  const n = (name || "").trim();
  if (!n) return "LOW";
  if (HIGH_RISK.some((re) => re.test(n))) return "HIGH";
  if (/skip|do not contact|stop follow/i.test(n)) return "MEDIUM";
  return "LOW";
}

export function clickAllowed(
  name: string,
  _driver: ComputerDriver,
): { ok: true } | { ok: false; reason: string } {
  const label = (name || "").trim();
  if (/^(stop|voice off|mute)$/i.test(label)) {
    return {
      ok: false,
      reason: "The Conversation Stop button is owner-only. Say stop talking to interrupt Ara, or stop conversation mode to disconnect.",
    };
  }
  if (controlRisk(label) === "HIGH") {
    return {
      ok: false,
      reason: "That action is protected. Ara can open the screen, but she cannot send, book, or turn off Test Mode by clicking. Say Confirm send if you want the email sent.",
    };
  }
  return { ok: true };
}

export function selectorRejected(args: Record<string, unknown>): boolean {
  return Boolean(args.selector || args.css || args.xpath || args.query || args.javascript || args.code);
}

export function pointerAllowed(_driver: ComputerDriver): { ok: true } | { ok: false; reason: string } {
  return { ok: true };
}
