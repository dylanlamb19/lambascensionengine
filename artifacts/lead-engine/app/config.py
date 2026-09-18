from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_secret: str = "dev-secret-change-me"
    app_host: str = "0.0.0.0"
    app_port: int = 8080
    admin_email: str = "admin@localhost"
    admin_password: str = "changeme"
    database_url: str = "sqlite:////tmp/lead_engine.db"
    daily_discovery_limit: int = 50
    daily_enrichment_limit: int = 20
    daily_audit_limit: int = 40
    daily_spend_cap_cents: int = 500
    qualify_threshold: int = 50
    cache_days: int = 7
    website_audit_cache_days: int = 14
    max_pages_per_audit: int = 6
    max_audit_bytes: int = 1500000
    audit_timeout_seconds: float = 12.0
    google_places_api_key: str = ""
    pagespeed_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    hunter_api_key: str = ""
    enable_places_discovery: bool = False
    enable_pagespeed: bool = True
    enable_contact_enrichment: bool = False
    enable_ai_analysis: bool = False
    enable_outbound_send: bool = False
    frontend_origin: str = ""
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 60

settings = Settings()


def production_safety_problems(s: Settings) -> list[str]:
    if s.app_env != "production":
        return []
    problems = []
    if s.app_secret in ("dev-secret-change-me", "change-me-to-a-long-random-string"):
        problems.append("APP_SECRET is still the default")
    if s.admin_password in ("changeme", "change-me"):
        problems.append("ADMIN_PASSWORD is still the default")
    if not s.frontend_origin:
        problems.append("FRONTEND_ORIGIN is not set, so CORS cannot be restricted to it")
    return problems


def enforce_production_safety(s: Settings = settings) -> None:
    problems = production_safety_problems(s)
    if problems:
        raise RuntimeError("Refusing to start with APP_ENV=production: " + "; ".join(problems) + ".")

