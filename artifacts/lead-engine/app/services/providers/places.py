"""Google Places API (New) Text Search adapter. Returns only provider data."""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

import httpx

from ...config import settings
from ...models import ApiUsage, SearchCache

TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText"
GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json"

# Enterprise field mask: name, address, geo, type, rating, reviews, phone, website, maps URL
FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.types",
    "places.primaryType",
    "places.primaryTypeDisplayName",
    "places.googleMapsUri",
    "places.rating",
    "places.userRatingCount",
    "places.nationalPhoneNumber",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.businessStatus",
    "nextPageToken",
])

INCLUDED_TYPE = {
    "Roofing": "roofing_contractor",
    "HVAC": "hvac_contractor",
    "Plumbing / sewer": "plumber",
    "Foundation repair": "general_contractor",
    "Remodeling / general contractors": "general_contractor",
    "Solar": "electrician",
    "Med spas": "spa",
    "Cosmetic dentistry / dental implants": "dentist",
    "Personal injury law": "lawyer",
    "High-ticket B2B services": "",
}

QUERY = {
    "Roofing": "roofing contractor",
    "HVAC": "HVAC contractor",
    "Plumbing / sewer": "plumber sewer drain",
    "Foundation repair": "foundation repair contractor",
    "Remodeling / general contractors": "remodeling general contractor",
    "Solar": "solar installer",
    "Med spas": "med spa",
    "Cosmetic dentistry / dental implants": "dental implants dentist",
    "Personal injury law": "personal injury lawyer",
    "High-ticket B2B services": "B2B services company",
}

JOB_DEFAULT = {
    "Roofing": 15000,
    "HVAC": 7500,
    "Plumbing / sewer": 8000,
    "Foundation repair": 12000,
    "Remodeling / general contractors": 18000,
    "Solar": 20000,
    "Med spas": 2500,
    "Cosmetic dentistry / dental implants": 8000,
    "Personal injury law": 15000,
    "High-ticket B2B services": 5000,
}

EST_SEARCH_CENTS = 4  # ~$0.035 Enterprise Text Search rounded
EST_GEOCODE_CENTS = 1


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def cache_key(parts: dict) -> str:
    raw = "|".join(f"{k}={parts[k]}" for k in sorted(parts))
    return hashlib.sha256(raw.encode()).hexdigest()


def _log_usage(db, provider: str, units: int, cents: int):
    db.add(ApiUsage(provider=provider, units=units, est_cost_cents=cents))


def usage_today(db, provider: str) -> tuple[int, int]:
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = db.query(ApiUsage).filter(ApiUsage.provider == provider, ApiUsage.created_at >= start).all()
    return sum(r.units for r in rows), sum(r.est_cost_cents for r in rows)


def geocode(db, location: str) -> tuple[float, float]:
    if not settings.google_places_api_key:
        raise ProviderError("disabled", "Live discovery is disabled. Configure a provider in Settings.")
    r = httpx.get(GEOCODE, params={"address": location, "key": settings.google_places_api_key}, timeout=20)
    data = r.json()
    _log_usage(db, "geocoding", 1, EST_GEOCODE_CENTS)
    if data.get("status") == "REQUEST_DENIED":
        raise ProviderError("invalid_key", data.get("error_message") or "Geocoding request denied")
    if data.get("status") == "OVER_QUERY_LIMIT":
        raise ProviderError("quota", "Geocoding quota exceeded")
    results = data.get("results") or []
    if not results:
        raise ProviderError("zero", f"Could not geocode {location}")
    loc = results[0]["geometry"]["location"]
    return float(loc["lat"]), float(loc["lng"])


def search_text(db, *, vertical: str, location: str, radius_m: int, limit: int, min_rating: float) -> list[dict]:
    if not settings.enable_places_discovery or not settings.google_places_api_key:
        raise ProviderError("disabled", "Live discovery is disabled. Configure a provider in Settings.")

    key = cache_key({
        "v": vertical, "loc": location, "r": radius_m, "n": limit, "min": min_rating, "p": "places_v1"
    })
    row = db.query(SearchCache).filter_by(cache_key=key).first()
    if row and row.expires_at > datetime.utcnow():
        return row.payload.get("places") or []

    lat, lng = geocode(db, location)
    included = INCLUDED_TYPE.get(vertical, "")
    text_query = f"{QUERY.get(vertical, vertical)} in {location}"
    collected = []
    page_token = None
    pages = 0

    while len(collected) < limit and pages < 5:
        pages += 1
        body = {
            "textQuery": text_query,
            "regionCode": "US",
            "languageCode": "en",
            "maxResultCount": min(20, limit - len(collected)),
            "locationBias": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": float(max(1000, radius_m)),
                }
            },
        }
        if included:
            body["includedType"] = included
            body["strictTypeFiltering"] = False
        if min_rating and min_rating >= 0.5:
            body["minRating"] = min(5.0, round(min_rating * 2) / 2)
        if page_token:
            body["pageToken"] = page_token

        try:
            resp = httpx.post(
                TEXT_SEARCH,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": settings.google_places_api_key,
                    "X-Goog-FieldMask": FIELD_MASK,
                },
                json=body,
                timeout=30,
            )
        except httpx.TimeoutException:
            raise ProviderError("timeout", "Places API timed out")

        _log_usage(db, "places_text_search_enterprise", 1, EST_SEARCH_CENTS)

        if resp.status_code == 403 or resp.status_code == 401:
            raise ProviderError("invalid_key", resp.text[:400])
        if resp.status_code == 429:
            raise ProviderError("quota", "Places API quota exceeded")
        if resp.status_code >= 400:
            raise ProviderError("provider", f"Places HTTP {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        places = data.get("places") or []
        collected.extend(places)
        page_token = data.get("nextPageToken")
        if not page_token or not places:
            break

    collected = collected[:limit]
    if not collected:
        raise ProviderError("zero", "Provider returned zero results for that search.")

    expires = datetime.utcnow() + timedelta(days=max(1, int(getattr(settings, "cache_days", 7) or 7)))
    if row:
        row.payload = {"places": collected}
        row.expires_at = expires
    else:
        db.add(SearchCache(cache_key=key, payload={"places": collected}, expires_at=expires))
    return collected


def normalize_place(raw: dict, vertical: str, market: str) -> dict:
    name = ((raw.get("displayName") or {}).get("text")) or ""
    addr = raw.get("formattedAddress") or ""
    loc = raw.get("location") or {}
    types = raw.get("types") or []
    city, state = split_city_state(addr, market)
    website = raw.get("websiteUri") or ""
    phone = raw.get("nationalPhoneNumber") or raw.get("internationalPhoneNumber") or ""
    rating = raw.get("rating")
    reviews = raw.get("userRatingCount")
    pid = raw.get("id") or ""
    maps = raw.get("googleMapsUri") or (f"https://www.google.com/maps/place/?q=place_id:{pid}" if pid else "")
    primary = raw.get("primaryTypeDisplayName", {})
    if isinstance(primary, dict):
        primary = primary.get("text") or raw.get("primaryType") or ""
    return {
        "provider": "google_places",
        "provider_place_id": pid,
        "source_url": maps,
        "name": name or "UNKNOWN",
        "website": website or "UNKNOWN",
        "phone": phone or "UNKNOWN",
        "address": addr or "UNKNOWN",
        "city": city or "UNKNOWN",
        "state": state or "UNKNOWN",
        "google_rating": str(rating) if rating is not None else "UNKNOWN",
        "review_count": int(reviews or 0),
        "category": primary or (types[0] if types else "UNKNOWN"),
        "lat": float(loc.get("latitude") or 0),
        "lng": float(loc.get("longitude") or 0),
        "vertical": vertical,
        "job_value_est": JOB_DEFAULT.get(vertical, 8000),
        "google_ads_status": "unknown",
        "meta_ads_status": "unknown",
        "business_status": raw.get("businessStatus") or "UNKNOWN",
    }


def split_city_state(addr: str, market: str) -> tuple[str, str]:
    if not addr:
        parts = [p.strip() for p in market.split(",")]
        return (parts[0] if parts else "UNKNOWN", parts[1] if len(parts) > 1 else "TX")
    bits = [b.strip() for b in addr.split(",")]
    if len(bits) >= 3:
        city = bits[-3] if bits[-1].replace(" ", "").isalnum() and len(bits[-1]) <= 12 else bits[-2]
        state_zip = bits[-2] if bits[-1].replace(" ", "").isdigit() or "USA" in bits[-1].upper() else bits[-1]
        state = state_zip.split()[0] if state_zip else "UNKNOWN"
        return city, state
    return market.split(",")[0].strip(), "TX"
