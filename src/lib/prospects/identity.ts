import type { Prospect } from "../review-brief.ts";
import { ensureUid } from "./ids.ts";

/** Canonical identity. Numeric `id` is display/legacy only. */
export function prospectUid(p: { uid?: string }): string {
  return p.uid || "";
}

export function findByUid(rows: Prospect[], uid: string | null | undefined): Prospect | undefined {
  if (!uid) return undefined;
  return rows.find((r) => r.uid === uid);
}

export function patchByUid(rows: Prospect[], next: Prospect): Prospect[] {
  const uid = next.uid;
  if (!uid) return [...rows, ensureUid(next)];
  let found = false;
  const out = rows.map((c) => {
    if (c.uid === uid) {
      found = true;
      return next;
    }
    return c;
  });
  return found ? out : [...out, ensureUid(next)];
}

/** Apply a change to one prospect by uid — never by colliding numeric id. */
export function applyByUid(rows: Prospect[], uid: string, fn: (p: Prospect) => Prospect): Prospect[] {
  return rows.map((c) => (c.uid === uid ? fn(c) : c));
}

export function withUids(rows: Prospect[]): Prospect[] {
  return rows.map(ensureUid);
}
