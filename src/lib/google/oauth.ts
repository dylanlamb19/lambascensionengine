import { env } from "../env.server.ts";
import type { OauthKind } from "../mail/oauth-state.ts";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export function googleOAuthConfigured(): boolean {
  return Boolean(env("GOOGLE_OAUTH_CLIENT_ID") && env("GOOGLE_OAUTH_CLIENT_SECRET"));
}

export function redirectUri(requestUrl: string): string {
  const explicit = env("GOOGLE_OAUTH_REDIRECT_URI");
  if (explicit) return explicit;
  const u = new URL(requestUrl);
  return `${u.origin}/api/google/callback`;
}

export function scopesFor(kind: OauthKind): string[] {
  return kind === "calendar" ? [...CALENDAR_SCOPES] : [...GMAIL_SCOPES];
}

export function authorizeUrl(opts: { state: string; kind: OauthKind; requestUrl: string }): string {
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID") || "";
  const unique = [...new Set(scopesFor(opts.kind))];
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(opts.requestUrl),
    response_type: "code",
    scope: unique.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  expiry: number;
  email?: string;
  sub?: string;
};

export async function exchangeCode(code: string, requestUrl: string, fetchImpl: typeof fetch = fetch): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: env("GOOGLE_OAUTH_CLIENT_ID") || "",
    client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET") || "",
    redirect_uri: redirectUri(requestUrl),
    grant_type: "authorization_code",
  });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    throw new Error("Google did not finish sign-in. Nothing was connected.");
  }
  const tokens: GoogleTokens = {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expires_in: Number(json.expires_in || 3600),
    token_type: json.token_type ? String(json.token_type) : "Bearer",
    scope: json.scope ? String(json.scope) : "",
    expiry: Date.now() + Number(json.expires_in || 3600) * 1000,
  };
  try {
    const infoRes = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = (await infoRes.json()) as { email?: string; sub?: string };
    tokens.email = info.email;
    tokens.sub = info.sub;
  } catch {
    /* email optional */
  }
  return tokens;
}

export async function refreshAccess(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env("GOOGLE_OAUTH_CLIENT_ID") || "",
    client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET") || "",
    grant_type: "refresh_token",
  });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    throw new Error("Gmail needs to be reconnected.");
  }
  return {
    access_token: String(json.access_token),
    refresh_token: refreshToken,
    expiry: Date.now() + Number(json.expires_in || 3600) * 1000,
    scope: json.scope ? String(json.scope) : "",
  };
}

export async function ensureFreshAccess(
  tokens: GoogleTokens,
  refreshFn: (rt: string) => Promise<GoogleTokens> = (rt) => refreshAccess(rt),
  now = Date.now(),
): Promise<{ ok: true; tokens: GoogleTokens; refreshed: boolean } | { ok: false; error: string }> {
  if (!tokens.expiry || tokens.expiry >= now + 30_000) return { ok: true, tokens, refreshed: false };
  if (!tokens.refresh_token) return { ok: false, error: "Calendar needs to be reconnected." };
  try {
    const next = await refreshFn(tokens.refresh_token);
    next.refresh_token = tokens.refresh_token;
    next.email = tokens.email;
    next.sub = tokens.sub;
    return { ok: true, tokens: next, refreshed: true };
  } catch {
    return { ok: false, error: "Calendar needs to be reconnected." };
  }
}
