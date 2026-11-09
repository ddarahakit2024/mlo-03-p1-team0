"""출시 전 상품 숨기기. docs/specs/2026-11-01-product-catalog.md "출시 전 상품 숨기기"

출시됨 = released_on <= clock.seoul_today()(Asia/Seoul, 가상 시계를 따른다). 출시 전 상품은 없는 상품처럼 다룬다.
상품을 고르는 곳(목록·필터 집계·상세·가격 이력·리뷰·장바구니·주문·견적 부품·시장 도구)은 모두 이 모듈의 기준 하나를 쓴다.
- released(): SQL WHERE 조건(쿼리에서 고를 때)
- is_released(): 이미 읽은 상품(시장 도구처럼 모든 행을 먼저 잠근 뒤 고를 때)
오늘 날짜는 부를 때마다 다시 계산한다(가상 시계가 바뀌면 바로 따른다).
"""
from datetime import date

from sqlalchemy import ColumnElement

from app.core import clock
from app.models import Product


def release_cutoff() -> date:
    """이날까지 출시한 상품이 출시된 상품이다(오늘, Asia/Seoul)."""
    return clock.seoul_today()


def released() -> ColumnElement[bool]:
    """출시된 상품만 고르는 WHERE 조건."""
    return Product.released_on <= release_cutoff()


def is_released(product: Product) -> bool:
    """이미 읽은 상품이 출시됐는지(released() 와 같은 기준)."""
    return product.released_on <= release_cutoff()
