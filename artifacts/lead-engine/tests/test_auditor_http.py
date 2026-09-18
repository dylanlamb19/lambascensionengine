import unittest
from unittest.mock import MagicMock, patch

from app.services.ssrf import SsrfError
from app.services.auditor import fetch_url


class FakeResp:
    def __init__(self, status, headers=None, content=b"", url="https://example.com/", chunk_size=64):
        self.status_code = status
        self.headers = headers or {}
        self.url = url
        self.encoding = "utf-8"
        self._content = content
        self._chunk_size = chunk_size
        self.closed = False
        self.chunks_yielded = 0

    def iter_bytes(self):
        for i in range(0, len(self._content), self._chunk_size):
            self.chunks_yielded += 1
            yield self._content[i:i + self._chunk_size]

    def close(self):
        self.closed = True


def _ok_url(u, allow_relative_base=None):
    if not str(u).startswith("http"):
        raise SsrfError("invalid", "bad")
    return (u, "93.184.216.34")


class FetchTests(unittest.TestCase):
    @patch("app.services.auditor.validate_url", side_effect=_ok_url)
    def test_https_ok(self, _v):
        html = b"<html><title>T</title></html>"
        with patch("app.services.auditor._client") as cli:
            inst = MagicMock()
            inst.build_request.return_value = object()
            inst.send.return_value = FakeResp(200, content=html, url="https://example.com/")
            inst.__enter__.return_value = inst
            inst.__exit__.return_value = False
            cli.return_value = inst
            r = fetch_url("https://example.com/")
        self.assertTrue(r["ok"])
        self.assertTrue(r["https"])
        self.assertEqual(r["status"], 200)
        self.assertTrue("example.com" in r["final_url"])

    @patch("app.services.auditor.validate_url")
    def test_redirect_to_private_blocked(self, v):
        def val(u, allow_relative_base=None):
            if "127.0.0.1" in str(u):
                raise SsrfError("blocked", "private")
            raw = u if str(u).startswith("http") else "https://example.com/" + str(u)
            return raw, "93.184.216.34"
        v.side_effect = val
        with patch("app.services.auditor._client") as cli:
            inst = MagicMock()
            inst.build_request.return_value = object()
            inst.send.return_value = FakeResp(302, headers={"location": "http://127.0.0.1/"}, url="https://example.com/")
            inst.__enter__.return_value = inst
            inst.__exit__.return_value = False
            cli.return_value = inst
            r = fetch_url("https://example.com/")
        self.assertFalse(r["ok"])
        self.assertIn("redirect_blocked", r["error"])

    @patch("app.services.auditor.validate_url", side_effect=_ok_url)
    def test_timeout(self, _v):
        import httpx
        with patch("app.services.auditor._client") as cli:
            inst = MagicMock()
            inst.build_request.return_value = object()
            inst.send.side_effect = httpx.TimeoutException("t")
            inst.__enter__.return_value = inst
            inst.__exit__.return_value = False
            cli.return_value = inst
            r = fetch_url("https://example.com/")
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "timeout")

    @patch("app.services.auditor.validate_url", side_effect=_ok_url)
    def test_stream_stops_when_too_large(self, _v):
        from app.config import settings
        huge = b"x" * (settings.max_audit_bytes + 5000)
        fake = FakeResp(200, content=huge, url="https://example.com/", chunk_size=1024)
        with patch("app.services.auditor._client") as cli:
            inst = MagicMock()
            inst.build_request.return_value = object()
            inst.send.return_value = fake
            inst.__enter__.return_value = inst
            inst.__exit__.return_value = False
            cli.return_value = inst
            r = fetch_url("https://example.com/")
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "too_large")
        self.assertTrue(fake.closed)
        self.assertLess(len(fake._content[:0]) + fake.chunks_yielded * 1024, settings.max_audit_bytes + 1024 * 4)

    @patch("app.services.auditor.validate_url", side_effect=_ok_url)
    def test_response_is_closed(self, _v):
        fake = FakeResp(200, content=b"<html></html>", url="https://example.com/")
        with patch("app.services.auditor._client") as cli:
            inst = MagicMock()
            inst.build_request.return_value = object()
            inst.send.return_value = fake
            inst.__enter__.return_value = inst
            inst.__exit__.return_value = False
            cli.return_value = inst
            fetch_url("https://example.com/")
        self.assertTrue(fake.closed)


if __name__ == "__main__":
    unittest.main()
