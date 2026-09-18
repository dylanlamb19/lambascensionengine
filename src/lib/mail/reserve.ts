export type ReserveResult = "won" | "lost";

export type CapState = { first: number; followups: number; lastSentAt: number | null };

export type Caps = { maxFirst: number; maxFollowups: number; minDelayMinutes: number };

/** Mutex-friendly in-memory reservation used by tests and mirrored in SQL. */
export function makeKeyReserver(): (key: string) => Promise<ReserveResult> {
  let chain = Promise.resolve();
  const keys = new Set<string>();
  return (key: string) => {
    const run = chain.then((): ReserveResult => {
      if (keys.has(key)) return "lost";
      keys.add(key);
      return "won";
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}

export function reserveCap(state: CapState, caps: Caps, kind: "first" | "followup", now: number): boolean {
  if (state.lastSentAt != null && now - state.lastSentAt < caps.minDelayMinutes * 60 * 1000) return false;
  if (kind === "first") {
    if (state.first >= caps.maxFirst) return false;
    state.first += 1;
  } else {
    if (state.followups >= caps.maxFollowups) return false;
    state.followups += 1;
  }
  state.lastSentAt = now;
  return true;
}

export function makeCapReserver(state: CapState, caps: Caps): (kind: "first" | "followup", now: number) => Promise<boolean> {
  let chain = Promise.resolve();
  return (kind, now) => {
    const run = chain.then(() => reserveCap(state, caps, kind, now));
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}
