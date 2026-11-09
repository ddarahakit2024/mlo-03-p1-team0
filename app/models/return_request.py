"""반품 신청과 그 상품 줄. docs/specs/2026-11-01-returns-refunds.md

구매자가 결제한 주문(PAID)의 상품 일부를 수량 단위로 신청하고, 관리자가 승인하면 환불한다. 주문 상태
(product_orders.status)는 바꾸지 않는다(PAID 그대로). 반품은 이 테이블로 본다.

상태: REQUESTED → (관리자) REJECTED / APPROVED → 환불 성공 REFUNDED. 신청한 사람은 REQUESTED 일 때만 WITHDRAWN.
환불이 실패하면 APPROVED 로 남고 refund_error 를 기록한다(관리자가 다시 승인할 수 있다).
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import clock
from app.db.database import Base

RETURN_REQUESTED = "REQUESTED"
RETURN_APPROVED = "APPROVED"
RETURN_REFUNDED = "REFUNDED"
RETURN_REJECTED = "REJECTED"
RETURN_WITHDRAWN = "WITHDRAWN"
RETURN_STATUSES = (RETURN_REQUESTED, RETURN_APPROVED, RETURN_REFUNDED, RETURN_REJECTED, RETURN_WITHDRAWN)
# 신청 가능 수량에서 빼는 신청(거절·철회한 수량은 다시 신청할 수 있다)
CLAIMING_STATUSES = (RETURN_REQUESTED, RETURN_APPROVED, RETURN_REFUNDED)

REASON_DEFECTIVE = "defective"  # 불량: 환불해도 재고를 되돌리지 않는다
REASON_CHANGED_MIND = "changed_mind"  # 단순 변심: 왕복 배송비를 빼고 환불한다
RETURN_REASONS = (REASON_DEFECTIVE, "incompatible", "not_as_described", "wrong_item", REASON_CHANGED_MIND)


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class ReturnRequest(Base):
    __tablename__ = "return_requests"
    # 관리자 반품 목록(상태별 · 신청 최근 순 · 쪽)
    __table_args__ = (Index("ix_return_requests_status_requested", "status", "requested_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[str] = mapped_column(ForeignKey("product_orders.payment_id"), nullable=False, index=True)
    requester_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    detail: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=RETURN_REQUESTED)
    # 신청할 때 서버가 계산해 저장한다: 환불 금액 = max(0, 상품 합계 − 배송비 차감)
    items_total_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    shipping_deduction_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    refund_amount_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
    # 마지막으로 결정한 시각과 사람(관리자 승인·거절, 신청한 사람의 철회)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_subject: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refund_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    items: Mapped[list["ReturnRequestItem"]] = relationship(
        cascade="all, delete-orphan", order_by="ReturnRequestItem.id", lazy="selectin"
    )


class ReturnRequestItem(Base):
    __tablename__ = "return_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("return_requests.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    # 주문 당시 단가(product_order_items.unit_price_krw). 상품 가격이 바뀌어도 환불 금액은 그대로다.
    unit_price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
