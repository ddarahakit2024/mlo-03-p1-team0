from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import ALLOWED_ORIGINS
from app.core.event_store import EventStore
from app.db.database import get_db

__all__ = ["ALLOWED_ORIGINS", "Session", "get_db", "get_event_store", "require_allowed_origin"]


def require_allowed_origin(request: Request) -> None:
    # CORS alone does not stop cross-site HTML forms with SameSite=None cookies.
    # Attach to every cookie-authenticated POST/PATCH/DELETE route.
    origin = request.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        raise HTTPException(403, "허용되지 않은 사이트의 요청입니다.")


def get_event_store(request: Request) -> EventStore:
    """create_app 이 app.state.event_store 에 둔 이벤트 저장소. 테스트는 create_app(event_store=...) 로 바꿔 넣는다."""
    return request.app.state.event_store
