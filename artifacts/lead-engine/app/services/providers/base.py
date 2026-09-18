"""Provider adapters. Phase 2 implements Places. Never invent results."""

from typing import Protocol

class DiscoveryProvider(Protocol):
    name: str
    def search(self, vertical: str, location: str, limit: int) -> list[dict]:
        ...

class NullDiscovery:
    name = "none"
    def search(self, vertical, location, limit):
        return []
