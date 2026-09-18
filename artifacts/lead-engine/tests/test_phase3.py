import unittest
from unittest.mock import patch

from app.services.html_signals import analyze_html
from app.services.ssrf import SsrfError, validate_url
from app.services.scoring import score_company
from app.services.flags import build_flags
from app.services.qualify import initial_score


PIXEL_HTML = """
<html><head><title>Roof Co</title><meta name="description" content="roofs"><meta name="viewport" content="width=device-width">
<script>!function(f,b,e,v,n,t,s){fbq('init','123');}(window,document,'script');</script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC"></script>
</head><body><h1>Hello</h1><a href="tel:+18175551212">Call</a>
<form><input name="name"><textarea></textarea></form>
<a href="/services/roofing">Services</a>
</body></html>
"""

BARE_HTML = "<html><head></head><body>Hi</body></html>"


class SsrfTests(unittest.TestCase):
    def test_invalid_scheme(self):
        with self.assertRaises(SsrfError) as e:
            validate_url("file:///etc/passwd")
        self.assertEqual(e.exception.code, "invalid")

    def test_localhost(self):
        with self.assertRaises(SsrfError):
            validate_url("http://localhost/admin")

    def test_loopback_ip(self):
        with self.assertRaises(SsrfError):
            validate_url("http://127.0.0.1/")

    def test_private_ip(self):
        with self.assertRaises(SsrfError):
            validate_url("http://192.168.1.9/")

    def test_metadata(self):
        with self.assertRaises(SsrfError):
            validate_url("http://169.254.169.254/latest/meta-data")

    def test_public_https_ok(self):
        url, ip = validate_url("https://example.com/path")
        self.assertTrue(url.startswith("https://example.com"))
        self.assertTrue(ip)


class SignalTests(unittest.TestCase):
    def test_pixel_and_gtm(self):
        s = analyze_html(PIXEL_HTML, "https://example.com/")
        self.assertTrue(s["pixel"])
        self.assertTrue(s["gtm"])
        self.assertTrue(s["tel_links"])
        self.assertTrue(s["form_detected"])
        self.assertTrue(s["title"])

    def test_missing_https_signals_on_bare(self):
        s = analyze_html(BARE_HTML, "https://example.com/")
        self.assertFalse(s["pixel"])
        self.assertFalse(s["gtm"])
        self.assertFalse(s["form_detected"])
        self.assertFalse(s["tel_links"])


class QualifyTests(unittest.TestCase):
    def test_initial_score(self):
        s, reason = initial_score({
            "website": "https://x.com", "google_rating": "4.8", "review_count": 90,
            "job_value_est": 15000, "phone": "817", "city": "Dallas",
        }, 4, 20)
        self.assertGreaterEqual(s, 50)
        self.assertIn("website", reason)


class Dummy:
    def __init__(self):
        self.job_value_est = 15000
        self.review_count = 200
        self.contacts = []
        self.phone = "817"
        self.years_in_business = 12
        self.source = "google_places"
        self.google_ads_status = "unknown"
        self.meta_ads_status = "unknown"


class DummyAudit:
    def __init__(self, findings):
        self.facts = {"findings": findings}
        self.status = "complete"
        self.flags = []


class ScoreTests(unittest.TestCase):
    def test_no_audit_funnel_capped(self):
        r = score_company(Dummy(), None)
        self.assertLess(r["breakdown"]["funnel"], 15)
        self.assertIn("audit not run", " ".join(r["why"]))

    def test_weak_funnel_raises_opportunity(self):
        findings = [
            {"id": "contact_form", "result": "No form detected on homepage", "status": "VERIFIED"},
            {"id": "click_to_call", "result": "No tel: link on homepage", "status": "VERIFIED"},
            {"id": "booking", "result": "No known booking provider identified", "status": "UNKNOWN"},
            {"id": "meta_pixel", "result": "No Meta Pixel detected on checked page", "status": "VERIFIED"},
            {"id": "gtm", "result": "No Google Tag Manager detected on checked page", "status": "VERIFIED"},
            {"id": "gtag", "result": "No Google tag/gtag detected on checked page", "status": "VERIFIED"},
        ]
        r = score_company(Dummy(), DummyAudit(findings))
        self.assertGreaterEqual(r["breakdown"]["funnel"], 8)
        self.assertLessEqual(r["total"], 100)


class FlagTests(unittest.TestCase):
    def test_flags_link_evidence(self):
        findings = [
            {"id": "click_to_call", "result": "No tel: link on homepage", "status": "VERIFIED"},
            {"id": "contact_form", "result": "No form detected on homepage", "status": "VERIFIED"},
            {"id": "booking", "result": "No known booking provider identified", "status": "UNKNOWN"},
            {"id": "gtm", "result": "No Google Tag Manager detected on checked page", "status": "VERIFIED"},
            {"id": "gtag", "result": "No Google tag/gtag detected on checked page", "status": "VERIFIED"},
            {"id": "meta_pixel", "result": "No Meta Pixel detected on checked page", "status": "VERIFIED"},
            {"id": "pagespeed_mobile", "result": "32 mobile performance", "status": "VERIFIED"},
        ]
        flags = build_flags(findings, 120)
        codes = {f["code"] for f in flags}
        self.assertIn("NO_CLICK_TO_CALL", codes)
        self.assertIn("NO_FORM_DETECTED", codes)
        self.assertIn("HIGH_REVIEW_VOLUME_WEAK_FUNNEL", codes)
        self.assertIn("STRONG_DEMAND_SIGNAL", codes)
        self.assertIn("SLOW_MOBILE_SITE", codes)


class DuplicateLogic(unittest.TestCase):
    def test_domain_normalize(self):
        from app.main import domain_of
        self.assertEqual(domain_of("https://www.Example.COM/x"), "example.com")
        self.assertEqual(domain_of("example.com"), "example.com")


if __name__ == "__main__":
    unittest.main()
