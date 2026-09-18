from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

def now():
    return datetime.utcnow()

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    vertical: Mapped[str] = mapped_column(String(80), default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    domain: Mapped[str] = mapped_column(String(255), default="", index=True)
    phone: Mapped[str] = mapped_column(String(80), default="")
    address: Mapped[str] = mapped_column(String(500), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(40), default="")
    google_rating: Mapped[str] = mapped_column(String(40), default="")
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    hours: Mapped[str] = mapped_column(String(255), default="")
    service_area: Mapped[str] = mapped_column(String(255), default="")
    locations_count: Mapped[int] = mapped_column(Integer, default=1)
    job_value_est: Mapped[int] = mapped_column(Integer, default=0)
    years_in_business: Mapped[int] = mapped_column(Integer, default=0)
    size_est: Mapped[str] = mapped_column(String(80), default="")
    revenue_est: Mapped[str] = mapped_column(String(80), default="")
    google_ads_status: Mapped[str] = mapped_column(String(80), default="unknown")
    meta_ads_status: Mapped[str] = mapped_column(String(80), default="unknown")
    ads_confidence: Mapped[str] = mapped_column(String(80), default="low")
    notes: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(80), default="manual")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    do_not_contact: Mapped[bool] = mapped_column(Boolean, default=False)
    stage: Mapped[str] = mapped_column(String(40), default="New")
    score: Mapped[int] = mapped_column(Integer, default=0)
    fit: Mapped[str] = mapped_column(String(20), default="low")
    last_researched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    provider: Mapped[str] = mapped_column(String(40), default="")
    provider_place_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    source_url: Mapped[str] = mapped_column(String(500), default="")
    category: Mapped[str] = mapped_column(String(120), default="")
    lat: Mapped[float] = mapped_column(Float, default=0)
    lng: Mapped[float] = mapped_column(Float, default=0)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    research_status: Mapped[str] = mapped_column(String(40), default="none")
    initial_score: Mapped[int] = mapped_column(Integer, default=0)
    qualify_reason: Mapped[str] = mapped_column(Text, default="")
    website_status: Mapped[str] = mapped_column(String(40), default="unknown")
    stage_b_score: Mapped[int] = mapped_column(Integer, default=0)
    readiness: Mapped[str] = mapped_column(String(80), default="")
    deep_status: Mapped[str] = mapped_column(String(40), default="none")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    contacts = relationship("Contact", back_populates="company", cascade="all, delete-orphan")
    activities = relationship("Activity", back_populates="company", cascade="all, delete-orphan")

class Contact(Base):
    __tablename__ = "contacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    name: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    email_status: Mapped[str] = mapped_column(String(40), default="unknown")
    linkedin: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(80), default="unknown")
    confidence: Mapped[str] = mapped_column(String(20), default="unknown")
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    company = relationship("Company", back_populates="contacts")

class EvidenceFact(Base):
    __tablename__ = "evidence_facts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    key: Mapped[str] = mapped_column(String(80))
    value: Mapped[str] = mapped_column(Text, default="UNKNOWN")
    source: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    confidence: Mapped[str] = mapped_column(String(20), default="low")
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ResearchSnapshot(Base):
    __tablename__ = "research_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class WebsiteAudit(Base):
    __tablename__ = "website_audits"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    facts: Mapped[dict] = mapped_column(JSON, default=dict)
    observations: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(40), default="complete")
    flags: Mapped[list] = mapped_column(JSON, default=list)
    pagespeed: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class AdObservation(Base):
    __tablename__ = "ad_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    network: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(80))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    notes: Mapped[str] = mapped_column(Text, default="")

class Score(Base):
    __tablename__ = "scores"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    total: Mapped[int] = mapped_column(Integer, default=0)
    breakdown: Mapped[dict] = mapped_column(JSON, default=dict)
    why: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class OutreachMessage(Base):
    __tablename__ = "outreach_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    channel: Mapped[str] = mapped_column(String(40))
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    kind: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    company = relationship("Company", back_populates="activities")

class FollowUp(Base):
    __tablename__ = "follow_ups"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    due_at: Mapped[datetime] = mapped_column(DateTime)
    note: Mapped[str] = mapped_column(Text, default="")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class Opportunity(Base):
    __tablename__ = "opportunities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    package: Mapped[str] = mapped_column(String(40), default="Acquire")
    retainer: Mapped[int] = mapped_column(Integer, default=0)
    ad_budget_est: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(40), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

class AppSetting(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

class SearchCache(Base):
    __tablename__ = "search_cache"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(64), unique=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class ApiUsage(Base):
    __tablename__ = "api_usage"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(80))
    units: Mapped[int] = mapped_column(Integer, default=1)
    est_cost_cents: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
