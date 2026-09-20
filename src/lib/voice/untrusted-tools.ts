import { executeAllowlistedTool, isAllowedTool, type AraDeskContext } from "./tools.ts";

/**
 * Spoken user text / prospect email / research / web copy is untrusted.
 * It must never become a tool invocation on its own.
 */
export function toolsInvokedByUntrustedText(_text: string): string[] {
  return [];
}

export function executeIfUntrustedSource(
  name: string,
  args: Record<string, unknown>,
  ctx: AraDeskContext,
  source: "email" | "research" | "web",
) {
  return executeAllowlistedTool(name, args, ctx, source);
}

export function ownerSessionMayCall(name: string): boolean {
  return isAllowedTool(name);
}
