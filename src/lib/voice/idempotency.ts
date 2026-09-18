export function makeActionId(intent: string, target: string | number | null, transcript: string): string {
  return `${intent}:${target ?? ""}:${transcript.trim().toLowerCase()}`;
}

/** How long an armed confirmation ("Approve this? Say Confirm.") stays valid. */
const CONFIRM_TTL_MS = 25_000;

export class ActionGate {
  private last = "";
  private lastAt = 0;
  private pending: { id: string; intent: string; target: string | null; armedAt: number; fingerprint: string } | null = null;

  seen(id: string, windowMs = 2000): boolean {
    const now = Date.now();
    if (this.last === id && now - this.lastAt < windowMs) return true;
    this.last = id;
    this.lastAt = now;
    return false;
  }

  /**
   * Arm a pending confirmation bound to a prospect UID (not a colliding numeric id).
   * `fingerprint` optionally binds the confirmation to more than just the target
   * — e.g. a hash of the current draft body for a SEND action.
   */
  arm(intent: string, target: string | null, fingerprint = ""): string {
    const id = `${intent}:${target}:${Date.now()}`;
    this.pending = { id, intent, target, armedAt: Date.now(), fingerprint };
    return id;
  }

  consumeConfirm(target: string | null, fingerprint?: string): { ok: boolean; intent: string; target: string | null; expired: boolean } {
    const p = this.pending;
    this.pending = null;
    if (!p) return { ok: false, intent: "", target: null, expired: false };
    if (Date.now() - p.armedAt > CONFIRM_TTL_MS) {
      return { ok: false, intent: p.intent, target: p.target, expired: true };
    }
    if (target != null && p.target != null && target !== p.target) {
      return { ok: false, intent: p.intent, target: p.target, expired: false };
    }
    if (fingerprint !== undefined && p.fingerprint && fingerprint !== p.fingerprint) {
      return { ok: false, intent: p.intent, target: p.target, expired: false };
    }
    return { ok: true, intent: p.intent, target: p.target, expired: false };
  }

  cancel(): void {
    this.pending = null;
  }
}
