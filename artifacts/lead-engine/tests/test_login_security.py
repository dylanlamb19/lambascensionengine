import hashlib
import tempfile
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings, production_safety_problems, enforce_production_safety


class ProductionSafetyTests(unittest.TestCase):
    def test_dev_env_never_blocked(self):
        s = Settings(app_env="development", app_secret="dev-secret-change-me", admin_password="changeme", frontend_origin="")
        self.assertEqual(production_safety_problems(s), [])
        enforce_production_safety(s)

    def test_production_blocks_default_secret(self):
        s = Settings(app_env="production", app_secret="dev-secret-change-me", admin_password="realpw123", frontend_origin="https://app.lambascension.com")
        self.assertTrue(any("APP_SECRET" in p for p in production_safety_problems(s)))
        with self.assertRaises(RuntimeError):
            enforce_production_safety(s)

    def test_production_blocks_default_admin_password(self):
        s = Settings(app_env="production", app_secret="a-real-unique-secret", admin_password="changeme", frontend_origin="https://app.lambascension.com")
        self.assertTrue(any("ADMIN_PASSWORD" in p for p in production_safety_problems(s)))

    def test_production_blocks_missing_frontend_origin(self):
        s = Settings(app_env="production", app_secret="a-real-unique-secret", admin_password="realpw123", frontend_origin="")
        self.assertTrue(any("FRONTEND_ORIGIN" in p for p in production_safety_problems(s)))

    def test_production_passes_with_safe_settings(self):
        s = Settings(app_env="production", app_secret="a-real-unique-secret", admin_password="realpw123", frontend_origin="https://app.lambascension.com")
        self.assertEqual(production_safety_problems(s), [])
        enforce_production_safety(s)


class _AppTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import db as db_module
        from app import main as main_module
        from app.main import _LoginRateLimiter

        cls._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        cls._tmp.close()
        engine = create_engine(f"sqlite:///{cls._tmp.name}", connect_args={"check_same_thread": False})
        session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        db_module.engine = engine
        db_module.SessionLocal = session_local
        main_module.engine = engine
        main_module.SessionLocal = session_local
        cls.limit = 3
        main_module._login_limiter = _LoginRateLimiter(max_attempts=cls.limit, window_seconds=60)
        cls.main = main_module
        main_module.startup()
        from fastapi.testclient import TestClient
        cls.client = TestClient(main_module.app)

    @classmethod
    def tearDownClass(cls):
        import os
        os.unlink(cls._tmp.name)


class LoginRateLimitTests(_AppTestCase):
    def test_too_many_attempts_returns_429(self):
        for _ in range(self.limit):
            r = self.client.post("/api/login", json={"email": "nobody@example.com", "password": "wrong"})
            self.assertEqual(r.status_code, 401)
        r = self.client.post("/api/login", json={"email": "nobody@example.com", "password": "wrong"})
        self.assertEqual(r.status_code, 429)

    def test_different_email_not_blocked_by_another_users_attempts(self):
        for _ in range(self.limit):
            self.client.post("/api/login", json={"email": "target@example.com", "password": "wrong"})
        r = self.client.post("/api/login", json={"email": "someone-else@example.com", "password": "wrong"})
        self.assertNotEqual(r.status_code, 429)


class LegacyPasswordUpgradeTests(_AppTestCase):
    def test_legacy_hash_upgraded_after_successful_login(self):
        from app.models import User

        email = "legacy-user@example.com"
        password = "correct horse battery staple"
        legacy_hash = hashlib.sha256((self.main.settings.app_secret + password).encode()).hexdigest()
        db = self.main.SessionLocal()
        try:
            db.add(User(email=email, password_hash=legacy_hash))
            db.commit()
        finally:
            db.close()
        r = self.client.post("/api/login", json={"email": email, "password": password})
        self.assertEqual(r.status_code, 200)
        db = self.main.SessionLocal()
        try:
            row = db.query(User).filter_by(email=email).first()
            self.assertTrue(row.password_hash.startswith(("$2a$", "$2b$", "$2y$")))
        finally:
            db.close()
        r2 = self.client.post("/api/login", json={"email": email, "password": password})
        self.assertEqual(r2.status_code, 200)


if __name__ == "__main__":
    unittest.main()
