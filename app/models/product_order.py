from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()

ORDER_READY = "READY"
ORDER_PAID = "PAID"
ORDER_CANCELLED = "CANCELLED"

PAYMENT_PROVIDER_PORTONE = "portone"
# 로컬 시뮬레이션 전용 모의 결제(app/core/mock_payment.py). PortOne 에는 이 결제가 없다.
PAYMENT_PROVIDER_MOCK = "mock"


class ProductOrder(Base):
    __tablename__ = "product_orders"
    # 내 주문 목록(본인·최신순·쪽)과 리뷰 자격 확인(본인의 PAID 주문). 끝에 기본 키(payment_id)가 붙어 정렬까지 인덱스로 읽는다.
    __table_args__ = (Index("ix_product_orders_buyer_created", "buyer_subject", "created_at"),)

    # "order-" + uuid hex. PortOne paymentId 로 그대로 쓴다.
    payment_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    buyer_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ORDER_READY, index=True)
    order_name: Mapped[str] = mapped_column(String(200), nullable=False)
    total_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    recipient_name: Mapped[str] = mapped_column(String(50), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    postal_code: Mapped[str] = mapped_column(String(10), nullable=False)
    address1: Mapped[str] = mapped_column(String(200), nullable=False)
    address2: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    delivery_memo: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    # 주문을 만들 때 정한 결제 방식. 확인(POST /orders/confirm)은 이 값으로 PortOne 조회 여부를 정한다.
    payment_provider: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PAYMENT_PROVIDER_PORTONE, server_default=PAYMENT_PROVIDER_PORTONE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items: Mapped[list["ProductOrderItem"]] = relationship(
        cascade="all, delete-orphan", order_by="ProductOrderItem.id", lazy="selectin"
    )


class ProductOrderItem(Base):
    __tablename__ = "product_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[str] = mapped_column(ForeignKey("product_orders.payment_id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    # 주문 당시의 이름과 가격. 상품 정보가 바뀌어도 주문 내역은 그대로 남는다.
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    # 장바구니로 주문할 때 그 장바구니 줄의 build_id 를 옮긴다(바로 구매는 NULL). 이미 있는 DB 에는
    # python -m app.scripts.sync_columns 로 더한다. docs/specs/2026-11-01-build-id-purpose.md
    build_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("builds.id", name="fk_product_order_items_build_id"), nullable=True, index=True
    )
