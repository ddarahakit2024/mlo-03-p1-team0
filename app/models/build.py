"""견적 묶음(build). docs/specs/2026-11-01-build-id-purpose.md

견적 게시판의 견적 댓글을 장바구니에 한 번에 담을 때 한 행을 만든다. 담은 장바구니 줄(cart_items.build_id)과 그 줄로 만든
주문 줄(product_order_items.build_id)이 이 id 로 이어져 "함께 산 한 대분의 PC" 단위가 된다.
"""
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base

# 지금은 견적 댓글에서 담은 묶음 하나뿐이다.
BUILD_SOURCE_QUOTE = "quote"


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class Build(Base):
    __tablename__ = "builds"
    # 사용자별 최신순(4-1·4-3 피처를 만들 때 사용자의 묶음을 시간순으로 읽는다)
    __table_args__ = (Index("ix_builds_owner_created", "owner_subject", "created_at"),)

    # uuid4 hex(32자)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    # 어느 견적 글·댓글에서 담았는지. 외래 키를 걸지 않는다(글·댓글이 지워져도 묶음 기록은 남는다).
    post_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
