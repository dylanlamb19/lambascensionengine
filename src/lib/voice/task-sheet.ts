/** How long the task sheet ignores the tap that opened it. Covers mobile ghost clicks. */
export const TASK_SHEET_DISMISS_GUARD_MS = 450;

/** Keep a desk-authored Ara line if a cancelled voice turn sends a shorter fragment. */
export const DESK_REPLY_HOLD_MS = 1600;

export function shouldCloseTaskSheet(openedAt: number, now: number, targetIsBackdrop: boolean): boolean {
  if (!targetIsBackdrop) return false;
  if (!Number.isFinite(openedAt) || !Number.isFinite(now)) return false;
  return now - openedAt >= TASK_SHEET_DISMISS_GUARD_MS;
}

/**
 * A realtime transcript delta is one chunk, not the whole sentence.
 * An aborted turn can finish with an empty or tiny string and wipe the task ack.
 */
export function mergeAraCaption(
  prev: string,
  incoming: string,
  opts: { isFinal: boolean; deskSpokenAt: number; now: number },
): string {
  const prior = prev || "";
  const next = incoming || "";
  const priorClean = prior.trim();
  const nextClean = next.trim();
  const held = priorClean.length > 0 && opts.now - opts.deskSpokenAt < DESK_REPLY_HOLD_MS;
  if (!nextClean && held) return prior;
  if (held && nextClean.length < priorClean.length) return prior;
  if (!opts.isFinal && !nextClean) return prior;
  return next;
}
