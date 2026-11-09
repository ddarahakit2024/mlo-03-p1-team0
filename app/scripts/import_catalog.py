"""카탈로그(app/catalog/<category>.json)를 DB 상품에 맞춘다. docs/specs/2026-11-01-product-catalog.md "가져오기 도구"

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_catalog          # 미리보기: 새 상품, 바뀔 필드, 가격 차이, 카탈로그에 없는 상품
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_catalog --yes    # 실행
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_catalog --catalog-dir <폴더>   # 다른 카탈로그 폴더(기본 app/catalog)
    docker compose exec backend python -m app.scripts.import_catalog [--yes]       # 로컬 Docker

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- 검증이 먼저다. 카탈로그 전체(load_catalog, 오늘 = 실제 Asia/Seoul 날짜, 가격·개수까지. 가상 시계를 과거로 옮겨도 그 뒤 출시한 상품을 넣을 수 있다)와 DB 와 맞출 때의 문제
  (이름이 같은 DB 상품이 여럿, 이름은 같은데 카테고리가 다름, 카탈로그에 없는 상품이 이미 쓰는 model_code)를 모두 모아,
  하나라도 있으면 아무것도 바꾸지 않고 종료 코드 2.
- 기존 상품(이름이 글자 그대로 같음): 카탈로그가 관리하는 값(MANAGED_FIELDS)과 attributes·benchmarks 를 맞춘다.
  price_krw·stock 은 바꾸지 않고, 판매가와 카탈로그 가격이 다르면 차이만 출력한다. 카탈로그에서 빠진 벤치마크는 지운다.
- 새 상품: 카탈로그 가격으로 넣고 change_store_price 로 store 이력 한 줄을 남긴다. 판매처 가격은 record_external_price 로
  naver·coupang 이력을 남긴다(시각은 collected_at 날짜의 0시 Asia/Seoul, origin=collected: 실제 수집값.
  docs/specs/2026-11-01-market-model.md). 재고는 이름에서 정해지는 5~30, 진열 순서는 기존 상품 뒤.
- 카탈로그에 없는 기존 상품은 지우지 않고 목록만 출력한다.
- 바꿀 것이 없으면 "바꿀 것이 없습니다."(같은 카탈로그로 두 번째 실행). 종료 코드: 0 성공(미리보기 포함), 2 카탈로그·DB 문제
  (인자가 틀려도 argparse 의 2).
- 실행(--yes)은 상품 행을 모두 id 순서로 잠그는 읽기부터 한다. 시장 도구·주문 확인과 같은 잠금 순서라 교착하지 않고,
  스냅샷을 열기 전에 잠그므로 MariaDB 1020(스냅샷 충돌)도 나지 않는다. 실패하면 아무것도 커밋하지 않는다.
- 앱을 아직 새 버전으로 띄우지 않은 DB 에서도 되도록 --yes 는 이 도구가 쓰는 테이블(CATALOG_TABLES)이 없으면 만든다.
  미리보기는 만들지 않고 없는 테이블을 비어 있는 것으로 본다.
"""
from __future__ import annotations

import argparse
import sys
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from pathlib import Path

from sqlalchemy import Engine, inspect, select
from sqlalchemy.orm import Session

from app.core.catalog_schema import CATALOG_DIR, CatalogError, CatalogProduct, load_catalog, performance_score
from app.core import clock
from app.core.pricing import change_store_price, record_external_price
from app.db.database import script_engine
from app.models import Notification, PriceAlert, Product, ProductAttributes, ProductBenchmark, ProductPriceHistory
from app.models.product_price_history import PRICE_ORIGIN_COLLECTED

EXIT_INVALID = 2
NOTHING_TO_DO = "바꿀 것이 없습니다."
# 카탈로그가 관리하는 products 컬럼. price_krw·stock 은 처음 넣을 때만 카탈로그 값을 쓴다.
MANAGED_FIELDS = ("brand", "summary", "description", "specs", "released_on", "performance_score", "thumbnail_url")
ATTRIBUTE_FIELDS = ("model_code", "series", "attributes")
STOCK_MIN, STOCK_MAX = 5, 30
# 판매가를 바꾸는 change_store_price 가 목표가 알림(price_alerts)을 읽고 알림(notifications)을 쓰므로 함께 만든다.
CATALOG_TABLES = (
    Product.__table__, ProductPriceHistory.__table__, ProductAttributes.__table__, ProductBenchmark.__table__,
    PriceAlert.__table__, Notification.__table__,
)


# ---------------------------------------------------------------- 카탈로그 → DB 값

def load_validated_catalog(directory: Path = CATALOG_DIR) -> list[CatalogProduct]:
    """카탈로그 전체를 검증해 카테고리 순서(cpu → cooler)·파일 안 순서대로 돌려준다. 하나라도 틀리면 CatalogError."""
    # 출시일 검사는 "현실에 아직 없는 상품"을 막는 것이라 실제 날짜로 한다. 가상 시계가 과거여도 그 뒤 출시 상품은 들어가고,
    # 출시 전에는 화면·주문에서 숨는다(app/core/product_release.py)
    catalog = load_catalog(directory, today=clock.real_seoul_today(), require_complete=True)
    return [item for items in catalog.values() for item in items]


def create_catalog_tables(bind) -> None:
    """이 도구와 시드가 쓰는 테이블 중 없는 것만 만든다(기존 테이블은 건드리지 않는다)."""
    for table in CATALOG_TABLES:
        table.create(bind=bind, checkfirst=True)


def initial_stock(name: str) -> int:
    """새 상품의 처음 재고. 이름에서 정해지는 5~30 사이 고정값(실행할 때마다, PC 마다 같다)."""
    return STOCK_MIN + zlib.crc32(name.encode("utf-8")) % (STOCK_MAX - STOCK_MIN + 1)


def collected_at(day: date) -> datetime:
    """판매처 가격을 모은 날 → 이력 시각(그날 0시 Asia/Seoul 을 UTC 로)."""
    return datetime.combine(day, time(0), tzinfo=clock.SEOUL).astimezone(timezone.utc)


def managed_values(item: CatalogProduct) -> dict:
    return {
        "brand": item.brand, "summary": item.summary, "description": item.description,
        "specs": [line.model_dump() for line in item.specs], "released_on": item.released_on,
        "performance_score": performance_score(item), "thumbnail_url": item.thumbnail_url,
    }


def attribute_values(item: CatalogProduct) -> dict:
    return {"model_code": item.model_code, "series": item.series, "attributes": item.attributes}


def benchmark_values(item: CatalogProduct) -> dict[str, tuple[float, str]]:
    return {benchmark.name: (benchmark.score, benchmark.source_url) for benchmark in item.benchmarks}


def insert_product(
    db: Session, item: CatalogProduct, display_order: int,
    store_points: list[tuple[datetime, int]] | None = None,
) -> Product:
    """새 상품 하나와 그 attributes·benchmarks·가격 이력을 넣는다. commit 은 부르는 쪽이 한다.

    store_points: store 이력 (시각, 가격) 오래된 순. 마지막 가격이 판매가가 된다(시드가 과거 이력을 채울 때 준다).
    주지 않으면 (지금, 카탈로그 가격) 한 줄이다.
    """
    points = store_points or [(clock.utc_now(), item.price.krw)]
    product = Product(
        name=item.name, category=item.category, price_krw=points[-1][1], stock=initial_stock(item.name),
        display_order=display_order, **managed_values(item),
    )
    for recorded_at, price in points:  # 첫 호출이 상품을 넣고(flush) id 를 받는다
        change_store_price(db, product, price, recorded_at=recorded_at)
    db.add(ProductAttributes(product_id=product.id, **attribute_values(item)))
    for name, (score, source_url) in benchmark_values(item).items():
        db.add(ProductBenchmark(product_id=product.id, name=name, score=score, source_url=source_url))
    at = collected_at(item.price.collected_at)
    for source in item.price.sources:  # 사람 브라우저로 모은 실제 판매처 가격(1-1)
        record_external_price(db, product.id, source.site, source.krw, recorded_at=at, origin=PRICE_ORIGIN_COLLECTED)
    return product


# ---------------------------------------------------------------- 계획

@dataclass
class Update:
    product: Product
    item: CatalogProduct
    fields: list[str]  # 바뀌는 것: MANAGED_FIELDS·ATTRIBUTE_FIELDS 의 이름, "benchmarks"


@dataclass
class Plan:
    catalog: list[CatalogProduct]
    inserts: list[CatalogProduct] = field(default_factory=list)
    updates: list[Update] = field(default_factory=list)
    price_gaps: list[tuple[Product, int]] = field(default_factory=list)  # (기존 상품, 카탈로그 가격)
    missing: list[Product] = field(default_factory=list)  # 카탈로그에 없는 기존 상품
    problems: list[str] = field(default_factory=list)
    attributes: dict[int, ProductAttributes] = field(default_factory=dict)
    benchmarks: dict[int, dict[str, ProductBenchmark]] = field(default_factory=dict)
    max_display_order: int = 0

    @property
    def has_changes(self) -> bool:
        return bool(self.inserts or self.updates)


def changed_fields(
    product: Product, item: CatalogProduct, attributes: ProductAttributes | None,
    benchmarks: dict[str, ProductBenchmark],
) -> list[str]:
    wanted = managed_values(item)
    fields = [name for name in MANAGED_FIELDS if getattr(product, name) != wanted[name]]
    wanted_attributes = attribute_values(item)
    fields += [
        name for name in ATTRIBUTE_FIELDS
        if attributes is None or getattr(attributes, name) != wanted_attributes[name]
    ]
    if {name: (row.score, row.source_url) for name, row in benchmarks.items()} != benchmark_values(item):
        fields.append("benchmarks")
    return fields


def make_plan(db: Session, catalog: list[CatalogProduct], tables: set[str], *, lock: bool = False) -> Plan:
    """DB 와 카탈로그를 비교한다. lock=True 면 상품 행을 모두 id 순서로 잠근다(--yes). 바꾸지는 않는다."""
    plan = Plan(catalog)
    products: list[Product] = []
    if Product.__tablename__ in tables:
        query = select(Product).order_by(Product.id)
        products = list(db.scalars(query.with_for_update() if lock else query))
    if ProductAttributes.__tablename__ in tables:
        plan.attributes = {row.product_id: row for row in db.scalars(select(ProductAttributes))}
    if ProductBenchmark.__tablename__ in tables:
        for row in db.scalars(select(ProductBenchmark).order_by(ProductBenchmark.id)):
            plan.benchmarks.setdefault(row.product_id, {})[row.name] = row
    plan.max_display_order = max((product.display_order for product in products), default=0)

    # 이름 비교는 파이썬에서 글자 그대로 한다(MariaDB 의 대소문자·끝 공백 무시 비교에 기대지 않는다).
    by_name: dict[str, list[Product]] = {}
    for product in products:
        by_name.setdefault(product.name, []).append(product)
    matched: set[int] = set()
    for item in catalog:
        same = by_name.get(item.name, [])
        if not same:
            plan.inserts.append(item)
            continue
        if len(same) > 1:
            ids = ", ".join(str(product.id) for product in same)
            plan.problems.append(f"{item.name}: 이름이 같은 DB 상품이 {len(same)}개입니다(id {ids}). 하나로 정리한 뒤 다시 실행하세요.")
            continue
        product = same[0]
        if product.category != item.category:
            plan.problems.append(
                f"{item.name}: DB 상품(id {product.id})의 카테고리 {product.category} 와 카탈로그의 {item.category} 가 다릅니다."
            )
            continue
        matched.add(product.id)
        fields = changed_fields(product, item, plan.attributes.get(product.id), plan.benchmarks.get(product.id, {}))
        if fields:
            plan.updates.append(Update(product, item, fields))
        if product.price_krw != item.price.krw:
            plan.price_gaps.append((product, item.price.krw))

    names = {item.name for item in catalog}
    plan.missing = [product for product in products if product.name not in names]
    # model_code 는 UNIQUE 다. 카탈로그 상품끼리 바꿔 쓰는 것은 apply 가 풀지만, 카탈로그에 없는 상품이 쓰는 값은 풀 수 없다.
    owners = {row.model_code: product_id for product_id, row in plan.attributes.items()}
    for item in catalog:
        owner = owners.get(item.model_code)
        if owner is not None and owner not in matched:
            plan.problems.append(f"{item.name}: model_code {item.model_code!r} 를 카탈로그와 맞지 않는 상품(id {owner})이 씁니다.")
    return plan


# ---------------------------------------------------------------- 실행

def _sync_existing(db: Session, update: Update, attributes: ProductAttributes | None,
                   benchmarks: dict[str, ProductBenchmark]) -> None:
    product, item = update.product, update.item
    for name, value in managed_values(item).items():
        if getattr(product, name) != value:
            setattr(product, name, value)
    wanted = attribute_values(item)
    if attributes is None:
        db.add(ProductAttributes(product_id=product.id, **wanted))
    else:
        for name, value in wanted.items():
            if getattr(attributes, name) != value:
                setattr(attributes, name, value)
    wanted_benchmarks = benchmark_values(item)
    for name, row in benchmarks.items():
        if name not in wanted_benchmarks:
            db.delete(row)
    for name, (score, source_url) in wanted_benchmarks.items():
        row = benchmarks.get(name)
        if row is None:
            db.add(ProductBenchmark(product_id=product.id, name=name, score=score, source_url=source_url))
        elif (row.score, row.source_url) != (score, source_url):
            row.score, row.source_url = score, source_url


def apply(db: Session, plan: Plan) -> None:
    """계획대로 바꾼다. commit 은 부르는 쪽이 한다."""
    # model_code 가 바뀌는 attributes 행은 먼저 지운다(flush). 두 상품이 model_code 를 맞바꾸거나, 새 상품이 기존 상품이
    # 내놓는 model_code 를 받아도 UNIQUE 에 걸리지 않게 한다. 한 번의 flush 안에서는 DELETE 가 INSERT 보다 늦기 때문이다.
    replaced = [
        update.product.id for update in plan.updates
        if update.product.id in plan.attributes
        and plan.attributes[update.product.id].model_code != update.item.model_code
    ]
    for product_id in replaced:
        db.delete(plan.attributes.pop(product_id))
    if replaced:
        db.flush()
    for update in plan.updates:
        product_id = update.product.id
        _sync_existing(db, update, plan.attributes.get(product_id), plan.benchmarks.get(product_id, {}))
    for offset, item in enumerate(plan.inserts, start=1):
        insert_product(db, item, display_order=plan.max_display_order + offset)


# ---------------------------------------------------------------- 출력

def _won(value: int) -> str:
    return f"{value:,}원"


def _report_problems(out, title: str, problems: list[str]) -> int:
    out(f"{title}({len(problems)}개). 아무것도 바꾸지 않았습니다:")
    for problem in problems:
        out(f"- {problem}")
    return EXIT_INVALID


def _print_plan(out, plan: Plan) -> None:
    counts: dict[str, int] = {}
    for item in plan.catalog:
        counts[item.category] = counts.get(item.category, 0) + 1
    out(f"카탈로그 확인: 상품 {len(plan.catalog)}개 ({', '.join(f'{name} {count}' for name, count in counts.items())})")
    for item in plan.inserts:
        out(f"+ [{item.category}] {item.name}: 판매가 {_won(item.price.krw)}, 재고 {initial_stock(item.name)}")
    for update in plan.updates:
        out(f"~ {update.product.id} {update.product.name}: {', '.join(update.fields)}")
    for product, catalog_price in plan.price_gaps:
        out(f"= {product.id} {product.name}: 판매가 {_won(product.price_krw)}, 카탈로그 {_won(catalog_price)}"
            f"(차이 {catalog_price - product.price_krw:+,}원). 판매가는 바꾸지 않습니다.")
    for product in plan.missing:
        out(f"? {product.id} {product.name}: 카탈로그에 없습니다. 지우지 않습니다.")


def run(engine: Engine, yes: bool = False, catalog_dir: Path = CATALOG_DIR, out=print) -> int:
    """종료 코드: 0 성공(미리보기 포함), 2 카탈로그·DB 문제(아무것도 바꾸지 않음)."""
    try:
        catalog = load_validated_catalog(catalog_dir)
    except CatalogError as error:
        return _report_problems(out, f"카탈로그({catalog_dir})에 문제가 있습니다", error.problems)
    if yes:
        create_catalog_tables(engine)
    tables = set(inspect(engine).get_table_names())
    for table in CATALOG_TABLES:
        if table.name not in tables:
            out(f"- {table.name}: 테이블 없음(--yes 로 실행할 때 만듭니다)")

    with Session(engine) as db:
        plan = make_plan(db, catalog, tables, lock=yes)
        if plan.problems:
            db.rollback()  # 잠금을 바로 푼다
            return _report_problems(out, "DB 상품과 카탈로그를 맞출 수 없습니다", plan.problems)
        _print_plan(out, plan)
        if not plan.has_changes:
            out(NOTHING_TO_DO)
            return 0
        if not yes:
            out(f"미리보기입니다(새 상품 {len(plan.inserts)}개, 바뀔 상품 {len(plan.updates)}개). "
                "아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요.")
            return 0
        try:
            apply(db, plan)
            db.commit()
        except Exception:
            db.rollback()
            raise
    out(f"새 상품 {len(plan.inserts)}개를 넣고 기존 상품 {len(plan.updates)}개를 맞췄습니다.")
    return 0


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.import_catalog",
        description="상품 카탈로그(app/catalog/*.json)를 DB 상품에 맞춥니다. 인자 없이 실행하면 미리보기만 합니다.",
    )
    parser.add_argument("--yes", action="store_true", help="실제로 상품을 넣고 바꾼다")
    parser.add_argument("--catalog-dir", type=Path, default=CATALOG_DIR, help="카탈로그 폴더(기본 app/catalog)")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, yes=args.yes, catalog_dir=args.catalog_dir, out=out)


if __name__ == "__main__":
    sys.exit(main())
