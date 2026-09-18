"""SSRF guards for outbound website research. Never fetch private/internal hosts."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_HOSTS = {"localhost", "localhost.localdomain", "metadata.google.internal"}


class SsrfError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
        or str(addr) == "169.254.169.254"
        or addr in ipaddress.ip_network("169.254.0.0/16")
        or addr in ipaddress.ip_network("0.0.0.0/8")
    )


def resolve_public(host: str) -> list[str]:
    host = (host or "").strip().lower().rstrip(".")
    if not host or host in BLOCKED_HOSTS:
        raise SsrfError("blocked", f"Host not allowed: {host or 'empty'}")
    if host.endswith(".localhost") or host.endswith(".internal") or host.endswith(".local"):
        raise SsrfError("blocked", f"Host not allowed: {host}")
    try:
        ipaddress.ip_address(host)
        if _is_private_ip(host):
            raise SsrfError("blocked", f"Private IP blocked: {host}")
        return [host]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise SsrfError("dns", f"DNS failed for {host}: {e}") from e
    ips = []
    for info in infos:
        ip = info[4][0]
        if _is_private_ip(ip):
            raise SsrfError("blocked", f"Host {host} resolved to private IP {ip}")
        ips.append(ip)
    if not ips:
        raise SsrfError("dns", f"No addresses for {host}")
    return ips


def validate_url(url: str, *, allow_relative_base: str | None = None) -> tuple[str, str]:
    """Return (clean_url, pinned_public_ip). Caller must connect to the IP, not re-resolve."""
    if not url or not str(url).strip():
        raise SsrfError("invalid", "Empty URL")
    raw = str(url).strip()
    if allow_relative_base and not raw.startswith(("http://", "https://")):
        raw = urljoin(allow_relative_base, raw)
    parsed = urlparse(raw)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise SsrfError("invalid", f"Scheme not allowed: {parsed.scheme or 'none'}")
    if parsed.username or parsed.password:
        raise SsrfError("blocked", "Userinfo in URL is not allowed")
    if not parsed.hostname:
        raise SsrfError("invalid", "URL missing hostname")
    ips = resolve_public(parsed.hostname)
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    netloc = parsed.hostname
    if parsed.port:
        netloc = f"{parsed.hostname}:{parsed.port}"
    return f"{parsed.scheme}://{netloc}{path}{query}", ips[0]
