export type OauthMissing = { name: string; ready: boolean };

export type GoogleConnectResult = {
  ok: boolean;
  reason: string;
  missing: OauthMissing[];
  next: string;
  launched: boolean;
  url?: string;
};

const POPUP_NAME = "lascengine-google";

function openOauthWindow(): Window | null {
  try {
    // Open synchronously in the click turn so the browser counts it as a user gesture.
    // Do not pass noopener — Chrome then returns null and we cannot set the URL after the server round-trip.
    return window.open("about:blank", POPUP_NAME, "width=520,height=720");
  } catch {
    return null;
  }
}

export async function startGoogleOAuth(kind: "gmail" | "calendar", opts?: { allowPopup?: boolean; force?: boolean }): Promise<GoogleConnectResult> {
  const wantPopup = opts?.allowPopup !== false;
  const popup = wantPopup ? openOauthWindow() : null;
  const { googleStartFn } = await import("@/lib/mail/actions");
  let res: Awaited<ReturnType<typeof googleStartFn>>;
  try {
    res = await googleStartFn({ data: { kind, origin: window.location.origin, force: opts?.force } });
  } catch {
    try { popup?.close(); } catch { /* ignore */ }
    return {
      ok: false,
      reason: kind === "calendar"
        ? "Could not start Google Calendar sign-in. The existing Calendar connection was not changed."
        : "Could not start Google sign-in. Nothing was connected.",
      missing: [],
      next: kind === "calendar"
        ? "The stored Calendar connection was left as-is."
        : "Try Connect Gmail again. We will not ask for your Gmail password.",
      launched: false,
    };
  }
  if ("alreadyConnected" in res && res.alreadyConnected) {
    try { popup?.close(); } catch { /* ignore */ }
    return {
      ok: true,
      reason: res.reason || "Google Calendar is already connected. The existing connection was not changed.",
      missing: res.missing || [],
      next: res.next || "Use Reconnect only if Calendar actually needs a new Google sign-in.",
      launched: false,
    };
  }
  if (!res.ok) {
    try { popup?.close(); } catch { /* ignore */ }
    return {
      ok: false,
      reason: res.reason,
      missing: res.missing || [],
      next: res.next || "Add the missing Google OAuth values on the server, then press Connect Gmail again. We will not ask for your Gmail password.",
      launched: false,
    };
  }
  if (!res.url) {
    try { popup?.close(); } catch { /* ignore */ }
    return {
      ok: false,
      reason: kind === "calendar"
        ? "Could not start Google Calendar sign-in. The existing Calendar connection was not changed."
        : "Could not start Google sign-in. Nothing was connected.",
      missing: res.missing || [],
      next: kind === "calendar" ? "The stored Calendar connection was left as-is." : "Try Connect Gmail again.",
      launched: false,
    };
  }
  if (popup && !popup.closed) {
    try {
      popup.location.replace(res.url);
      popup.focus();
      return {
        ok: true,
        reason: kind === "gmail"
          ? "Opening Google so you can authorize Gmail. We will not ask for your Gmail password."
          : "Opening Google so you can authorize Calendar.",
        missing: [],
        next: "Finish sign-in in the Google window. This page will update when it comes back.",
        launched: true,
        url: res.url,
      };
    } catch {
      /* fall through to a visible link */
    }
  }
  try { popup?.close(); } catch { /* ignore */ }
  return {
    ok: false,
    reason: "Google sign-in couldn’t open a window. Allow pop-ups for this page, or use Continue with Google below.",
    missing: [],
    next: "If pop-ups are blocked, allow them and try once more. We will not ask for your Gmail password.",
    launched: false,
    url: res.url,
  };
}

export function isGoogleOauthMessage(data: unknown): data is { source: "lascengine-google"; status: string } {
  if (!data || typeof data !== "object") return false;
  const rec = data as { source?: unknown; status?: unknown };
  return rec.source === "lascengine-google" && typeof rec.status === "string";
}
