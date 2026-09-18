"""Per-request DNS pinning without process-wide socket.getaddrinfo monkeypatch.

TCP connects to the IP validate_url() already checked. TLS SNI / Host / response.url
keep the real hostname because httpx still uses the original URL.
"""
from __future__ import annotations

import httpcore
import httpx


class PinnedBackend(httpcore.SyncBackend):
    def __init__(self, ip: str) -> None:
        super().__init__()
        self._ip = ip

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        return super().connect_tcp(self._ip, port, timeout=timeout, local_address=local_address, socket_options=socket_options)


class PinnedTransport(httpx.HTTPTransport):
    def __init__(self, ip: str, **kwargs):
        super().__init__(**kwargs)
        old = getattr(self, "_pool", None)
        self._pool = httpcore.ConnectionPool(network_backend=PinnedBackend(ip))
        if old is not None:
            try:
                old.close()
            except Exception:
                pass


def pinned_client(ip: str, *, timeout: float, headers: dict) -> httpx.Client:
    return httpx.Client(
        transport=PinnedTransport(ip),
        follow_redirects=False,
        timeout=timeout,
        headers=headers,
    )
