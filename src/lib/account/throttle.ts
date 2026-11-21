import type { AccountState } from "./types.ts";

const DISPOSABLE = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamailblock.com",
  "tempmail.com",
  "10minutemail.com",
  "yopmail.com",
  "trashmail.com",
  "discard.email",
  "fakeinbox.com",
  "sharklasers.com",
];

const WINDOWS = {
  "signup:ip": { limit: 5, ms: 15 * 60_000 },
  "signup:email": { limit: 3, ms: 60 * 60_000 },
  "reset:ip": { limit: 5, ms: 15 * 60_000 },
  "reset:email": { limit: 3, ms: 60 * 60_000 },
  "login:ip": { limit: 8, ms: 15 * 60_000 },
  "verify:ip": { limit: 10, ms: 15 * 60_000 },
} as const;

export type ThrottleKind = keyof typeof WINDOWS;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1] || "";
  return DISPOSABLE.some((item) => domain === item || domain.endsWith(`.${item}`));
}

function fresh(attempts: AccountState["attempts"], nowMs: number): AccountState["attempts"] {
  const horizon = nowMs - 60 * 60_000;
  return attempts.filter((row) => Date.parse(row.at) >= horizon);
}

export function throttleBlocked(accounts: AccountState, kind: ThrottleKind, bucket: string, now: string): boolean {
  const rule = WINDOWS[kind];
  const nowMs = Date.parse(now);
  const key = `${kind}:${bucket}`;
  const count = fresh(accounts.attempts, nowMs).filter((row) => row.key === key && nowMs - Date.parse(row.at) <= rule.ms).length;
  return count >= rule.limit;
}

export function recordAttempt(accounts: AccountState, kind: ThrottleKind, bucket: string, now: string): AccountState {
  const nowMs = Date.parse(now);
  const key = `${kind}:${bucket}`;
  return { ...accounts, attempts: [...fresh(accounts.attempts, nowMs), { key, at: now }] };
}

export function clientIp(ip: string | null | undefined): string {
  const clean = (ip || "").trim().slice(0, 80);
  return clean || "unknown";
}
