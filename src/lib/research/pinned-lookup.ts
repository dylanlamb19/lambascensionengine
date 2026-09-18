/**
 * The pure DNS-pinning logic behind fetch-page.ts's per-request undici
 * Agent, split out into its own dependency-free module so it can be unit
 * tested without the `undici` package installed (undici's `Agent` class is
 * only needed to actually USE this — see fetch-page.ts).
 *
 * `dns.lookup`-compatible callback shape: undici's connector calls this the
 * same way Node's own `dns.lookup` would be called, with either the 2-arg
 * `(err, address)` form or, when `options.all` is set, the 3rd-arg-array
 * form `(err, [{address, family}, ...])`.
 */
export type LookupCallback =
  | ((err: Error | null, address: string, family: number) => void)
  | ((err: Error | null, addresses: { address: string; family: number }[]) => void);

export type LookupOptions = { all?: boolean } | undefined;

export type LookupFn = (host: string, options: LookupOptions, callback: LookupCallback) => void;

/**
 * Build a `lookup()` function that resolves ONLY `hostname` (to `ip`) and
 * refuses everything else. Used as the `connect.lookup` for a per-request
 * Agent scoped to one validated URL — never installed globally, so it can't
 * affect DNS resolution for any other request in the process.
 */
export function createPinnedLookup(hostname: string, ip: string): LookupFn {
  const family = ip.includes(":") ? 6 : 4;
  return (host, options, callback) => {
    if (host !== hostname) {
      // Fail safe: a pinned lookup asked to resolve a DIFFERENT host than
      // the one it was built for should never fall through to a real DNS
      // lookup (that would silently un-pin the connection) — refuse.
      (callback as (err: Error | null, addresses: { address: string; family: number }[]) => void)(
        new Error(`pinned_lookup_host_mismatch:${host}`),
        [],
      );
      return;
    }
    if (options?.all) {
      (callback as (err: Error | null, addresses: { address: string; family: number }[]) => void)(null, [{ address: ip, family }]);
    } else {
      (callback as (err: Error | null, address: string, family: number) => void)(null, ip, family);
    }
  };
}
