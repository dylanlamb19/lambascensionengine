import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, privateIp } from "./ssrf.ts";

test("blocks userinfo, file, and loopback", async () => {
  await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"), /scheme/);
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/"), /private|host/);
  await assert.rejects(() => assertPublicHttpUrl("https://user:pass@example.com/"), /userinfo/);
});

test("validating a literal public IP returns {url, ip} with hostname preserved and ip pinned", async () => {
  // 93.184.216.34 was example.com's long-standing public IP; used here only
  // as a stand-in public literal so this test needs no real DNS/network.
  const result = await assertPublicHttpUrl("https://93.184.216.34/path");
  assert.equal(result.ip, "93.184.216.34");
  assert.equal(result.url, "https://93.184.216.34/path");
});

test("IPv4 private/loopback/link-local/metadata ranges are blocked", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "169.254.1.1", "100.64.0.1", "0.0.0.0"]) {
    assert.equal(privateIp(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1"]) {
    assert.equal(privateIp(ip), false, `${ip} should NOT be blocked`);
  }
});

test("IPv6 loopback/link-local/unique-local/unspecified are blocked", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456:789a::1"]) {
    assert.equal(privateIp(ip), true, `${ip} should be blocked`);
  }
});

test("IPv6 addresses that just EMBED a private/metadata IPv4 are blocked, not just bare fe80/fc/fd forms", () => {
  // Classic SSRF-allowlist-bypass shapes: these don't start with fe80/fc/fd
  // and aren't ::1, so a naive string-prefix check would wave them through,
  // but they route to the same host as the plain IPv4 address.
  assert.equal(privateIp("::ffff:127.0.0.1"), true, "IPv4-mapped loopback");
  assert.equal(privateIp("::ffff:169.254.169.254"), true, "IPv4-mapped metadata address");
  assert.equal(privateIp("::ffff:10.0.0.5"), true, "IPv4-mapped private range");
  assert.equal(privateIp("::127.0.0.1"), true, "IPv4-compatible loopback");
  assert.equal(privateIp("64:ff9b::a9fe:a9fe"), true, "NAT64-embedded metadata address (169.254.169.254)");
});

test("IPv6 address that maps to a genuinely public IPv4 is not blocked", () => {
  assert.equal(privateIp("::ffff:93.184.216.34"), false);
});

test("non-IP-literal garbage passed to the classifier fails closed (blocked), not open", () => {
  assert.equal(privateIp("not-an-ip"), true);
});
