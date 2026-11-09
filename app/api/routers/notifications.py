"""알림함(/notifications). 로그인 필요. 알림은 app.core.notifications 의 도우미가 각 기능의 트랜잭션 안에서 넣는다."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.core import clock
from app.core.session import get_current_subject
from app.db.database import end_read_snapshot
from app.models import Notification
from app.schemas.notification import NotificationPageResponse, NotificationResponse, UnreadCountResponse
from app.schemas.product import MAX_ID

router = APIRouter(prefix="/notifications", tags=["notifications"])

NOTIFICATION_NOT_FOUND = "알림을 찾을 수 없습니다."


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def notification_result(notification: Notification) -> dict:
    return {
        "id": notification.id, "kind": notification.kind, "title": notification.title, "body": notification.body,
        "product_id": notification.product_id, "question_id": notification.question_id,
        "post_id": notification.post_id, "created_at": clock.as_utc(notification.created_at),
        "read": notification.read_at is not None,
    }


def _unread_count(db: Session, subject: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.owner_subject == subject, Notification.read_at.is_(None))
    )


@router.get("", response_model=NotificationPageResponse)
def list_notifications(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    mine = Notification.owner_subject == subject
    total = db.scalar(select(func.count()).select_from(Notification).where(mine))
    # page 에 상한이 없다. 마지막 쪽 뒤는 읽지 않고 빈 목록이다(OFFSET 이 DB 정수 범위를 넘지 않게).
    offset = (page - 1) * page_size
    rows = [] if offset >= total else db.scalars(
        select(Notification).where(mine)
        .order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(page_size)
    ).all()
    return _envelope(
        {
            "items": [notification_result(row) for row in rows], "total": total,
            "unread_count": _unread_count(db, subject), "page": page, "page_size": page_size,
        },
        "알림 목록을 조회했습니다.",
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
def unread_count(subject: str = Depends(get_current_subject), db: Session = Depends(get_db)):
    return _envelope({"unread_count": _unread_count(db, subject)}, "안 읽은 알림 수를 조회했습니다.")


@router.post("/read-all", response_model=UnreadCountResponse, dependencies=[Depends(require_allowed_origin)])
def read_all(subject: str = Depends(get_current_subject), db: Session = Depends(get_db)):
    end_read_snapshot(db)  # 알림 행을 잠그기 전에 인증 SELECT 의 스냅샷을 닫는다
    try:
        db.execute(
            update(Notification)
            .where(Notification.owner_subject == subject, Notification.read_at.is_(None))
            .values(read_at=clock.utc_now()),
            execution_options={"synchronize_session": False},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope({"unread_count": 0}, "모든 알림을 읽음으로 표시했습니다.")


@router.post(
    "/{notification_id}/read", response_model=NotificationResponse, dependencies=[Depends(require_allowed_origin)],
)
def read_notification(
    notification_id: int, subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    # 경로 값의 범위 밖·남의 알림·없는 알림은 모두 404(남의 알림이 있는지 알려 주지 않는다).
    if not 1 <= notification_id <= MAX_ID:
        raise HTTPException(404, NOTIFICATION_NOT_FOUND)
    mine = (Notification.id == notification_id, Notification.owner_subject == subject)
    end_read_snapshot(db)
    try:
        db.execute(
            update(Notification).where(*mine, Notification.read_at.is_(None)).values(read_at=clock.utc_now()),
            execution_options={"synchronize_session": False},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    notification = db.scalars(select(Notification).where(*mine)).first()
    if notification is None:
        raise HTTPException(404, NOTIFICATION_NOT_FOUND)
    return _envelope(notification_result(notification), "알림을 읽음으로 표시했습니다.")
