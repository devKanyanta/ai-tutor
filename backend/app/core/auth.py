"""Student accounts: salted scrypt password hashes and opaque bearer tokens (stored only as digests)."""
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db.database import get_db

TOKEN_DAYS = 30
_bearer = HTTPBearer(auto_error=False)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_user(email: str, name: str, password: str) -> Dict[str, Any]:
    """Raises ValueError if the email is already registered."""
    user_id = str(uuid.uuid4())
    email = email.strip().lower()
    with get_db() as db:
        if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise ValueError("An account with this email already exists.")
        db.execute(
            "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
            (user_id, email, name.strip(), hash_password(password)),
        )
        db.commit()
    return {"id": user_id, "email": email, "name": name.strip()}


def authenticate(email: str, password: str) -> Optional[Dict[str, Any]]:
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
    if not row:
        hash_password(password)  # keep timing similar whether or not the account exists
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def issue_token(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    with get_db() as db:
        db.execute("DELETE FROM auth_tokens WHERE expires_at < ?", (now,))
        db.execute(
            "INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (_digest(token), user_id, now + timedelta(days=TOKEN_DAYS)),
        )
        db.commit()
    return token


def revoke_token(token: str) -> None:
    with get_db() as db:
        db.execute("DELETE FROM auth_tokens WHERE token_hash = ?", (_digest(token),))
        db.commit()


def user_from_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    with get_db() as db:
        row = db.execute(
            """SELECT u.id, u.email, u.name FROM auth_tokens t JOIN users u ON u.id = t.user_id
               WHERE t.token_hash = ? AND t.expires_at > ?""",
            (_digest(token), datetime.now(timezone.utc)),
        ).fetchone()
    return dict(row) if row else None


def current_user(credentials: HTTPAuthorizationCredentials = Security(_bearer)) -> Dict[str, Any]:
    """FastAPI dependency: the signed-in student, or 401."""
    user = user_from_token(credentials.credentials if credentials else None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_session(session_id: str, user: Dict[str, Any]) -> None:
    """404 unless this session belongs to the signed-in student (no hint whether it exists)."""
    with get_db() as db:
        row = db.execute("SELECT 1 FROM sessions WHERE id = ? AND user_id = ?", (session_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
