from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base

PRICE_SOURCE_STORE = "store"  # 우리 판매가. app.core.pricing.change_store_price 만 쓴다
PRICE_SOURCE_COUPANG = "coupang"  # 외부 판매처(모의 시장 app.scripts.market_tick, 카탈로그·브라우저 수집)
PRICE_SOURCE_NAVER = "naver"
PRICE_SOURCES = (PRICE_SOURCE_STORE, PRICE_SOURCE_COUPANG, PRICE_SOURCE_NAVER)

# 외부 가격의 출처(docs/specs/2026-11-01-market-model.md). null = 판매가(store) 이력과 이 컬럼이 생기기 전 행
PRICE_ORIGIN_SIMULATED = "simulated"  # 모의 시장 모델(app.scripts.market_tick)
PRICE_ORIGIN_COLLECTED = "collected"  # 실제 수집값(카탈로그 가져오기, app.scripts.import_collected_prices)
PRICE_ORIGINS = (PRICE_ORIGIN_SIMULATED, PRICE_ORIGIN_COLLECTED)


class ProductPriceHistory(Base):
    """가격을 덮어쓰지 않고 쌓는다. 우리 판매가와 외부 판매처 가격을 source 로, 외부 가격의 모의·실제를 origin 으로 구분한다."""

    __tablename__ = "product_price_history"
    # 상품별 가격 이력 API, 90일 최저가(store), market_tick 의 첫 store 가격. 외래 키(product_id)도 이 인덱스를 쓴다.
    __table_args__ = (
        Index("ix_product_price_history_product_source_recorded", "product_id", "source", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    price_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # UTC
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    # 2026-11-01 추가(app.scripts.sync_columns 가 이미 있는 테이블에 더한다). 인덱스 없음: 시장 도구는 recorded_at 인덱스로 찾는다
    origin: Mapped[str | None] = mapped_column(String(20), nullable=True)
