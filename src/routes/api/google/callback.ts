import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        const origin = url.origin;
        if (err || !code || !state) {
          return Response.redirect(`${origin}/?google=denied`, 302);
        }
        try {
          const { takeOauthState, saveGoogleAccount, audit } = await import("@/lib/mail/sql.server");
          const rec = await takeOauthState(state);
          if (!rec) {
            return Response.redirect(`${origin}/?google=bad_state`, 302);
          }
          const { exchangeCode } = await import("@/lib/google/oauth");
          const tokens = await exchangeCode(code, request.url);
          await saveGoogleAccount(rec.userId, rec.kind, tokens);
          await audit(rec.userId, "google_connect", `Connected ${rec.kind}`, { method: "MANUAL" });
          return Response.redirect(`${origin}/?google=connected`, 302);
        } catch {
          return Response.redirect(`${origin}/?google=failed`, 302);
        }
      },
    },
  },
});
