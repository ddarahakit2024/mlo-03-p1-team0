from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("stock >= 0", name="ck_products_stock_non_negative"),
        CheckConstraint(
            "performance_score >= 1 AND performance_score <= 100000", name="ck_products_performance_score_range"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # 판매가. 바꿀 때는 반드시 app.core.pricing.change_store_price 를 거친다(가격 이력을 함께 남긴다).
    price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    thumbnail_url: Mapped[str] = mapped_column(String(1000), nullable=False, default="", server_default="")
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # [{"label": "소켓", "value": "AM5"}, ...]
    specs: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    # 출시일(날짜만). is_new 는 이 값과 오늘(Asia/Seoul)로 계산한다.
    released_on: Mapped[date] = mapped_column(Date, nullable=False)
    # 같은 카테고리 안에서만 비교하는 성능 지수(1~100000). value_score 는 이 값과 가격으로 계산한다.
    performance_score: Mapped[int] = mapped_column(Integer, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
