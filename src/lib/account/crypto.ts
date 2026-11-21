import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-lae.session";

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32, SCRYPT).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const next = scryptSync(password, salt, 32, SCRYPT);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newId(): string {
  return randomBytes(16).toString("hex");
}

/** `__Host-` cookie: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. */
export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function cookieHasSecureFlags(header: string): boolean {
  const lower = header.toLowerCase();
  return (
    header.startsWith(`${SESSION_COOKIE_NAME}=`) &&
    lower.includes("httponly") &&
    lower.includes("secure") &&
    lower.includes("samesite=lax") &&
    lower.includes("path=/") &&
    !/\bdomain\s*=/.test(lower)
  );
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    return "Use 10 to 200 characters.";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Use a letter and a number.";
  return null;
}

let dummyHash: string | null = null;

/** Compare cost when the email is unknown, so the missing-user path still hashes. */
export function dummyPasswordHash(): string {
  dummyHash ??= hashPassword("not-a-real-password-9");
  return dummyHash;
}
