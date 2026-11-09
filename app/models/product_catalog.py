"""카탈로그가 관리하는 상품의 정형 스펙과 벤치마크. docs/specs/2026-11-01-product-catalog.md "데이터 변경"

값은 가져오기 도구(python -m app.scripts.import_catalog)만 쓴다. 화면에 보이는 표는 계속 products.specs 다.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class ProductAttributes(Base):
    """상품 하나의 기계용 스펙(카테고리별 스키마는 app/core/catalog_schema.py). 상품마다 한 행."""

    __tablename__ = "product_attributes"
    # 제조사 모델 번호는 외부 가격 매칭 키라 겹치지 않는다.
    __table_args__ = (UniqueConstraint("model_code", name="uq_product_attributes_model_code"),)

    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), primary_key=True)
    model_code: Mapped[str] = mapped_column(String(100), nullable=False)
    series: Mapped[str] = mapped_column(String(100), nullable=False)
    # 예: {"socket": "AM5", "cores": 8, ...}
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)


class ProductBenchmark(Base):
    """상품의 벤치마크 점수 한 줄(예: passmark_cpu_mark). 출처 URL 을 함께 남긴다."""

    __tablename__ = "product_benchmarks"
    # 상품마다 같은 이름은 한 줄. 앞부분(product_id)이 외래 키 인덱스 역할도 한다.
    __table_args__ = (UniqueConstraint("product_id", "name", name="uq_product_benchmarks_product_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    # FLOAT(53) = MariaDB 의 8바이트 DOUBLE. 4바이트 FLOAT 는 소수 점수를 바꿔 저장해, 다시 가져올 때 같은 값을 다르다고 본다.
    score: Mapped[float] = mapped_column(Float(precision=53), nullable=False)
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
