import { FORBIDDEN_DESIGN_FIELDS, type DesignOp } from "./types.ts";

const FORBIDDEN_OP = /auth|password|secret|token|api_key|database|sql|gmail|calendar|send_email|test_mode|billing|permission|security|eval|javascript|css_raw|innerhtml/i;

export function designOpBlocked(op: DesignOp): string | null {
  const blob = JSON.stringify(op);
  for (const field of FORBIDDEN_DESIGN_FIELDS) {
    if (new RegExp(`"${field}"\\s*:`, "i").test(blob) && field !== "prospect") {
      return "That change is outside Design Director. It cannot touch security, mail, or business data.";
    }
  }
  if (FORBIDDEN_OP.test(blob) && op.op !== "set_background" && op.op !== "set_background_overlay") {
    return "That change is outside Design Director. Lamb Ascension keeps those controls owner-only.";
  }
  return null;
}

export function rejectPrivilegeEscalation(name: string): string | null {
  const n = (name || "").toLowerCase();
  if (/auth|secret|key|token|permission|policy|test.?mode|send|gmail|calendar|database|billing|deploy/.test(n)) {
    return "Design Director cannot change permissions, secrets, mail, calendar, Test Mode, or business logic.";
  }
  return null;
}
