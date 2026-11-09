from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class CartItem(Base):
    __tablename__ = "cart_items"
    # 사용자별 장바구니 조회도 이 UNIQUE 의 앞부분(owner_subject)으로 찾는다.
    __table_args__ = (UniqueConstraint("owner_subject", "product_id", name="uq_cart_items_owner_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    # 이 줄을 마지막으로 담은 견적 묶음(POST /cart/builds). 수동 담기·수량 변경은 바꾸지 않는다. 장바구니로 주문하면
    # 주문 줄(product_order_items.build_id)로 옮긴다. 이미 있는 DB 에는 python -m app.scripts.sync_columns 로 더한다.
    build_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("builds.id", name="fk_cart_items_build_id"), nullable=True
    )
    # 2026-11-05 추가(NULL 허용, app.scripts.sync_columns). 줄을 처음 담을 때의 판매가. 같은 상품을 더 담아도 바꾸지 않는다.
    # 이 컬럼 전에 담은 줄은 NULL(응답의 price_change_krw 도 null)
    added_price_krw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), onupdate=_now, nullable=False
    )
