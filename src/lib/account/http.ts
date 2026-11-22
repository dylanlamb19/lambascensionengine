import { readCookie, SESSION_COOKIE_NAME } from "./crypto.ts";
import { dispatchAccountRoute, type AccountReply } from "./routes.ts";
import type { LayerFlags } from "../subscription/dispatch.ts";
import type { AccountBundle } from "./types.ts";

export async function handleAccountHttp(
  request: Request,
  enabled: boolean,
  bundle: AccountBundle,
  flags: LayerFlags = { billing: false, team: false, lifecycle: false },
): Promise<{ response: Response; bundle: AccountBundle }> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return {
      bundle,
      response: Response.json({ ok: false, reason: "That request is not available." }, { status: 405 }),
    };
  }
  let body: Record<string, unknown> | null = null;
  if (method === "POST") {
    const text = await request.text();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { bundle, response: Response.json({ ok: false, reason: "That request could not be read." }, { status: 400 }) };
        }
        body = { ...(parsed as Record<string, unknown>), raw: text };
      } catch {
        return { bundle, response: Response.json({ ok: false, reason: "That request could not be read." }, { status: 400 }) };
      }
    }
  }
  const reply: AccountReply = dispatchAccountRoute(bundle, {
    method,
    path: `${url.pathname}${url.search}`,
    now: new Date().toISOString(),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    enabled,
    sessionId: readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME),
    csrfToken: request.headers.get("x-csrf-token") || (typeof body?.csrfToken === "string" ? body.csrfToken : null),
    signature: request.headers.get("x-scaffold-signature"),
    flags,
    body,
  });
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (reply.headers["Set-Cookie"]) headers.set("Set-Cookie", reply.headers["Set-Cookie"]);
  return {
    bundle: reply.bundle,
    response: new Response(JSON.stringify(reply.body), { status: reply.status, headers }),
  };
}
