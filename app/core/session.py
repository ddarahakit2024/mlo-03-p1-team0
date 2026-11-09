from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import ACCESS_TOKEN_COOKIE_DOMAIN, ACCESS_TOKEN_EXPIRE_MINUTES
from app.core.security import access_token_subject
from app.db.database import get_db
from app.models import KakaoAccount, User, UserProfile
from app.models.user_profile import ROLE_ADMIN

ACCESS_TOKEN_COOKIE = "access_token"
UNAUTHORIZED_MESSAGE = "로그인이 필요합니다."
ADMIN_ONLY_MESSAGE = "관리자만 사용할 수 있습니다."
# Session.info 에 둔다: 요청(세션) 동안 읽은 계정 객체를 강하게 잡아 둔다.
_LOADED_ACCOUNTS = "moa.loaded_accounts"


def _access_token_cookie_options(request: Request) -> dict:
    """발급과 만료에 똑같이 쓰는 쿠키 속성. 속성이 다르면 브라우저가 다른 쿠키로 보고 지우지 않는다."""
    # Loopback development cannot set the production domain cookie.
    # Inspect the actual Host; never derive this policy from X-Forwarded-Host.
    is_loopback = request.url.hostname in {"localhost", "127.0.0.1", "::1"}
    domain = None if is_loopback else (ACCESS_TOKEN_COOKIE_DOMAIN.strip() or None)
    return {
        "domain": domain,
        "httponly": True,
        "secure": True,
        "samesite": "None",
        "partitioned": not is_loopback,
        "path": "/",
    }


def set_access_token_cookie(response: Response, token: str, request: Request) -> None:
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **_access_token_cookie_options(request),
    )


def clear_access_token_cookie(response: Response, request: Request) -> None:
    """로그인 쿠키를 만료시킨다(Max-Age=0). 발급할 때와 같은 domain·path·secure·samesite·partitioned 를 쓴다."""
    response.delete_cookie(ACCESS_TOKEN_COOKIE, **_access_token_cookie_options(request))


def _keep_loaded(db: Session, subject: str, account) -> None:
    """Session 의 identity map 은 약한 참조라, 읽은 계정을 아무도 잡고 있지 않으면 바로 사라져
    같은 요청의 다음 db.get(User, ...)(작성자 이름, 모의 결제 판정 등)이 SELECT 를 다시 한다.
    세션이 닫힐 때까지 잡아 두어 다음 db.get 이 identity map 에서 꺼내게 한다(커밋 뒤에는 만료되어 다시 읽는다)."""
    if account is not None:
        db.info.setdefault(_LOADED_ACCOUNTS, {})[subject] = account


def get_subject_profile(db: Session, subject: str) -> dict[str, str] | None:
    """Return {"name", "provider"} for a token subject, or None if the account is gone."""
    if subject.startswith("kakao:"):
        account = db.get(KakaoAccount, subject.removeprefix("kakao:"))
        _keep_loaded(db, subject, account)
        return None if account is None else {"name": account.nickname, "provider": "kakao"}
    try:
        user_id = int(subject)
    except ValueError:
        return None
    user = db.get(User, user_id)
    _keep_loaded(db, subject, user)
    return None if user is None else {"name": user.name, "provider": "local"}


def get_current_subject(request: Request, db: Session = Depends(get_db)) -> str:
    subject = access_token_subject(request.cookies.get(ACCESS_TOKEN_COOKIE))
    if subject is None or get_subject_profile(db, subject) is None:
        raise _unauthorized()
    return subject


def get_admin_subject(subject: str = Depends(get_current_subject), db: Session = Depends(get_db)) -> str:
    """관리자 API 의존성. 비로그인 401, user_profiles.role 이 admin 이 아니면(행이 없으면) 403.
    docs/specs/2026-11-01-returns-refunds.md. 관리자는 사람이 python -m app.scripts.set_admin 으로 정한다."""
    profile = db.get(UserProfile, subject)
    if profile is None or profile.role != ROLE_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ADMIN_ONLY_MESSAGE)
    return subject


def get_optional_subject(request: Request, db: Session = Depends(get_db)) -> str | None:
    """선택 인증. 쿠키가 없거나 무효(만료·위조·없는 계정)면 401 대신 None(비로그인)."""
    try:
        return get_current_subject(request, db)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_401_UNAUTHORIZED:
            raise
        return None


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=UNAUTHORIZED_MESSAGE,
    )
