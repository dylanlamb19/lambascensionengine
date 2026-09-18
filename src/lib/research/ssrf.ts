import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function privateIPv4(ip: string): boolean {
  const v = ip.split(".").map(Number);
  if (v.length !== 4 || v.some((n) => Number.isNaN(n))) return false;
  const [a, b] = v;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * True for an IPv6 address that is loopback/link-local/unique-local/
 * unspecified, OR that is an IPv4-mapped / IPv4-compatible / NAT64 address
 * whose EMBEDDED IPv4 address is private. That embedded-address check is the
 * important edge case: `::ffff:169.254.169.254` and `64:ff9b::a9fe:a9fe`
 * both LOOK like ordinary public-ish IPv6 literals if you only pattern-match
 * the IPv6 text, but a socket connecting to either one lands on the same
 * cloud-metadata host as the plain IPv4 address — a well-known SSRF
 * allowlist bypass. We normalize with `net.isIPv6` + a manual parse rather
 * than trusting a regex over the string form.
 */
function privateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local fe80::/10
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return privateIPv4(mapped[1]);
  const compatV4 = lower.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (compatV4 && compatV4[1] !== "0.0.0.0") return privateIPv4(compatV4[1]);

  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address in the last
  // 32 bits (2 hextets). Reject the whole /96 outright — even a "public"
  // embedded IPv4 here is a translated address we have no business treating
  // as validated once it crosses the interception check below — but in
  // particular catch a private/metadata address embedded in it.
  if (lower.startsWith("64:ff9b::")) {
    const last = lower.split(":").slice(-2);
    if (last.length === 2 && last.every((h) => /^[0-9a-f]{0,4}$/.test(h))) {
      const b = last.map((h) => parseInt(h || "0", 16));
      const embedded = [(b[0] >> 8) & 0xff, b[0] & 0xff, (b[1] >> 8) & 0xff, b[1] & 0xff].join(".");
      return privateIPv4(embedded) || true; // whole prefix is not a normal public route
    }
    return true;
  }
  return false;
}

function privateIp(ip: string): boolean {
  if (ip === "169.254.169.254") return true;
  if (net.isIPv4(ip)) return privateIPv4(ip);
  if (net.isIPv6(ip)) return privateIPv6(ip);
  return true; // not a recognizable IP literal — refuse rather than guess
}

export type ValidatedUrl = { url: string; ip: string };

/**
 * Validate a URL is safe to fetch AND resolve it, returning both the clean
 * URL (original hostname — used for Host/SNI/application-level evidence) and
 * the single public IP the caller should pin the actual TCP connection to.
 *
 * Resolving here is not enough by itself: if the caller then hands the
 * *hostname* back to `fetch()`, fetch does its own DNS lookup at connect
 * time, and a host with a short-TTL DNS record can legitimately resolve to a
 * public IP here and a private one a moment later (DNS rebinding). Returning
 * the IP lets the caller pin the connection (see fetch-page.ts) instead of
 * trusting a second, unsynchronized resolution.
 */
export async function assertPublicHttpUrl(raw: string, base?: string): Promise<ValidatedUrl> {
  let u: URL;
  try {
    u = base && !/^https?:/i.test(raw) ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new Error("invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme_blocked");
  if (u.username || u.password) throw new Error("userinfo_blocked");
  const host = u.hostname.toLowerCase();
  if (!host || BLOCKED.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("host_blocked");
  }
  if (net.isIP(host)) {
    if (privateIp(host)) throw new Error("private_ip");
    u.hash = "";
    return { url: u.toString(), ip: host };
  }
  const resolved = await lookup(host, { all: true });
  if (!resolved.length) throw new Error("dns_failed");
  const pick = resolved.find((r) => !privateIp(r.address));
  if (!pick) throw new Error("private_ip");
  u.hash = "";
  return { url: u.toString(), ip: pick.address };
}

/** Exported for tests / other callers that only need the classifier. */
export { privateIp };
