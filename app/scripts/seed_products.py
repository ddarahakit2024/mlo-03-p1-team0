"""상품 시드. products 가 비어 있을 때만 카탈로그(app/catalog/*.json) 상품 전체와 최근 90일 가격 이력을 넣는다.

실행: .\\.venv\\Scripts\\python.exe -m app.scripts.seed_products
운영 RDS 에는 사람이 실행한다. 이미 상품이 있으면 카탈로그를 읽지도 않고 아무것도 바꾸지 않는다(가격 이력도 넣지 않는다).
이미 상품이 있는 DB 에 카탈로그를 맞추는 것은 `python -m app.scripts.import_catalog`(미리보기 → --yes)다.
기준: docs/specs/2026-11-01-product-catalog.md "가져오기 도구"

- 상품: 카탈로그를 검증한 뒤(틀리면 아무것도 넣지 않고 종료 코드 2) 가져오기 도구와 같은 방법으로 넣는다.
  판매가·출시일·성능 지수·사진·attributes·benchmarks·판매처(naver·coupang) 가격 이력은 카탈로그에서, 재고는 이름에서 정해지는
  5~30, 진열 순서는 카탈로그 순서(cpu → cooler, 파일 안 순서)다.
- 가격 이력: 상품마다 최근 88일 동안 store 3~6개(마지막 = 현재 가격 = 카탈로그 가격, change_store_price 로 기록),
  상품 3개 중 1개는 coupang·naver 이력도 만든다. 무작위 없이 항상 같은 값이 나온다. 이 예시 외부 이력은 origin 이 없다
  (모의 시장도 실제 수집값도 아니다. 카탈로그의 판매처 가격은 가져오기와 같이 origin=collected).
  이력은 출시일보다 앞서지 않는다: 출시 뒤 88일이 안 된 상품은 store 이력을 출시일~오늘로 줄이고, 출시일 전의 외부 이력은 뺀다.
"""
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.catalog_schema import CATALOG_DIR, CatalogError
from app.core import clock
from app.core.pricing import record_external_price
from app.db.database import SessionLocal
from app.scripts.import_catalog import EXIT_INVALID, create_catalog_tables, insert_product, load_validated_catalog
from app.models import Product
from app.models.product_price_history import PRICE_SOURCE_COUPANG, PRICE_SOURCE_NAVER


# 판매가 변동 모양(이력 가격 ÷ 현재 가격, 오래된 순). 마지막은 항상 1.0(= 현재 가격).
STORE_PRICE_PATTERNS: tuple[tuple[float, ...], ...] = (
    (1.12, 1.07, 1.03, 1.0),             # 꾸준히 내림: 지금이 90일 최저가
    (1.05, 0.95, 0.97, 1.0),             # 할인 뒤 다시 오름: 90일 최저가가 현재가보다 낮다
    (1.0, 0.92, 1.0),                    # 잠깐 특가
    (0.94, 0.97, 1.0, 1.0, 1.0),         # 오름
    (1.1, 1.06, 1.04, 0.98, 1.02, 1.0),  # 오르내림
)
STORE_HISTORY_SPAN_DAYS = 88
# 외부 판매처 이력: (판매처, ((며칠 전, 현재 가격 대비 비율), ...)). 상품 3개 중 1개에만 만든다.
EXTERNAL_PRICE_POINTS = (
    (PRICE_SOURCE_COUPANG, ((60, 0.99), (30, 0.97), (5, 0.98))),
    (PRICE_SOURCE_NAVER, ((45, 1.01), (10, 0.99))),
)


def _round_price(price: float, unit: int) -> int:
    return max(unit, int(round(price / unit)) * unit)


def store_price_points(
    price_krw: int, pattern: tuple[float, ...], span_days: int = STORE_HISTORY_SPAN_DAYS,
) -> list[tuple[float, int]]:
    """(며칠 전, 가격) 목록, 오래된 순. span_days 일 전부터 오늘까지 고르게 나누고 마지막은 현재 가격.

    span_days 는 보통 88일이고, 출시 뒤 88일이 안 된 상품은 출시 뒤 지난 날수다(이력이 출시일보다 앞서지 않게).
    며칠 전은 소수일 수 있다. 오늘 출시한 상품(span_days 0)은 현재 가격 한 줄뿐이다.
    """
    if span_days <= 0:
        return [(0, price_krw)]
    last = len(pattern) - 1
    points = []
    for index, ratio in enumerate(pattern):
        days_ago = span_days * (last - index) / last
        price = price_krw if index == last else _round_price(price_krw * ratio, 1000)
        points.append((days_ago, price))
    return points


def history_span_days(released_on, today) -> int:
    """가격 이력을 만들 날수: 88일, 출시 뒤 그보다 짧으면 출시 뒤 지난 날수."""
    return max(0, min(STORE_HISTORY_SPAN_DAYS, (today - released_on).days))


def seed_products(db: Session, catalog_dir: Path = CATALOG_DIR) -> int:
    """products 가 비어 있으면 카탈로그 상품 전체와 가격 이력을 넣고 넣은 상품 개수를, 아니면 0 을 돌려준다.

    카탈로그가 틀리면 아무것도 넣지 않고 CatalogError 를 낸다.
    """
    if db.scalar(select(func.count()).select_from(Product)):
        return 0
    catalog = load_validated_catalog(catalog_dir)
    today = clock.seoul_today()
    now = clock.utc_now()
    for order, item in enumerate(catalog):
        price = item.price.krw
        span = history_span_days(item.released_on, today)
        pattern = STORE_PRICE_PATTERNS[order % len(STORE_PRICE_PATTERNS)]
        points = [(now - timedelta(days=days_ago), point) for days_ago, point in store_price_points(price, pattern, span)]
        product = insert_product(db, item, display_order=order + 1, store_points=points)
        if order % 3 == 0:
            for source, external_points in EXTERNAL_PRICE_POINTS:
                for days_ago, ratio in external_points:
                    if days_ago <= span:
                        record_external_price(
                            db, product.id, source, _round_price(price * ratio, 100),
                            recorded_at=now - timedelta(days=days_ago),
                        )
    db.commit()
    return len(catalog)


def main(session_factory=SessionLocal, catalog_dir: Path = CATALOG_DIR) -> int:
    # 앱을 한 번도 띄우지 않은 DB 에서도 실행되도록 시드가 쓰는 테이블만 없으면 만든다(기존 테이블은 건드리지 않는다).
    create_catalog_tables(session_factory.kw["bind"])
    with session_factory() as db:
        try:
            added = seed_products(db, catalog_dir)
        except CatalogError as error:
            db.rollback()
            print(f"카탈로그({catalog_dir})에 문제가 있어 상품을 넣지 않았습니다({len(error.problems)}개):", file=sys.stderr)
            for problem in error.problems:
                print(f"- {problem}", file=sys.stderr)
            raise SystemExit(EXIT_INVALID) from None
    if added:
        print(f"예시 상품 {added}개를 추가했습니다.")
    else:
        print("상품이 이미 있어 추가하지 않았습니다. (0개)")
    return added


if __name__ == "__main__":
    main()
