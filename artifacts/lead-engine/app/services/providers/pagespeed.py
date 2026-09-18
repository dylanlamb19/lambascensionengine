"""Google PageSpeed Insights adapter. Optional. Never invent scores."""
from __future__ import annotations

from datetime import datetime, timedelta

import httpx

from ...config import settings
from ...models import ApiUsage, SearchCache

PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
EST_CENTS = 0  # PSI has a large free quota; we still count units.


def fetch_pagespeed(db, url: str) -> dict:
    if not settings.enable_pagespeed:
        return {"status": "UNKNOWN", "reason": "PageSpeed disabled"}
    key = settings.pagespeed_api_key
    cache_k = "psi:" + url
    row = db.query(SearchCache).filter_by(cache_key=cache_k[:64] if len(cache_k) > 64 else cache_k).first()
    # Use hash-length keys
    import hashlib
    ck = "psi_" + hashlib.sha256(url.encode()).hexdigest()[:40]
    row = db.query(SearchCache).filter_by(cache_key=ck).first()
    if row and row.expires_at > datetime.utcnow():
        return row.payload

    params = {"url": url, "strategy": "mobile", "category": ["performance", "accessibility", "best-practices", "seo"]}
    if key:
        params["key"] = key
    try:
        r = httpx.get(PSI_URL, params=params, timeout=40)
    except httpx.TimeoutException:
        return {"status": "ERROR", "reason": "PageSpeed timeout"}
    db.add(ApiUsage(provider="pagespeed", units=1, est_cost_cents=EST_CENTS))
    if r.status_code in (401, 403):
        return {"status": "ERROR", "reason": "PageSpeed API key rejected"}
    if r.status_code == 429:
        return {"status": "ERROR", "reason": "PageSpeed quota exceeded"}
    if r.status_code >= 400:
        return {"status": "ERROR", "reason": f"PageSpeed HTTP {r.status_code}"}
    data = r.json()
    cats = (data.get("lighthouseResult") or {}).get("categories") or {}
    audits = (data.get("lighthouseResult") or {}).get("audits") or {}

    def score(name):
        s = (cats.get(name) or {}).get("score")
        return round(s * 100) if isinstance(s, (int, float)) else None

    def metric(aid):
        a = audits.get(aid) or {}
        return {"title": a.get("title"), "display": a.get("displayValue"), "score": a.get("score")}

    payload = {
        "status": "VERIFIED",
        "source": "Google PageSpeed Insights",
        "strategy": "mobile",
        "performance": score("performance"),
        "accessibility": score("accessibility"),
        "best_practices": score("best-practices"),
        "seo": score("seo"),
        "lcp": metric("largest-contentful-paint"),
        "cls": metric("cumulative-layout-shift"),
        "inp": metric("interaction-to-next-paint"),
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }
    db.add(SearchCache(cache_key=ck, payload=payload, expires_at=datetime.utcnow() + timedelta(days=settings.website_audit_cache_days)))
    return payload
