"""상품 응답에 붙는 계산 값. 반올림은 모두 0.5 올림(ROUND_HALF_UP)으로 통일한다."""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.core import clock

NEW_PRODUCT_DAYS = 90


def round_half_up(value: Decimal, places: int) -> float:
    return float(value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def value_score(performance_score: int, price_krw: int) -> float | None:
    """가성비 지수 = performance_score ÷ (price_krw ÷ 10000) = 1만 원당 성능 점수, 소수 둘째 자리.

    가격이 0 이하인 비정상 데이터만 None.
    """
    if price_krw <= 0:
        return None
    return round_half_up(Decimal(performance_score) * 10000 / Decimal(price_krw), 2)


def rating_average(rating_sum: int | None, review_count: int) -> float | None:
    """평균 평점, 소수 첫째 자리. 리뷰가 없으면 None."""
    if not review_count:
        return None
    return round_half_up(Decimal(rating_sum or 0) / Decimal(review_count), 1)


def is_new(released_on: date) -> bool:
    """출시일이 오늘(Asia/Seoul) 기준 90일 이내면 True. 오늘 출시·출시 예정(미래 날짜)도 True."""
    return released_on >= clock.seoul_today() - timedelta(days=NEW_PRODUCT_DAYS)
