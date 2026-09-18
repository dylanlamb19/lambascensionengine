import { randomBytes, timingSafeEqual } from "node:crypto";

export type OauthKind = "gmail" | "calendar";

export type OauthStateRecord = {
  state: string;
  userId: string;
  kind: OauthKind;
  nonce: string;
  expiresAt: number;
  usedAt: number | null;
};

export function mintOauthState(userId: string, kind: OauthKind, now = Date.now()): OauthStateRecord {
  return {
    state: randomBytes(24).toString("base64url"),
    userId,
    kind,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: now + 10 * 60 * 1000,
    usedAt: null,
  };
}

export function consumeOauthState(
  rows: OauthStateRecord[],
  incoming: string,
  now = Date.now(),
): { ok: true; record: OauthStateRecord } | { ok: false; reason: string } {
  const hit = rows.find((r) => safeEqual(r.state, incoming));
  if (!hit) return { ok: false, reason: "This Google sign-in link is not valid. Start Connect Gmail again." };
  if (hit.usedAt) return { ok: false, reason: "That Google sign-in link was already used. Start Connect Gmail again." };
  if (now > hit.expiresAt) return { ok: false, reason: "That Google sign-in link expired. Start Connect Gmail again." };
  hit.usedAt = now;
  return { ok: true, record: hit };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
