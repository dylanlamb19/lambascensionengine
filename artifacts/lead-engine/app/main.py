import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .auth import current_user, hash_password, is_legacy_hash, make_token, verify_password
from .config import enforce_production_safety, settings
from .db import Base, SessionLocal, engine, get_db
from .models import Activity, ApiUsage, AppSetting, Company, Contact, OutreachMessage, Score, User, WebsiteAudit
from .services.auditor import run_audit
from .services.providers.places import ProviderError, normalize_place, search_text, usage_today
from .services.owner import build_tasks, explain, friendly_error, home_status, FIT_WORDS, STAGE_WORDS
from .services.scoring import opener, score_company

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"

enforce_production_safety()

app = FastAPI(title="Lamb Ascension Lead Engine", version="3.0-phase3")
_cors_origins = [settings.frontend_origin] if settings.app_env == "production" else ["*"]
app.add_middleware(CORSMiddleware, allow_origins=_cors_origins, allow_methods=["*"], allow_headers=["*"])

DEFAULT_OFFERS = {
    "acquire": {"name": "Acquire", "min": 2500, "max": 3500, "includes": "Google + Meta management, weekly reporting"},
    "convert": {"name": "Convert", "min": 4000, "max": 6000, "includes": "Ads + landing pages + tracking / CRM hygiene"},
    "system": {"name": "System", "min": 7500, "max": 10000, "includes": "Full acquisition system + creative cadence + lead QA"},
}

class LoginIn(BaseModel):
    email: str
    password: str

class CompanyIn(BaseModel):
    name: str
    vertical: str = ""
    website: str = ""
    phone: str = ""
    city: str = ""
    state: str = "TX"
    google_rating: str = ""
    review_count: int = 0
    job_value_est: int = 0
    years_in_business: int = 0
    google_ads_status: str = "unknown"
    meta_ads_status: str = "unknown"
    notes: str = ""
    source: str = "manual"
    is_demo: bool = False
    contact_name: str = ""
    contact_title: str = ""

class StageIn(BaseModel):
    stage: str

class OutreachIn(BaseModel):
    body: str
    channel: str = "email"

class FinderIn(BaseModel):
    vertical: str
    location: str
    radius_m: int = 40000
    limit: int = 20
    min_rating: float = 0
    min_reviews: int = 0
    ads_preference: str = "any"
    min_score: int = 0

class ResearchIn(BaseModel):
    force: bool = False

class ExplainIn(BaseModel):
    topic: str = "default"
    name: str = ""

STAGES = [
    "New", "Researching", "Qualified", "Ready for Review", "Approved for Outreach",
    "Contacted", "Replied", "Call Booked", "Proposal Sent", "Negotiation",
    "Won", "Lost", "Do Not Contact",
]

QUEUE_STATUSES = {"queued", "researching", "complete", "partial", "blocked", "failed", "skipped"}


class _LoginRateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()
        if len(hits) >= self.max_attempts:
            raise HTTPException(429, "Too many sign-in attempts. Wait a minute and try again.")
        hits.append(now)


_login_limiter = _LoginRateLimiter(settings.login_rate_limit_attempts, settings.login_rate_limit_window_seconds)


def domain_of(url: str) -> str:
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    return urlparse(url).netloc.replace("www.", "").lower()


def latest_audit(db: Session, cid: int):
    return db.query(WebsiteAudit).filter_by(company_id=cid).order_by(WebsiteAudit.id.desc()).first()


def persist_score(db: Session, company: Company, audit=None):
    if audit is None:
        audit = latest_audit(db, company.id)
    result = score_company(company, audit)
    company.score = result["total"]
    company.fit = result["fit"]
    company.stage_b_score = result["total"] if audit else company.stage_b_score
    db.add(Score(company_id=company.id, total=result["total"], breakdown=result["breakdown"], why=result["why"]))
    return result


@app.on_event("startup")
def startup():
    (ROOT / "data").mkdir(exist_ok=True)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not db.query(User).filter_by(email=settings.admin_email).first():
            db.add(User(email=settings.admin_email, password_hash=hash_password(settings.admin_password)))
        if not db.query(AppSetting).filter_by(key="offers").first():
            db.add(AppSetting(key="offers", value=DEFAULT_OFFERS))
        db.commit()
    finally:
        db.close()


@app.post("/api/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    _login_limiter.check(f"{body.email}:{request.client.host if request.client else 'unknown'}")
    user = db.query(User).filter_by(email=body.email).first()
    if not user and body.email == settings.admin_email:
        user = User(email=settings.admin_email, password_hash=hash_password(settings.admin_password))
        db.add(user)
        db.commit()
        db.refresh(user)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Bad email or password")
    if is_legacy_hash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.commit()
    return {"token": make_token(user.email), "email": user.email}


@app.get("/api/health")
def health():
    return {"ok": True, "phase": 3, "places": settings.enable_places_discovery}


@app.get("/api/stats")
def stats(_: str = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Company).all()

    def n(stage=None, fit=None):
        q = rows
        if stage:
            q = [r for r in q if r.stage == stage]
        if fit:
            q = [r for r in q if r.fit == fit]
        return len(q)

    audits = db.query(WebsiteAudit).count()
    fetches, _ = usage_today(db, "website_fetch")
    psi, _ = usage_today(db, "pagespeed")
    return {
        "prospects": len(rows),
        "priority": n(fit="priority"),
        "strong": n(fit="strong"),
        "ready": n(stage="Ready for Review"),
        "contacted": n(stage="Contacted"),
        "replied": n(stage="Replied"),
        "calls": n(stage="Call Booked"),
        "proposals": n(stage="Proposal Sent"),
        "won": len([r for r in rows if r.stage == "Won"]),
        "mrr_won": 0,
        "audits": audits,
        "pages_fetched_today": fetches,
        "pagespeed_today": psi,
        "queued": len([r for r in rows if r.research_status == "queued"]),
        "researched": len([r for r in rows if r.research_status in ("complete", "partial")]),
        "by_vertical": {},
        "by_stage": {s: n(stage=s) for s in STAGES},
    }


def serialize(c: Company, db: Session | None = None):
    contact = c.contacts[0] if c.contacts else None
    latest = None
    audit = None
    if db:
        latest = db.query(Score).filter_by(company_id=c.id).order_by(Score.id.desc()).first()
        audit = latest_audit(db, c.id)
    flags = (audit.flags if audit else None) or []
    return {
        "id": c.id,
        "name": c.name,
        "vertical": c.vertical,
        "website": c.website or "UNKNOWN",
        "phone": c.phone or "UNKNOWN",
        "city": c.city,
        "state": c.state,
        "google_rating": c.google_rating or "UNKNOWN",
        "review_count": c.review_count,
        "job_value_est": c.job_value_est,
        "years_in_business": c.years_in_business,
        "google_ads_status": c.google_ads_status,
        "meta_ads_status": c.meta_ads_status,
        "notes": c.notes,
        "source": c.source,
        "is_demo": c.is_demo,
        "stage": c.stage,
        "score": c.score,
        "fit": c.fit,
        "do_not_contact": c.do_not_contact,
        "contact_name": contact.name if contact else "UNKNOWN",
        "contact_title": contact.title if contact else "UNKNOWN",
        "contact_email": (contact.email if contact and contact.email else "NOT FOUND"),
        "why": latest.why if latest else [],
        "breakdown": latest.breakdown if latest else {},
        "last_researched_at": c.last_researched_at.isoformat() if c.last_researched_at else None,
        "provider": c.provider or "UNKNOWN",
        "provider_place_id": c.provider_place_id or "UNKNOWN",
        "source_url": c.source_url or "UNKNOWN",
        "address": c.address or "UNKNOWN",
        "category": c.category or "UNKNOWN",
        "lat": c.lat,
        "lng": c.lng,
        "research_status": getattr(c, "research_status", "none") or "none",
        "initial_score": getattr(c, "initial_score", 0) or 0,
        "stage_b_score": getattr(c, "stage_b_score", 0) or 0,
        "website_status": getattr(c, "website_status", "unknown") or "unknown",
        "qualify_reason": getattr(c, "qualify_reason", "") or "",
        "last_verified_at": c.last_verified_at.isoformat() if getattr(c, "last_verified_at", None) else None,
        "flags": flags,
        "audit_id": audit.id if audit else None,
        "audit_status": audit.status if audit else "none",
        "fit_plain": FIT_WORDS.get(c.fit, c.fit),
        "stage_plain": STAGE_WORDS.get(c.stage, c.stage),
    }


@app.get("/api/companies")
def list_companies(min_score: int = 0, vertical: str = "", _: str = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Company)
    if vertical:
        q = q.filter(Company.vertical == vertical)
    rows = q.order_by(Company.score.desc()).all()
    return [serialize(c, db) for c in rows if c.score >= min_score]


@app.post("/api/companies")
def create_company(body: CompanyIn, _: str = Depends(current_user), db: Session = Depends(get_db)):
    domain = domain_of(body.website)
    existing = db.query(Company).filter(Company.domain == domain, Company.city == body.city).first() if domain else None
    if existing:
        raise HTTPException(409, f"Duplicate of {existing.name}")
    c = Company(
        name=body.name, vertical=body.vertical, website=body.website, domain=domain,
        phone=body.phone, city=body.city, state=body.state, google_rating=body.google_rating,
        review_count=body.review_count, job_value_est=body.job_value_est,
        years_in_business=body.years_in_business, google_ads_status=body.google_ads_status,
        meta_ads_status=body.meta_ads_status, notes=body.notes, source=body.source, is_demo=body.is_demo,
        stage="Ready for Review", research_status="queued" if body.website else "none",
    )
    db.add(c)
    db.flush()
    if body.contact_name:
        db.add(Contact(company_id=c.id, name=body.contact_name, title=body.contact_title, source=body.source, confidence="stated"))
    persist_score(db, c)
    db.add(Activity(company_id=c.id, kind="created", detail=f"Source {body.source}"))
    db.commit()
    db.refresh(c)
    return serialize(c, db)


@app.get("/api/companies/{cid}")
def get_company(cid: int, _: str = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Company, cid)
    if not c:
        raise HTTPException(404)
    data = serialize(c, db)
    data["opener"] = opener(c, data["contact_name"] if data["contact_name"] != "UNKNOWN" else "")
    data["activities"] = [{"kind": a.kind, "detail": a.detail, "at": a.created_at.isoformat()} for a in c.activities]
    audit = latest_audit(db, c.id)
    data["audit"] = None
    if audit:
        data["audit"] = {
            "id": audit.id,
            "status": audit.status,
            "findings": (audit.facts or {}).get("findings") or [],
            "pages": (audit.facts or {}).get("pages") or [],
            "flags": audit.flags or [],
            "pagespeed": audit.pagespeed or {},
            "created_at": audit.created_at.isoformat() if audit.created_at else None,
        }
    return data


@app.patch("/api/companies/{cid}/stage")
def set_stage(cid: int, body: StageIn, _: str = Depends(current_user), db: Session = Depends(get_db)):
    if body.stage not in STAGES:
        raise HTTPException(400, "Unknown stage")
    c = db.get(Company, cid)
    if not c:
        raise HTTPException(404)
    c.stage = body.stage
    db.add(Activity(company_id=c.id, kind="stage", detail=body.stage))
    db.commit()
    return serialize(c, db)


@app.post("/api/companies/{cid}/rescore")
def rescore(cid: int, _: str = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Company, cid)
    if not c:
        raise HTTPException(404)
    persist_score(db, c)
    db.commit()
    return serialize(c, db)


@app.post("/api/companies/{cid}/outreach")
def save_outreach(cid: int, body: OutreachIn, _: str = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Company, cid)
    if not c:
        raise HTTPException(404)
    if c.do_not_contact:
        raise HTTPException(400, "Do not contact")
    msg = OutreachMessage(company_id=cid, channel=body.channel, body=body.body, status="draft")
    db.add(msg)
    db.commit()
    return {"id": msg.id, "status": "draft"}


@app.post("/api/companies/{cid}/outreach/{mid}/approve")
def approve_outreach(cid: int, mid: int, _: str = Depends(current_user), db: Session = Depends(get_db)):
    msg = db.query(OutreachMessage).filter_by(id=mid, company_id=cid).first()
    if not msg:
        raise HTTPException(404)
    msg.status = "approved"
    db.add(Activity(company_id=cid, kind="outreach_approved", detail=msg.channel))
    db.commit()
    return {"id": msg.id, "status": msg.status}


@app.get("/api/settings/offers")
def offers(_: str = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter_by(key="offers").first()
    return row.value if row else DEFAULT_OFFERS


@app.put("/api/settings/offers")
def save_offers(body: dict, _: str = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter_by(key="offers").first()
    if not row:
        row = AppSetting(key="offers", value=body)
        db.add(row)
    else:
        row.value = body
    db.commit()
    return row.value


def upsert_from_place(db: Session, p: dict, min_rating: float, min_reviews: int, min_score: int):
    init, reason = initial_score(p, min_rating, min_reviews)
    threshold = settings.qualify_threshold
    research = "queued" if init >= threshold and init >= min_score else "none"
    existing = None
    if p["provider_place_id"] and p["provider_place_id"] != "UNKNOWN":
        existing = db.query(Company).filter_by(provider_place_id=p["provider_place_id"]).first()
    if not existing and p.get("website") not in ("", "UNKNOWN"):
        dom = domain_of(p["website"])
        if dom:
            existing = db.query(Company).filter(Company.domain == dom, Company.city == (p.get("city") or "")).first()
    if existing:
        existing.last_verified_at = datetime.utcnow()
        existing.google_rating = "" if p["google_rating"] == "UNKNOWN" else p["google_rating"]
        existing.review_count = p["review_count"]
        existing.phone = "" if p["phone"] == "UNKNOWN" else p["phone"]
        existing.website = "" if p["website"] == "UNKNOWN" else p["website"]
        existing.address = "" if p["address"] == "UNKNOWN" else p["address"]
        existing.source_url = p.get("source_url") or existing.source_url
        existing.initial_score = init
        existing.qualify_reason = reason
        if research == "queued" and existing.research_status in ("", "none"):
            existing.research_status = "queued"
            existing.stage = "Researching"
        persist_score(db, existing)
        return existing, True
    c = Company(
        name=p["name"],
        vertical=p["vertical"],
        website="" if p["website"] == "UNKNOWN" else p["website"],
        domain=domain_of(p["website"]) if p["website"] != "UNKNOWN" else "",
        phone="" if p["phone"] == "UNKNOWN" else p["phone"],
        address="" if p["address"] == "UNKNOWN" else p["address"],
        city="" if p["city"] == "UNKNOWN" else p["city"],
        state="" if p["state"] == "UNKNOWN" else p["state"],
        google_rating="" if p["google_rating"] == "UNKNOWN" else p["google_rating"],
        review_count=p["review_count"],
        job_value_est=p["job_value_est"],
        google_ads_status="unknown",
        meta_ads_status="unknown",
        source="google_places",
        provider="google_places",
        provider_place_id=p["provider_place_id"] if p["provider_place_id"] != "UNKNOWN" else "",
        source_url="" if p.get("source_url") == "UNKNOWN" else (p.get("source_url") or ""),
        category="" if p.get("category") == "UNKNOWN" else (p.get("category") or ""),
        lat=p.get("lat") or 0,
        lng=p.get("lng") or 0,
        is_demo=False,
        stage="Researching" if research == "queued" else "New",
        research_status=research,
        initial_score=init,
        qualify_reason=reason,
        last_verified_at=datetime.utcnow(),
        notes="Ads status unknown — Places does not report advertising.",
    )
    db.add(c)
    db.flush()
    persist_score(db, c)
    db.add(Activity(company_id=c.id, kind="discovered", detail=f"google_places initial {init}"))
    return c, False


@app.post("/api/finder/search")
def finder_search(body: FinderIn, _: str = Depends(current_user), db: Session = Depends(get_db)):
    if not settings.enable_places_discovery or not settings.google_places_api_key:
        fe = friendly_error("disabled")
        return {
            "ok": False,
            "error": "disabled",
            "message": fe["happened"],
            "press": fe["press"],
            "results": [],
        }
    units, spend = usage_today(db, "places_text_search_enterprise")
    if units >= settings.daily_discovery_limit:
        raise HTTPException(429, f"Daily discovery cap ({settings.daily_discovery_limit}) reached")
    if spend >= settings.daily_spend_cap_cents:
        raise HTTPException(429, "Daily API spend cap reached")
    limit = min(50, max(1, body.limit))
    try:
        raw = search_text(
            db,
            vertical=body.vertical,
            location=body.location,
            radius_m=body.radius_m,
            limit=limit,
            min_rating=body.min_rating,
        )
    except ProviderError as e:
        db.commit()
        fe = friendly_error(e.code, str(e))
        return {"ok": False, "error": e.code, "message": fe["happened"], "press": fe["press"], "results": []}
    created = updated = queued = 0
    out = []
    for item in raw:
        p = normalize_place(item, body.vertical, body.location)
        if body.min_reviews and p["review_count"] < body.min_reviews:
            continue
        c, was_dup = upsert_from_place(db, p, body.min_rating, body.min_reviews, body.min_score)
        if was_dup:
            updated += 1
        else:
            created += 1
        if c.research_status == "queued":
            queued += 1
        out.append(serialize(c, db))
    db.commit()
    return {
        "ok": True,
        "provider": "google_places",
        "created": created,
        "updated_duplicates": updated,
        "queued_for_research": queued,
        "returned": len(out),
        "note": "Advertising preference is stored as unknown. Places does not disclose ad spend.",
        "results": out,
    }


def _cap_ok(db: Session) -> None:
    units, _ = usage_today(db, "website_fetch")
    if units >= settings.daily_audit_limit * settings.max_pages_per_audit:
        raise HTTPException(429, "Daily research/fetch cap reached")
    _, spend = usage_today(db, "pagespeed")
    if spend >= settings.daily_spend_cap_cents:
        raise HTTPException(429, "Daily API spend cap reached")


def research_one(db: Session, c: Company, force: bool = False) -> Company:
    c.research_status = "researching"
    db.flush()
    audit = run_audit(db, c, force=force)
    persist_score(db, c, audit)
    if audit.status in ("complete", "partial"):
        c.stage = "Qualified"
    return c


@app.get("/api/research-queue")
def research_queue(status: str = "", _: str = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Company)
    if status:
        q = q.filter(Company.research_status == status)
    else:
        q = q.filter(Company.research_status.in_(list(QUEUE_STATUSES)))
    rows = q.order_by(Company.initial_score.desc()).all()
    return [serialize(c, db) for c in rows]


@app.post("/api/research-queue/{cid}/research")
def research_company(cid: int, body: ResearchIn | None = None, _: str = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Company, cid)
    if not c:
        raise HTTPException(404)
    _cap_ok(db)
    force = bool(body and body.force)
    research_one(db, c, force=force)
    db.commit()
    db.refresh(c)
    return serialize(c, db)


@app.post("/api/research-queue/next")
def research_next(_: str = Depends(current_user), db: Session = Depends(get_db)):
    _cap_ok(db)
    c = (
        db.query(Company)
        .filter(Company.research_status == "queued")
        .order_by(Company.initial_score.desc())
        .first()
    )
    if not c:
        return {"ok": False, "message": "Queue empty"}
    research_one(db, c)
    db.commit()
    return {"ok": True, "company": serialize(c, db)}


@app.post("/api/research-queue/research-all")
def research_all(_: str = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Company).filter(Company.research_status == "queued").order_by(Company.initial_score.desc()).all()
    done = 0
    errors = []
    for c in rows[:20]:
        try:
            _cap_ok(db)
        except HTTPException as e:
            errors.append(e.detail)
            break
        try:
            research_one(db, c)
            done += 1
            db.commit()
        except Exception as e:
            db.rollback()
            c.research_status = "failed"
            db.add(Activity(company_id=c.id, kind="audit", detail=str(e)[:200]))
            db.commit()
            errors.append(f"{c.name}: {e}")
    return {"ok": True, "updated": done, "errors": errors, "note": "No contact enrichment. HTML + optional PageSpeed only."}


@app.post("/api/research-queue/retry-failed")
def retry_failed(_: str = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Company).filter(Company.research_status.in_(["failed", "blocked"])).all()
    n = 0
    for c in rows[:10]:
        try:
            _cap_ok(db)
            research_one(db, c, force=True)
            n += 1
            db.commit()
        except Exception:
            db.rollback()
    return {"ok": True, "updated": n}


@app.post("/api/research-queue/{cid}/{action}")
def research_action(cid: int, action: str, _: str = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Company, cid)
    if not c:
        raise HTTPException(404)
    if action == "research":
        _cap_ok(db)
        research_one(db, c)
    elif action == "skip":
        c.research_status = "skipped"
        db.add(Activity(company_id=c.id, kind="skip", detail="Skipped research"))
    elif action == "archive":
        c.research_status = "archived"
        c.stage = "Lost"
        db.add(Activity(company_id=c.id, kind="archive", detail="Archived"))
    else:
        raise HTTPException(400, "action must be research, skip, or archive")
    db.commit()
    return serialize(c, db)


@app.get("/api/companies/{cid}/audit")
def get_audit(cid: int, _: str = Depends(current_user), db: Session = Depends(get_db)):
    audit = latest_audit(db, cid)
    if not audit:
        raise HTTPException(404, "No audit")
    return {
        "id": audit.id,
        "status": audit.status,
        "findings": (audit.facts or {}).get("findings") or [],
        "pages": (audit.facts or {}).get("pages") or [],
        "flags": audit.flags or [],
        "pagespeed": audit.pagespeed or {},
        "created_at": audit.created_at.isoformat() if audit.created_at else None,
    }


@app.get("/api/settings/discovery")
def discovery_settings(_: str = Depends(current_user), db: Session = Depends(get_db)):
    units, spend = usage_today(db, "places_text_search_enterprise")
    fetches, _ = usage_today(db, "website_fetch")
    psi, _ = usage_today(db, "pagespeed")
    key = settings.google_places_api_key
    return {
        "provider": "google_places",
        "enabled": settings.enable_places_discovery,
        "api_key_configured": bool(key),
        "api_key_status": "configured" if key else "missing",
        "pagespeed_key": "configured" if settings.pagespeed_api_key else "optional/missing",
        "pagespeed_enabled": settings.enable_pagespeed,
        "daily_discovery_cap": settings.daily_discovery_limit,
        "daily_audit_cap": settings.daily_audit_limit,
        "daily_spend_cap_cents": settings.daily_spend_cap_cents,
        "qualify_threshold": settings.qualify_threshold,
        "cache_days": settings.cache_days,
        "website_audit_cache_days": settings.website_audit_cache_days,
        "usage_today_calls": units,
        "usage_today_cents": spend,
        "pages_fetched_today": fetches,
        "pagespeed_today": psi,
    }


@app.get("/api/owner/home")
def owner_home(_: str = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Company).all()
    tasks = build_tasks(rows)
    status = home_status(rows, tasks)
    status["tasks"] = tasks
    status["places_on"] = bool(settings.enable_places_discovery and settings.google_places_api_key)
    return status


@app.get("/api/owner/tasks")
def owner_tasks(_: str = Depends(current_user), db: Session = Depends(get_db)):
    return build_tasks(db.query(Company).all())


@app.post("/api/explain")
def owner_explain(body: ExplainIn, _: str = Depends(current_user)):
    return {"plain": explain(body.topic, {"name": body.name})}


@app.get("/api/friendly-error")
def owner_error(code: str = "default", message: str = "", _: str = Depends(current_user)):
    return friendly_error(code, message)


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")
