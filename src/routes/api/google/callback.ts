import { createFileRoute } from "@tanstack/react-router";

function oauthReturnPage(status: "connected" | "denied" | "failed" | "bad_state", kind: "gmail" | "calendar" | "") {
  const copy =
    status === "connected"
      ? kind === "calendar"
        ? "Google Calendar connected. You can close this window."
        : kind === "gmail"
          ? "Gmail connected. You can close this window."
          : "Google connected. You can close this window."
      : "Google sign-in didn’t finish. Nothing was connected. You can close this window.";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Google</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;background:#0b1020;color:#f4f6fb">
<p>${copy}</p>
<script>
(function () {
  var status = ${JSON.stringify(status)};
  var kind = ${JSON.stringify(kind)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ source: "lascengine-google", status: status, kind: kind }, window.location.origin);
    }
  } catch (e) {}
  try { window.close(); } catch (e) {}
  setTimeout(function () {
    var q = "/?google=" + status;
    if (kind) q += "&kind=" + encodeURIComponent(kind);
    location.replace(q);
  }, 500);
})();
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        if (err || !code || !state) {
          return oauthReturnPage("denied", "");
        }
        try {
          const { takeOauthState, saveGoogleAccount, audit } = await import("@/lib/mail/sql.server");
          const rec = await takeOauthState(state);
          if (!rec) {
            return oauthReturnPage("bad_state", "");
          }
          const { exchangeCode } = await import("@/lib/google/oauth");
          const tokens = await exchangeCode(code, request.url);
          await saveGoogleAccount(rec.userId, rec.kind, tokens);
          await audit(rec.userId, "google_connect", `Connected ${rec.kind}`, { method: "MANUAL" });
          return oauthReturnPage("connected", rec.kind);
        } catch {
          return oauthReturnPage("failed", "");
        }
      },
    },
  },
});
