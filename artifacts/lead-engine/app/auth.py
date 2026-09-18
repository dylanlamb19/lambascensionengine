from datetime import datetime, timedelta
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
import bcrypt
from .config import settings

bearer = HTTPBearer(auto_error=False)


def _pw_bytes(pw: str) -> bytes:
    return pw.encode("utf-8")[:72]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(_pw_bytes(pw), bcrypt.gensalt()).decode("utf-8")


def is_legacy_hash(hashed: str) -> bool:
    return not hashed.startswith(("$2a$", "$2b$", "$2y$"))


def verify_password(pw: str, hashed: str) -> bool:
    if is_legacy_hash(hashed):
        import hashlib, hmac
        legacy = hashlib.sha256((settings.app_secret + pw).encode()).hexdigest()
        return hmac.compare_digest(legacy, hashed)
    try:
        return bcrypt.checkpw(_pw_bytes(pw), hashed.encode("utf-8"))
    except ValueError:
        return False


def make_token(email: str) -> str:
    payload = {"sub": email, "exp": datetime.utcnow() + timedelta(days=7)}
    return jwt.encode(payload, settings.app_secret, algorithm="HS256")


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if creds is None:
        raise HTTPException(401, "Sign in required")
    try:
        data = jwt.decode(creds.credentials, settings.app_secret, algorithms=["HS256"])
        return data["sub"]
    except JWTError:
        raise HTTPException(401, "Invalid or expired session")
