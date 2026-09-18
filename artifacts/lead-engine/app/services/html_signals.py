"""Deterministic HTML/script signal detection. No AI. No inferred advertising status."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

PHONE_RE = re.compile(r"(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}")
CTA_RE = re.compile(
    r"(request (a )?free estimate|get (a )?(free )?quote|schedule|book (now|online)|call now|free inspection|contact us)",
    re.I,
)
FINANCE_RE = re.compile(r"\b(financ(?:e|ing)|0%\s*interest|payment plan|synchrony|greensky|affirm)\b", re.I)
TESTIMONIAL_RE = re.compile(r"\b(testimonial|reviews?|google reviews|rated \d|stars?)\b", re.I)
SERVICE_PATH = re.compile(r"/(services?|roof|hvac|plumb|foundation|solar|implant|attorney)(/|$|\?)", re.I)
LOCATION_PATH = re.compile(r"/(locations?|service-area|areas-we-serve|cities)(/|$|\?)", re.I)
CHAT_HINTS = (
    "intercom", "drift", "tidio", "crisp.chat", "tawk.to", "livechatinc",
    "hubspot.conversations", "js.hs-scripts.com", "zendesk", "facebook.com/v",
)
BOOKING_HINTS = (
    "calendly.com", "acuityscheduling", "setmore.com", "jobber.com",
    "housecallpro", "servicetitan", "squareup.com/appointments", "simplybook",
)
PIXEL_RE = re.compile(r"fbq\s*\(|connect\.facebook\.net/en_US/fbevents\.js|facebook\.com/tr\?|fn\.pixel", re.I)
GTM_RE = re.compile(r"googletagmanager\.com/gtm\.js|GTM-[A-Z0-9]+", re.I)
GTAG_RE = re.compile(r"googletagmanager\.com/gtag/js|gtag\s*\(\s*['\"]config['\"]|google-analytics\.com/analytics\.js|www\.google-analytics\.com/ga\.js", re.I)
ADS_CONV_RE = re.compile(r"gtag\s*\(\s*['\"]event['\"]\s*,\s*['\"]conversion['\"]|googleadservices\.com/pagead/conversion|AW-\d+", re.I)


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.in_title = False
        self.in_h1 = False
        self.h1: list[str] = []
        self.meta_desc = ""
        self.viewport = ""
        self.links: list[tuple[str, str]] = []
        self.scripts: list[str] = []
        self.script_src: list[str] = []
        self.forms = 0
        self.tel: list[str] = []
        self.has_form_input = False
        self.text_chunks: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self.in_title = True
        elif tag == "h1":
            self.in_h1 = True
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or "").lower()
            if name in ("description", "og:description"):
                self.meta_desc = a.get("content") or self.meta_desc
            if name == "viewport":
                self.viewport = a.get("content") or "present"
        elif tag == "a":
            href = a.get("href") or ""
            self.links.append((href, a.get("rel") or ""))
            if href.lower().startswith("tel:"):
                self.tel.append(href)
        elif tag == "form":
            self.forms += 1
        elif tag in ("input", "textarea", "select"):
            self.has_form_input = True
        elif tag == "script":
            src = a.get("src") or ""
            if src:
                self.script_src.append(src)
            self._skip = True

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "h1":
            self.in_h1 = False
        elif tag == "script":
            self._skip = False

    def handle_data(self, data):
        if self._skip:
            self.scripts.append(data)
            return
        if self.in_title:
            self.title_parts.append(data)
        if self.in_h1:
            self.h1.append(data)
        t = data.strip()
        if t:
            self.text_chunks.append(t)


def parse_html(html: str) -> PageParser:
    p = PageParser()
    try:
        p.feed(html or "")
    except Exception:
        pass
    return p


def finding(fid, result, status, source, confidence, evidence=""):
    from datetime import datetime, timezone
    return {
        "id": fid,
        "result": result,
        "status": status,
        "source": source,
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "confidence": confidence,
        "evidence": (evidence or "")[:500],
    }


def analyze_html(html: str, page_url: str) -> dict:
    p = parse_html(html)
    blob = html or ""
    text = " ".join(p.text_chunks)
    title = " ".join(p.title_parts).strip()
    h1 = " ".join(p.h1).strip()
    scripts_all = " ".join(p.script_src + p.scripts)

    tel = p.tel
    pixel = bool(PIXEL_RE.search(blob) or PIXEL_RE.search(scripts_all))
    gtm = bool(GTM_RE.search(blob) or GTM_RE.search(scripts_all))
    gtag = bool(GTAG_RE.search(blob) or GTAG_RE.search(scripts_all))
    ads_conv = bool(ADS_CONV_RE.search(blob))
    chat = next((h for h in CHAT_HINTS if h in blob.lower()), None)
    booking = next((h for h in BOOKING_HINTS if h in blob.lower()), None)
    form = p.forms > 0 or p.has_form_input
    cta = CTA_RE.search(text[:4000] or blob[:8000])
    finance = FINANCE_RE.search(text)
    testi = TESTIMONIAL_RE.search(text)
    phones = PHONE_RE.findall(text[:8000])

    same = []
    host = urlparse(page_url).netloc.replace("www.", "")
    for href, _rel in p.links:
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absu = urljoin(page_url, href)
        if urlparse(absu).netloc.replace("www.", "") == host:
            same.append(absu.split("#")[0])

    return {
        "title": title,
        "meta_description": p.meta_desc,
        "h1": h1,
        "viewport": bool(p.viewport),
        "tel_links": tel,
        "phone_text": phones[:5],
        "forms": p.forms,
        "has_form_input": p.has_form_input,
        "form_detected": form,
        "cta_text": cta.group(0) if cta else "",
        "financing": bool(finance),
        "testimonials": bool(testi),
        "chat": chat or "",
        "booking": booking or "",
        "pixel": pixel,
        "gtm": gtm,
        "gtag": gtag,
        "ads_conversion_signal": ads_conv,
        "internal_links": list(dict.fromkeys(same))[:40],
        "service_links": [u for u in same if SERVICE_PATH.search(urlparse(u).path)][:10],
        "location_links": [u for u in same if LOCATION_PATH.search(urlparse(u).path)][:10],
    }
