"""로그인 주체(subject)별 프로필. docs/specs/2026-11-01-build-id-purpose.md

이메일 회원은 회원가입 때 한 행을 만든다(사용 목적을 고르지 않으면 purpose NULL). 카카오 회원과 이 기능 전에 가입한
회원은 행이 없다(GET /user/me 의 purpose 는 null).

관리자 표시 role(docs/specs/2026-11-01-returns-refunds.md): "admin" 이거나 NULL. 사람이 python -m app.scripts.set_admin 으로
정한다(행이 없는 회원은 그때 행을 만든다). 이미 있는 DB 에는 python -m app.scripts.sync_columns 로 컬럼을 더한다.
"""
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base

# 관리자 API(app/core/session.py 의 get_admin_subject)를 쓸 수 있는 role. 그 밖의 값은 관리자가 아니다.
ROLE_ADMIN = "admin"


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class UserProfile(Base):
    __tablename__ = "user_profiles"

    # 토큰 subject: 이메일 회원 "<users.id>", 카카오 "kakao:<id>"
    subject: Mapped[str] = mapped_column(String(100), primary_key=True)
    # gaming·office·creative·development·other(견적 게시판 용도와 같다) 또는 NULL(선택 안 함)
    purpose: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # "admin" 또는 NULL. 기존 행에 값이 없으므로 NULL 을 허용한다(app.scripts.sync_columns 의 ADDED_COLUMNS)
    role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), onupdate=_now, nullable=False
    )
