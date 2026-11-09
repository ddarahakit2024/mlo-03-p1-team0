"""판매가 변경과 가격 이력.

데이터 원칙: 가격은 덮어쓰기만 하지 않고 product_price_history 에 남긴다.
우리 판매가(products.price_krw)를 바꾸는 코드는 반드시 change_store_price 를 거친다.
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import clock, notifications
from app.models import Product, ProductPriceHistory
from app.models.product_price_history import PRICE_ORIGINS, PRICE_SOURCE_STORE, PRICE_SOURCES

MAX_PRICE_KRW = 100_000_000
LOWEST_PRICE_WINDOW_DAYS = 90
EXTERNAL_PRICE_SOURCES = tuple(source for source in PRICE_SOURCES if source != PRICE_SOURCE_STORE)


def _check_price(price_krw: int) -> None:
    if type(price_krw) is not int or not 1 <= price_krw <= MAX_PRICE_KRW:
        raise ValueError(f"price_krw must be an integer between 1 and {MAX_PRICE_KRW}")


def change_store_price(
    db: Session, product: Product, price_krw: int, recorded_at: datetime | None = None,
) -> ProductPriceHistory:
    """우리 판매가를 바꾸는 유일한 함수. products.price_krw 를 바꾸고 store 이력을 한 줄 남긴다.

    값이 같아도 기록한다(그 시각에 이 가격이었다는 확인). commit 은 부르는 쪽이 한다.
    recorded_at 은 시드처럼 과거 시점을 채울 때만 준다. 기본은 지금(UTC).
    목표가 알림(price_target)·1년 최저가 알림(price_low)도 같은 트랜잭션에서 넣는다(app.core.notifications).
    """
    _check_price(price_krw)
    at = recorded_at or clock.utc_now()
    if product.id is None:
        db.add(product)
        db.flush()
    else:
        # 새 상품에는 알림이 있을 수 없다. 새 기록을 넣기 전에 직전 365일 store 최저가와 비교한다.
        notifications.on_store_price_change(db, product, price_krw, at)
    product.price_krw = price_krw
    entry = ProductPriceHistory(
        product_id=product.id, price_krw=price_krw, source=PRICE_SOURCE_STORE, recorded_at=at,
    )
    db.add(entry)
    return entry


def record_external_price(
    db: Session, product_id: int, source: str, price_krw: int, recorded_at: datetime | None = None,
    origin: str | None = None,
) -> ProductPriceHistory:
    """외부 판매처(coupang, naver) 가격을 기록한다. 우리 판매가는 바꾸지 않는다. commit 은 부르는 쪽이 한다.

    origin: "simulated"(모의 시장), "collected"(실제 수집값), None(출처를 나누지 않는 기록. 시드의 예시 이력 등).
    """
    if source not in EXTERNAL_PRICE_SOURCES:
        raise ValueError(f"source must be one of {EXTERNAL_PRICE_SOURCES}")
    if origin is not None and origin not in PRICE_ORIGINS:
        raise ValueError(f"origin must be one of {PRICE_ORIGINS} or None")
    _check_price(price_krw)
    entry = ProductPriceHistory(
        product_id=product_id, price_krw=price_krw, source=source, recorded_at=recorded_at or clock.utc_now(),
        origin=origin,
    )
    db.add(entry)
    return entry


def lowest_store_price_since(db: Session, product_id: int, days: int = LOWEST_PRICE_WINDOW_DAYS) -> int | None:
    """최근 days 일 동안(지금까지, 가상 시계 기준)의 store 이력 중 최저가. 지금 이후 기록은 세지 않는다. 이력이 없으면 None."""
    now = clock.utc_now()
    since = now - timedelta(days=days)
    return db.scalar(
        select(func.min(ProductPriceHistory.price_krw)).where(
            ProductPriceHistory.product_id == product_id,
            ProductPriceHistory.source == PRICE_SOURCE_STORE,
            ProductPriceHistory.recorded_at >= since,
            ProductPriceHistory.recorded_at <= now,
        )
    )
