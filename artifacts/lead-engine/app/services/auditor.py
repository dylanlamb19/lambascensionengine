"""Stage B website auditor. Polite limited crawl. Deterministic findings only."""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from ..config import settings
from ..models import Activity, ApiUsage, Company, WebsiteAudit
from .flags import build_flags
from .html_signals import analyze_html, finding
from .providers.pagespeed import fetch_pagespeed
from .ssrf import SsrfError, validate_url
from .pinned_http import pinned_client

UA = "LambAscensionResearchBot/0.3 (+https://lambascension.com/bot)"
MAX_REDIRECTS = 5


def _client(pinned_ip: str):
    return pinned_client(
        pinned_ip,
        timeout=settings.audit_timeout_seconds,
        headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
    )


def fetch_url(url: str, method: str = "GET") -> dict:
    current, _ = validate_url(url)
    chain = [current]
    for _ in range(MAX_REDIRECTS + 1):
        current, pinned_ip = validate_url(current)
        try:
            with _client(pinned_ip) as client:
                req = client.build_request(method, current)
                resp = client.send(req, stream=True)
                try:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location")
                        if not loc:
                            return {"ok": False, "error": "redirect_missing_location", "status": resp.status_code, "url": current, "chain": chain}
                        try:
                            nxt, _ = validate_url(loc, allow_relative_base=current)
                        except SsrfError as e:
                            return {"ok": False, "error": f"redirect_blocked:{e}", "status": resp.status_code, "url": current, "chain": chain}
                        chain.append(nxt)
                        current = nxt
                        continue
                    body = b""
                    too_large = False
                    if method != "HEAD":
                        chunks = []
                        total = 0
                        for chunk in resp.iter_bytes():
                            total += len(chunk)
                            if total > settings.max_audit_bytes:
                                too_large = True
                                break
                            chunks.append(chunk)
                        body = b"".join(chunks)
                    if too_large:
                        return {"ok": False, "error": "too_large", "status": resp.status_code, "url": str(resp.url), "chain": chain}
                    text = body.decode(resp.encoding or "utf-8", errors="replace") if body else ""
                    blocked = resp.status_code in (401, 403, 429) or "captcha" in text.lower()[:2000]
                    return {
                        "ok": 200 <= resp.status_code < 400,
                        "blocked": blocked,
                        "status": resp.status_code,
                        "url": str(resp.url),
                        "final_url": str(resp.url),
                        "https": str(resp.url).startswith("https://"),
                        "chain": chain,
                        "headers": {k.lower(): v for k, v in resp.headers.items()},
                        "html": text,
                        "error": None if 200 <= resp.status_code < 400 else f"HTTP {resp.status_code}",
                    }
                finally:
                    resp.close()
        except httpx.TimeoutException:
            return {"ok": False, "error": "timeout", "url": current, "chain": chain}
        except httpx.RequestError as e:
            return {"ok": False, "error": str(e)[:200], "url": current, "chain": chain}
    return {"ok": False, "error": "too_many_redirects", "url": current, "chain": chain}


def robots_allows(base: str, path: str) -> bool:
    robots_url = urljoin(base, "/robots.txt")
    try:
        r = fetch_url(robots_url)
    except SsrfError:
        return True
    if not r.get("ok"):
        return True
    rp = RobotFileParser()
    try:
        rp.parse((r.get("html") or "").splitlines())
        return rp.can_fetch(UA, path)
    except Exception:
        return True


def pick_internal(home_url: str, links: list[str], limit: int) -> list[str]:
    scored = []
    for u in links:
        path = urlparse(u).path.lower()
        rank = 0
        for kw, pts in (
            ("contact", 10), ("quote", 9), ("estimate", 9), ("services", 8),
            ("location", 7), ("about", 5), ("financing", 6), ("review", 4),
        ):
            if kw in path:
                rank += pts
        if rank:
            scored.append((rank, u))
    scored.sort(reverse=True)
    out = []
    seen = set()
    for _, u in scored:
        if u.rstrip("/") == home_url.rstrip("/"):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= limit:
            break
    return out


def run_audit(db, company: Company, *, force: bool = False) -> WebsiteAudit:
    now = datetime.utcnow()
    latest = (
        db.query(WebsiteAudit)
        .filter_by(company_id=company.id)
        .order_by(WebsiteAudit.id.desc())
        .first()
    )
    cache_days = settings.website_audit_cache_days
    if (
        latest
        and not force
        and latest.created_at
        and (now - latest.created_at) < timedelta(days=cache_days)
        and (latest.status or "") not in ("failed", "blocked")
    ):
        return latest

    findings = []
    pages = []
    raw_url = (company.website or "").strip()
    if not raw_url or raw_url.upper() == "UNKNOWN":
        findings.append(finding("resolves", "No website URL", "UNKNOWN", "company.website", "high"))
        audit = WebsiteAudit(
            company_id=company.id,
            facts={"findings": findings, "pages": []},
            observations={"flags": [], "pagespeed": {"status": "UNKNOWN"}},
            status="failed",
            flags=[],
            pagespeed={},
        )
        db.add(audit)
        company.research_status = "failed"
        company.website_status = "missing"
        db.add(Activity(company_id=company.id, kind="audit", detail="No website URL"))
        return audit

    try:
        start, _ = validate_url(raw_url if "://" in raw_url else "https://" + raw_url)
    except SsrfError as e:
        findings.append(finding("resolves", str(e), "ERROR", "ssrf.validate_url", "high", e.code))
        audit = WebsiteAudit(
            company_id=company.id,
            facts={"findings": findings, "pages": []},
            observations={"flags": [], "pagespeed": {}},
            status="failed",
            flags=[],
            pagespeed={},
        )
        db.add(audit)
        company.research_status = "failed"
        company.website_status = "invalid"
        return audit

    db.add(ApiUsage(provider="website_fetch", units=1, est_cost_cents=0))
    home = fetch_url(start)
    pages.append({"url": home.get("final_url") or start, "status": home.get("status"), "role": "homepage"})

    if home.get("blocked"):
        findings.append(finding("resolves", "Request blocked by site", "UNKNOWN", "HTTP GET homepage", "medium", str(home.get("status"))))
        audit = WebsiteAudit(
            company_id=company.id,
            facts={"findings": findings, "pages": pages},
            observations={"flags": [], "pagespeed": {}},
            status="blocked",
            flags=[],
            pagespeed={},
        )
        db.add(audit)
        company.research_status = "blocked"
        company.website_status = "blocked"
        company.last_researched_at = now
        return audit

    if not home.get("ok"):
        findings.append(finding("resolves", home.get("error") or "Fetch failed", "ERROR", "HTTP GET homepage", "high"))
        status = "failed"
        if home.get("error") == "timeout":
            findings[-1]["status"] = "ERROR"
        audit = WebsiteAudit(
            company_id=company.id,
            facts={"findings": findings, "pages": pages},
            observations={"flags": [], "pagespeed": {}},
            status=status,
            flags=[],
            pagespeed={},
        )
        db.add(audit)
        company.research_status = "failed"
        company.website_status = "error"
        company.last_researched_at = now
        return audit

    final = home["final_url"]
    findings.append(finding("resolves", f"HTTP {home['status']}", "VERIFIED", "HTTP GET homepage", "high", final))
    findings.append(finding("https", "HTTPS" if home["https"] else "HTTP only", "VERIFIED", "final URL scheme", "high", final))
    findings.append(finding("http_status", str(home["status"]), "VERIFIED", "HTTP response", "high"))
    chain = home.get("chain") or []
    findings.append(finding(
        "redirects",
        f"{len(chain) - 1} redirect(s)" if len(chain) > 1 else "No redirect",
        "VERIFIED",
        "Location headers",
        "high",
        " → ".join(chain)[:400],
    ))

    html = home.get("html") or ""
    sig = analyze_html(html, final)
    findings.append(finding("title", sig["title"] or "Missing title", "VERIFIED" if sig["title"] else "VERIFIED", "HTML <title>", "high", sig["title"][:200]))
    findings.append(finding("meta_description", sig["meta_description"] or "Missing meta description", "VERIFIED" if sig["meta_description"] else "VERIFIED", "HTML meta description", "high", (sig["meta_description"] or "")[:200]))
    findings.append(finding("h1", sig["h1"] or "No H1 on homepage", "VERIFIED" if sig["h1"] else "VERIFIED", "HTML H1", "high", (sig["h1"] or "")[:200]))
    findings.append(finding(
        "viewport",
        "viewport meta present" if sig["viewport"] else "No viewport meta on homepage",
        "OBSERVED",
        "HTML meta viewport (not a device test)",
        "medium",
    ))
    findings.append(finding(
        "phone_visible",
        f"Phone-like text found: {', '.join(sig['phone_text'][:2])}" if sig["phone_text"] else "No phone-like text on homepage",
        "OBSERVED" if sig["phone_text"] else "VERIFIED",
        "regex on homepage text",
        "medium",
        ", ".join(sig["phone_text"][:3]),
    ))
    findings.append(finding(
        "click_to_call",
        f"tel: link found ({sig['tel_links'][0]})" if sig["tel_links"] else "No tel: link on homepage",
        "VERIFIED",
        "HTML <a href=tel:>",
        "high",
        (sig["tel_links"][0] if sig["tel_links"] else ""),
    ))
    findings.append(finding(
        "contact_form",
        "Form or form fields detected on homepage" if sig["form_detected"] else "No form detected on homepage",
        "VERIFIED" if sig["forms"] else "OBSERVED",
        "HTML <form>/input",
        "high",
    ))
    findings.append(finding(
        "booking",
        f"Booking provider hint: {sig['booking']}" if sig["booking"] else "No known booking provider identified",
        "OBSERVED" if sig["booking"] else "UNKNOWN",
        "script/href vendor strings",
        "medium" if sig["booking"] else "low",
        sig["booking"],
    ))
    findings.append(finding(
        "primary_cta",
        f"CTA text observed: {sig['cta_text']}" if sig["cta_text"] else "No common quote/estimate CTA text in first content",
        "OBSERVED",
        "regex on homepage text",
        "medium",
        sig["cta_text"],
    ))
    findings.append(finding(
        "service_pages",
        f"{len(sig['service_links'])} service-like internal links" if sig["service_links"] else "No service-path links on homepage",
        "OBSERVED",
        "internal href path keywords",
        "medium",
        ", ".join(sig["service_links"][:5]),
    ))
    findings.append(finding(
        "location_pages",
        f"{len(sig['location_links'])} location-like internal links" if sig["location_links"] else "No location-path links on homepage",
        "OBSERVED",
        "internal href path keywords",
        "medium",
        ", ".join(sig["location_links"][:5]),
    ))
    findings.append(finding(
        "testimonials",
        "Review/testimonial language on homepage" if sig["testimonials"] else "No testimonial language on homepage",
        "OBSERVED",
        "regex on homepage text",
        "low",
    ))
    findings.append(finding(
        "financing",
        "Financing language on homepage" if sig["financing"] else "No financing language on homepage",
        "OBSERVED",
        "regex on homepage text",
        "medium",
    ))
    findings.append(finding(
        "chat",
        f"Chat vendor hint: {sig['chat']}" if sig["chat"] else "No known chat widget on homepage",
        "OBSERVED" if sig["chat"] else "UNKNOWN",
        "script vendor strings",
        "medium" if sig["chat"] else "low",
        sig["chat"],
    ))
    findings.append(finding(
        "gtag",
        "Google tag/gtag detected on checked page" if sig["gtag"] else "No Google tag/gtag detected on checked page",
        "VERIFIED" if sig["gtag"] else "VERIFIED",
        "HTML/script inspection",
        "high",
    ))
    findings.append(finding(
        "gtm",
        "Google Tag Manager detected on checked page" if sig["gtm"] else "No Google Tag Manager detected on checked page",
        "VERIFIED" if sig["gtm"] else "VERIFIED",
        "HTML/script inspection",
        "high",
    ))
    findings.append(finding(
        "meta_pixel",
        "Meta Pixel snippet detected on checked page" if sig["pixel"] else "No Meta Pixel detected on checked page",
        "VERIFIED" if sig["pixel"] else "VERIFIED",
        "HTML/script inspection",
        "high",
    ))
    findings.append(finding(
        "ads_conversion_tag",
        "Google Ads conversion-like tag on checked page" if sig["ads_conversion_signal"] else "No Google Ads conversion tag signal on checked page",
        "OBSERVED" if sig["ads_conversion_signal"] else "VERIFIED",
        "HTML/script inspection",
        "medium",
    ))

    origin = f"{urlparse(final).scheme}://{urlparse(final).netloc}"
    robots = fetch_url(urljoin(origin, "/robots.txt"))
    pages.append({"url": urljoin(origin, "/robots.txt"), "status": robots.get("status"), "role": "robots"})
    findings.append(finding(
        "robots",
        "robots.txt present" if robots.get("ok") else "robots.txt not retrieved",
        "VERIFIED" if robots.get("ok") else "UNKNOWN",
        "GET /robots.txt",
        "high",
    ))
    sm = fetch_url(urljoin(origin, "/sitemap.xml"))
    pages.append({"url": urljoin(origin, "/sitemap.xml"), "status": sm.get("status"), "role": "sitemap"})
    findings.append(finding(
        "sitemap",
        "sitemap.xml present" if sm.get("ok") else "sitemap.xml not retrieved",
        "VERIFIED" if sm.get("ok") else "UNKNOWN",
        "GET /sitemap.xml",
        "high",
    ))

    crawl_ok = True
    if robots.get("ok"):
        crawl_ok = robots_allows(origin + "/", final)

    extra_html = [html]
    extra_titles = [sig["title"]]
    broken = []
    internals = pick_internal(final, sig["internal_links"], min(5, settings.max_pages_per_audit - 1))
    if crawl_ok:
        for u in internals:
            time.sleep(0.25)
            try:
                db.add(ApiUsage(provider="website_fetch", units=1, est_cost_cents=0))
                pg = fetch_url(u)
            except SsrfError:
                continue
            pages.append({"url": pg.get("final_url") or u, "status": pg.get("status"), "role": "internal"})
            if not pg.get("ok"):
                broken.append(u)
                continue
            s2 = analyze_html(pg.get("html") or "", pg.get("final_url") or u)
            extra_html.append(pg.get("html") or "")
            extra_titles.append(s2["title"])
            if s2["pixel"] and not sig["pixel"]:
                findings.append(finding("meta_pixel_inner", "Meta Pixel detected on an inner checked page", "VERIFIED", "HTML/script inspection", "high", u))
            if s2["form_detected"] and not sig["form_detected"]:
                findings.append(finding("contact_form_inner", "Form detected on an inner checked page", "VERIFIED", "HTML <form>", "high", u))
    else:
        findings.append(finding("crawl", "Internal crawl skipped (robots.txt)", "OBSERVED", "robots.txt", "high"))

    sample = sig["internal_links"][:8]
    if crawl_ok:
        for u in sample:
            if any(p.get("url") == u for p in pages):
                continue
            try:
                hd = fetch_url(u, method="HEAD")
            except SsrfError:
                continue
            st = hd.get("status") or 0
            if st >= 400:
                broken.append(u)
    findings.append(finding(
        "broken_links",
        f"{len(broken)} broken internal links in limited sample" if broken else "No broken links in limited sample",
        "OBSERVED",
        "HEAD/GET up to 8 internal URLs",
        "medium",
        ", ".join(broken[:5]),
    ))
    titles = [t for t in extra_titles if t]
    dup = len(titles) != len(set(titles)) and len(titles) > 1
    findings.append(finding(
        "duplicate_titles",
        "Duplicate titles across checked pages" if dup else "No duplicate titles on checked pages",
        "OBSERVED",
        "compare <title> on fetched pages",
        "medium",
    ))
    findings.append(finding(
        "missing_seo",
        "Missing title or meta or H1 on homepage" if (not sig["title"] or not sig["meta_description"] or not sig["h1"]) else "Title, meta, and H1 present on homepage",
        "VERIFIED",
        "homepage SEO tags",
        "high",
    ))

    psi = {"status": "UNKNOWN", "reason": "not requested"}
    try:
        psi = fetch_pagespeed(db, final)
    except Exception as e:
        psi = {"status": "ERROR", "reason": str(e)[:200]}
    if psi.get("status") == "VERIFIED":
        findings.append(finding(
            "pagespeed_mobile",
            f"{psi.get('performance')} mobile performance",
            "VERIFIED",
            "Google PageSpeed Insights",
            "high",
            f"a11y={psi.get('accessibility')} seo={psi.get('seo')}",
        ))
        findings.append(finding(
            "cwv",
            f"LCP {((psi.get('lcp') or {}).get('display')) or 'UNKNOWN'}",
            "VERIFIED",
            "Google PageSpeed Insights",
            "high",
        ))
    else:
        findings.append(finding(
            "pagespeed_mobile",
            psi.get("reason") or "PageSpeed not available",
            "UNKNOWN" if psi.get("status") == "UNKNOWN" else "ERROR",
            "Google PageSpeed Insights",
            "low",
        ))

    flags = build_flags(findings, company.review_count or 0)
    audit_status = "complete"
    if not internals and crawl_ok:
        audit_status = "partial"
    if home.get("ok") and (robots.get("blocked") or sm.get("blocked")):
        audit_status = "partial"

    audit = WebsiteAudit(
        company_id=company.id,
        facts={"findings": findings, "pages": pages},
        observations={"flags": flags, "note": "Tag detection is not advertising status."},
        status=audit_status,
        flags=flags,
        pagespeed=psi if isinstance(psi, dict) else {},
    )
    db.add(audit)
    company.research_status = audit_status
    company.website_status = "ok" if home.get("https") else "http"
    company.last_researched_at = now
    db.add(Activity(company_id=company.id, kind="audit", detail=f"Website audit {audit_status}, {len(pages)} URLs"))
    return audit
