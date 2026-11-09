"""목표가 알림(price_alerts)과 알림함(notifications), 최저가 매칭 요청(price_match_requests).

- 목표가 알림: 사용자 하나가 상품 하나에 목표가 하나(UNIQUE). 판매가가 목표가 이하가 되면 app.core.pricing.change_store_price 가
  알림함에 한 줄을 넣고 notified_at 을 채운다. 다시 목표가보다 오르면 notified_at 을 비운다(다음 도달 때 또 알린다).
- 알림함: 목표가 도달·1년 최저가 갱신·새 답변·견적 도착. 만드는 곳은 app.core.notifications 의 도우미뿐이다.
  질문·글이 지워져도 알림은 남는다(외래 키 없음).
- 최저가 매칭 요청: 외부 판매처가 더 쌀 때 사용자가 남기는 요청. 요청 당시 가격을 그대로 저장한다.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base

PRICE_MATCH_REQUESTED = "requested"


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class PriceAlert(Base):
    __tablename__ = "price_alerts"
    __table_args__ = (
        # 사용자별 목록·개수도 이 UNIQUE 의 앞부분(owner_subject)으로 찾는다.
        UniqueConstraint("owner_subject", "product_id", name="uq_price_alerts_owner_product"),
        # 판매가가 바뀔 때 그 상품의 알림을 찾는다. 외래 키(product_id)도 이 인덱스를 쓴다.
        Index("ix_price_alerts_product", "product_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    target_price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    # 목표가 도달 알림을 보낸 시각(UTC). null = 아직 보내지 않았다(또는 다시 목표가보다 올랐다)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)


class Notification(Base):
    __tablename__ = "notifications"
    # 사용자별 최신순 목록과 안 읽은 수
    __table_args__ = (Index("ix_notifications_owner_created", "owner_subject", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    # price_target, price_low, answer, quote
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(String(300), nullable=False)
    # 알림이 가리키는 곳. 외래 키를 걸지 않는다(질문·글이 지워져도 알림은 남는다)
    product_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    question_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    post_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PriceMatchRequest(Base):
    __tablename__ = "price_match_requests"
    # 같은 사용자의 같은 상품 요청 찾기(멱등). 앞부분(product_id)이 외래 키 인덱스 역할도 한다.
    __table_args__ = (Index("ix_price_match_requests_product_owner", "product_id", "owner_subject"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    # 요청 당시 우리 판매가와 가장 싼 외부 판매처 가격
    store_price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    external_source: Mapped[str] = mapped_column(String(20), nullable=False)
    external_price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=PRICE_MATCH_REQUESTED)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
