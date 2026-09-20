import { Agent } from "undici";
import { assertPublicHttpUrl } from "./ssrf.ts";
import { createPinnedLookup } from "./pinned-lookup.ts";

const UA = "LambAscensionResearchBot/0.4 (+https://lambascension.com/bot)";
const MAX_BYTES = 1_200_000;
const MAX_REDIRECTS = 5;

export type PageFetch = {
  ok: boolean;
  blocked: boolean;
  status: number;
  final_url: string;
  html: string;
  error: string;
};

/**
 * Build a per-request undici Agent whose connector resolves `hostname`
 * (and ONLY `hostname`) to `ip`, instead of letting undici's normal
 * connector re-resolve DNS itself when it opens the socket.
 *
 * This is the TCP-pinning mechanism for the TypeScript fetch path. It is
 * deliberately scoped to one Agent instance used for one hop of one
 * request — never a global/process-wide override of `dns.lookup` — so it
 * cannot affect any other concurrent request in the process. The Host
 * header and TLS SNI/cert hostname verification are untouched (undici still
 * connects using `hostname` for those purposes; only the low-level
 * `lookup()` callback used to pick a socket address is replaced), so
 * `response.url` and everything derived from it keeps showing the real
 * hostname, never the pinned IP.
 */
function pinnedDispatcher(hostname: string, ip: string): Agent {
  return new Agent({ connect: { lookup: createPinnedLookup(hostname, ip) } });
}

async function readCapped(res: Response): Promise<{ html: string; tooLarge: boolean }> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return { html: "", tooLarge: true };
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(buf), tooLarge: false };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { html: "", tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { html: new TextDecoder("utf-8", { fatal: false }).decode(out), tooLarge: false };
}

export async function fetchPublicPage(url: string, timeoutMs = 12000): Promise<PageFetch> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const validated = await assertPublicHttpUrl(current);
      current = validated.url;
      const hostname = new URL(current).hostname;
      const dispatcher = pinnedDispatcher(hostname, validated.ip);
      const ctrl = new AbortController();
      // Armed for the WHOLE hop — headers AND body. A server that returns
      // headers quickly and then drip-feeds the body must not get an
      // unbounded read: this same signal governs the readCapped() call
      // below, so aborting also cancels an in-progress body read. The
      // previous version cleared this right after the headers came back,
      // leaving body reads with no timeout at all.
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          // @ts-expect-error -- `dispatcher` is undici's fetch extension;
          // not in the standard lib.fetch types.
          dispatcher,
          headers: { "User-Agent": UA, Accept: "text/html" },
        });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location");
          if (!loc) return { ok: false, blocked: false, status: res.status, final_url: current, html: "", error: "redirect_missing_location" };
          try {
            const nextValidated = await assertPublicHttpUrl(loc, current);
            current = nextValidated.url;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "blocked";
            return { ok: false, blocked: true, status: res.status, final_url: current, html: "", error: `redirect_blocked:${msg}` };
          }
          continue;
        }
        const { html, tooLarge } = await readCapped(res);
        if (tooLarge) return { ok: false, blocked: false, status: res.status, final_url: res.url || current, html: "", error: "too_large" };
        const blocked = res.status === 401 || res.status === 403 || res.status === 429 || /captcha/i.test(html.slice(0, 2000));
        return {
          ok: res.ok && !blocked,
          blocked,
          status: res.status,
          final_url: res.url || current,
          html: res.ok ? html : "",
          error: blocked ? "blocked" : res.ok ? "" : `HTTP ${res.status}`,
        };
      } finally {
        clearTimeout(t);
        void dispatcher.close().catch(() => {});
      }
    }
    return { ok: false, blocked: false, status: 0, final_url: current, html: "", error: "too_many_redirects" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    const timedOut = e instanceof Error && e.name === "AbortError";
    return { ok: false, blocked: /blocked|private/i.test(msg), status: 0, final_url: url, html: "", error: timedOut ? "timeout" : msg };
  }
}

export function innerPaths(base: string): string[] {
  try {
    const u = new URL(base);
    return ["/contact", "/contact-us", "/about", "/team", "/about-us", "/our-team", "/case-studies", "/customers", "/careers", "/leadership"].map((p) => new URL(p, u.origin).toString());
  } catch {
    return [];
  }
}
