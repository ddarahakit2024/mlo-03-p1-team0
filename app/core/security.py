import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES, JWT_ALGORITHM, JWT_SECRET_KEY

_PBKDF2_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str) -> str:
    """로그인 토큰(JWT). sub = subject, 만료 ACCESS_TOKEN_EXPIRE_MINUTES 분. 만료는 실제 시각을 쓴다(가상 시계와 무관)."""
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": subject, "iat": now, "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def access_token_subject(token: str | None) -> str | None:
    """서명·만료가 유효한 로그인 토큰의 sub(문자열). 토큰이 없거나 무효(위조·만료·sub 없음)면 None.

    계정이 아직 있는지는 보지 않는다(인증은 app/core/session.py 가 계정을 확인하고, 요청 로그는 DB 를 부르지 않는다).
    """
    if not token:
        return None
    try:
        claims = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    subject = claims.get("sub")
    return subject if isinstance(subject, str) else None
