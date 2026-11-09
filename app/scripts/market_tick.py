"""시장 도구(로컬 시뮬레이션 전용): 재고 보충과, 가상 시계의 하루 단위로 모의 시장(쿠팡·네이버 가격)과 판매가를 따라잡는다.

실행: python -m app.scripts.market_tick [--seed 20261101] [--max-days 60] [--restock-below 5] [--restock-to 30]
Docker 의 market 서비스(profile sim)가 10분마다 실행한다(하루가 지나지 않았으면 재고 보충만 한다).
기준: docs/specs/2026-11-01-market-model.md "market_tick 변경"(처음 계약은 docs/specs/2026-10-30-persona-simulator.md)

- SIMULATION_ENV 가 "1" 이 아니면 DB 에 접속하지 않고 종료 코드 2(잘못된 인자도 argparse 가 2).
- 처음에 모든 상품 행을 id 순서로 잠근다(주문 확인과 같은 잠금 순서라 교착하지 않고, 같이 돈 market_tick 끼리도 줄을 선다).
- 재고 보충은 전과 같다: 출시된 상품 중 재고가 restock-below 미만이면 restock-to 로(조건부 UPDATE). 실행할 때마다 한다.
- 처리할 날짜: origin=simulated 인 마지막 이력의 서울 날짜 다음 날 ~ 가상 시계의 오늘(이력이 없으면 오늘 하루만). 오래된 날부터
  최대 max-days 일(남은 날은 다음 실행이 잇는다). 마지막 simulated 날짜와 그 이전은 다시 처리하지 않는다(같은 날 두 번 안 함).
- 날짜마다(recorded_at = 그 날짜 서울 12:00 = UTC 03:00. 그 날짜가 오늘이면 min(12:00, 지금 가상 시각)):
  - 그날까지 출시됐고 카탈로그 기준 가격(app/catalog 의 price.krw·collected_at, 이름이 같은 상품)이 있는 상품마다
    app.core.market_model 로 쿠팡·네이버 가격을 계산해 record_external_price(origin=simulated)로 기록한다. 품절이면 그 판매처는 건너뛴다.
  - 판매가 정책: 목표가(MarketModel.store_target)가 지금 판매가와 2% 넘게 다르고 마지막 store 이력에서 3일 이상 지났으면
    목표가(100원 단위)로 바꾼다. 첫 store 이력 가격의 70%~130% 를 넘지 않고, store 이력이 없는 상품은 바꾸지 않는다.
    판매가는 반드시 app.core.pricing.change_store_price 로 바꾼다(가격 이력이 남는다).
- 출시 전 상품(released_on > 가상 시계의 오늘)은 재고·판매가·외부 가격 모두 그대로다. 요약의 products 는 출시된 상품 수다.
- 시장 일정은 market_events 테이블(python -m app.scripts.import_market_events --yes 로 넣는다)에서 읽는다. 비어 있으면 행사·수요 없이
  계산하고 표준 오류에 알린다.
- 모델 값은 (시드, 상품 id, 판매처, 날짜)의 해시라 같은 시드·같은 DB 면 같은 결과이고, 하루씩 나눠 돌려도 한 번에 돌린 것과 같다.
- 끝나면 요약 JSON 한 줄(at, seed, products, events, days, through, external_records, store_changes, restocked)을 표준 출력에 쓴다.
  실패하면 아무것도 커밋하지 않는다.
"""
import argparse
import json
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, inspect, select, update
from sqlalchemy.orm import Session

from app.core.catalog_schema import CATALOG_DIR, CATEGORIES
from app.core import clock
from app.core.config import SIMULATION_ENV
from app.core.pricing import change_store_price, record_external_price
from app.core.product_release import is_released
from app.db.database import SessionLocal
from app.scripts.import_market_events import scheduled
from app.core.market_model import (
    DEFAULT_SEED, PRICE_UNIT_KRW, SOURCES, MarketModel, MarketProduct, round_to_unit,
)
from app.models import MarketEvent, Product, ProductPriceHistory
from app.models.product_price_history import PRICE_ORIGIN_SIMULATED, PRICE_SOURCE_STORE

EXIT_NOT_SIMULATION = 2
EXIT_SCHEMA = 1
NOT_SIMULATION_MESSAGE = "SIMULATION_ENV=1 이 아니라 시장 도구를 실행하지 않습니다(로컬 시뮬레이션 전용)."
NO_ORIGIN_MESSAGE = ("product_price_history.origin 컬럼이 없습니다. 먼저 python -m app.scripts.sync_columns 로 확인한 뒤 --yes 로 "
                     "더하세요(docs/specs/2026-11-01-market-model.md).")
NO_EVENTS_MESSAGE = ("market_events 가 비어 있어 행사·수요 없이 계산합니다. python -m app.scripts.import_market_events --yes 로 "
                     "일정을 넣으세요.")
STORE_BAND_PCT = (70, 130)  # 첫 store 이력 가격 대비
STORE_CHANGE_MIN_PCT = 2.0  # 목표가가 지금 판매가와 이만큼 넘게 달라야 바꾼다
STORE_CHANGE_MIN_DAYS = 3  # 마지막 store 이력에서 이만큼 지나야 바꾼다
RECORD_TIME = time(12, 0)  # 그 날짜 서울 12:00
MAX_STOCK = 100_000
MAX_DAYS = 3660
EXTERNAL_SOURCES = SOURCES


def price_band(base_krw: int, low_pct: int, high_pct: int) -> tuple[int, int] | None:
    """base 의 low_pct%~high_pct% 안에 드는 100원 단위 가격의 최소·최대. 그런 가격이 없으면 None."""
    unit = 100 * PRICE_UNIT_KRW
    low = max(-(-base_krw * low_pct // unit) * PRICE_UNIT_KRW, PRICE_UNIT_KRW)
    high = base_krw * high_pct // unit * PRICE_UNIT_KRW
    return (low, high) if low <= high else None


def _clamp(value: int, band: tuple[int, int]) -> int:
    return min(max(value, band[0]), band[1])


def recorded_at(day: date, now: datetime | None = None) -> datetime:
    """처리하는 날짜의 기록 시각(UTC): 그 날짜 서울 12:00(UTC 03:00).

    now(지금 가상 시각)를 주고 그 날짜가 now 의 서울 날짜(오늘)면 min(12:00, now) 다. 오늘 12:00 전에 돌아도 미래 시각을
    기록하지 않는다. 날짜는 그대로라 "같은 날 두 번 안 함"(서울 날짜 기준)도 그대로다.
    """
    noon = datetime.combine(day, RECORD_TIME, tzinfo=clock.SEOUL).astimezone(timezone.utc)
    if now is not None and now.astimezone(clock.SEOUL).date() == day:
        return min(noon, now)
    return noon


def _seoul_day(value: datetime) -> date:
    return clock.as_utc(value).astimezone(clock.SEOUL).date()


# ---------------------------------------------------------------- 기준 가격(카탈로그)

def load_references(directory: Path = CATALOG_DIR) -> dict[str, tuple[int, date]]:
    """카탈로그 상품 이름 → (실제 수집 가격, 수집일). 가격이 없는 상품은 빠진다.

    가져오기 도구가 전체를 검증하므로 여기서는 이름과 가격만 읽는다(10분마다 돌아 가볍게). 파일이 깨졌으면 예외로 멈춘다.
    """
    references: dict[str, tuple[int, date]] = {}
    for category in CATEGORIES:
        path = directory / f"{category}.json"
        if not path.is_file():
            continue
        for item in json.loads(path.read_text(encoding="utf-8")):
            price = item.get("price") if isinstance(item, dict) else None
            if price:
                references[item["name"]] = (int(price["krw"]), date.fromisoformat(price["collected_at"]))
    return references


def market_product(product: Product, reference: tuple[int, date] | None) -> MarketProduct:
    krw, collected_on = reference if reference else (None, None)
    return MarketProduct(
        id=product.id, category=product.category, brand=product.brand, released_on=product.released_on,
        performance_score=product.performance_score, reference_krw=krw, reference_on=collected_on,
    )


# ---------------------------------------------------------------- 날짜·이력 읽기

def last_simulated_day(db: Session) -> date | None:
    """origin=simulated 인 마지막 이력의 서울 날짜. 없으면 None."""
    # recorded_at 인덱스를 뒤에서부터 읽는다(origin 인덱스 없음). simulated 이력은 보통 가장 최근 행들이라 금방 찾는다.
    last = db.scalar(
        select(ProductPriceHistory.recorded_at)
        .where(ProductPriceHistory.origin == PRICE_ORIGIN_SIMULATED)
        .order_by(ProductPriceHistory.recorded_at.desc())
        .limit(1)
    )
    return None if last is None else _seoul_day(last)


def pending_days(db: Session, today: date, max_days: int) -> list[date]:
    """이번에 처리할 날짜(오래된 순, 최대 max_days 일): 마지막 simulated 날짜 다음 날 ~ 오늘, 이력이 없으면 오늘 하루.

    마지막 simulated 날짜와 그 이전은 다시 처리하지 않는다(같은 날 두 번 안 함). 시계를 뒤로 옮겨 오늘이 그날 이전이면 할 일이 없다.
    """
    last = last_simulated_day(db)
    if last is None:
        return [today][:max_days]
    first = last + timedelta(days=1)
    return [first + timedelta(days=offset) for offset in range(max(0, (today - first).days + 1))][:max_days]


def _first_store_prices(db: Session, product_ids: list[int]) -> dict[int, int]:
    """상품마다 첫 store 이력((recorded_at, id) 가 가장 이른 것)의 가격을 한 번의 쿼리로 읽는다. 이력이 없는 상품은 빠진다."""
    if not product_ids:
        return {}
    ranked = (
        select(
            ProductPriceHistory.product_id,
            ProductPriceHistory.price_krw,
            func.row_number().over(
                partition_by=ProductPriceHistory.product_id,
                order_by=(ProductPriceHistory.recorded_at, ProductPriceHistory.id),
            ).label("position"),
        )
        .where(ProductPriceHistory.product_id.in_(product_ids), ProductPriceHistory.source == PRICE_SOURCE_STORE)
        .subquery()
    )
    rows = db.execute(select(ranked.c.product_id, ranked.c.price_krw).where(ranked.c.position == 1)).all()
    return {product_id: price for product_id, price in rows}


def _last_store_days(db: Session, product_ids: list[int]) -> dict[int, date]:
    """상품마다 마지막 store 이력의 서울 날짜(한 번의 쿼리)."""
    if not product_ids:
        return {}
    rows = db.execute(
        select(ProductPriceHistory.product_id, func.max(ProductPriceHistory.recorded_at))
        .where(ProductPriceHistory.product_id.in_(product_ids), ProductPriceHistory.source == PRICE_SOURCE_STORE)
        .group_by(ProductPriceHistory.product_id)
    ).all()
    return {product_id: _seoul_day(value) for product_id, value in rows}


def _has_origin_column(db: Session) -> bool:
    columns = inspect(db.get_bind()).get_columns(ProductPriceHistory.__tablename__)
    return "origin" in {column["name"] for column in columns}


# ---------------------------------------------------------------- 실행

def _restock(db: Session, products: list[Product], options: argparse.Namespace) -> list[dict]:
    restocked = []
    for product in products:
        if product.stock >= options.restock_below:
            continue
        taken = db.execute(
            update(Product)
            .where(Product.id == product.id, Product.stock < options.restock_below)
            .values(stock=options.restock_to)
            .execution_options(synchronize_session=False)
        ).rowcount
        if taken == 1:
            restocked.append({"product_id": product.id, "from": product.stock, "to": options.restock_to})
    return restocked


def run_tick(db: Session, options: argparse.Namespace, references: dict[str, tuple[int, date]] | None = None) -> dict:
    """한 번 실행하고 바뀐 내용을 돌려준다. commit 은 부르는 쪽이 한다. references 를 주지 않으면 카탈로그에서 읽는다."""
    # 처음에 모든 상품 행을 id 순서로 잠근다. 주문 확인도 상품 id 순서로 재고 행을 잠그므로 서로 교착하지 않는다.
    # (잠그지 않으면 재고 보충 UPDATE 다음에 커밋 때의 가격 UPDATE·이력 INSERT 가 다시 앞 id 부터 잠가 순서가 뒤엉킨다.)
    # 잠근 뒤 읽은 재고·가격은 최신 값이라 보고하는 "from" 값도 정확하다. 같이 돈 market_tick 도 여기서 기다려 같은 날을 두 번 쓰지 않는다.
    products = list(db.scalars(select(Product).order_by(Product.id).with_for_update()))
    now = clock.utc_now()
    today = now.astimezone(clock.SEOUL).date()
    # 출시 전 상품은 시장에 아직 없다: 재고·가격·외부 가격을 건드리지 않는다(잠금은 위에서 함께 건다).
    released = [product for product in products if is_released(product)]
    restocked = _restock(db, released, options)

    events = [scheduled(row) for row in db.scalars(select(MarketEvent).order_by(MarketEvent.starts_on, MarketEvent.id))]
    days = pending_days(db, today, options.max_days)
    external_records = store_changes = 0
    if days:
        if not events:
            print(NO_EVENTS_MESSAGE, file=sys.stderr)
        references = load_references() if references is None else references
        # 후속 상품 판단에는 모든 상품을 쓰고(출시일로 나뉜다), 가격은 기준 가격이 있는 출시된 상품만 계산한다.
        model = MarketModel(
            [market_product(product, references.get(product.name)) for product in products], events, options.seed)
        priced = [product for product in released if product.name in references]
        ids = [product.id for product in priced]
        bands = {pid: price_band(base, *STORE_BAND_PCT) for pid, base in _first_store_prices(db, ids).items()}
        last_store_day = _last_store_days(db, ids)

        for day in days:
            at = recorded_at(day, now)
            for product in priced:
                if product.released_on > day:
                    continue
                for source in EXTERNAL_SOURCES:
                    price = model.price(product.id, source, day)
                    if price is not None:  # None = 그날 이 판매처 품절
                        record_external_price(db, product.id, source, price, recorded_at=at, origin=PRICE_ORIGIN_SIMULATED)
                        external_records += 1

                band = bands.get(product.id)
                target = model.store_target(product.id, day)
                last = last_store_day.get(product.id)
                if band is None or target is None or (last is not None and (day - last).days < STORE_CHANGE_MIN_DAYS):
                    continue
                current = product.price_krw
                if abs(target - current) <= current * STORE_CHANGE_MIN_PCT / 100:
                    continue
                new_price = _clamp(round_to_unit(target), band)
                if new_price != current:
                    change_store_price(db, product, new_price, recorded_at=at)
                    last_store_day[product.id] = day
                    store_changes += 1

    return {
        "products": len(released), "events": len(events), "days": len(days),
        "through": days[-1].isoformat() if days else None,
        "external_records": external_records, "store_changes": store_changes, "restocked": restocked,
    }


def _ranged(kind, low, high):
    def parse(text: str):
        try:
            value = kind(text)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{text!r} is not a number") from None
        if not low <= value <= high:  # NaN 도 여기서 걸린다
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}")
        return value
    return parse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.scripts.market_tick", description="로컬 시뮬레이션 시장 도구(한 번 실행)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help=f"시장 모델 시드(기본 {DEFAULT_SEED})")
    parser.add_argument("--max-days", type=_ranged(int, 1, MAX_DAYS), default=60, help="한 번에 따라잡는 최대 일수(기본 60)")
    parser.add_argument("--restock-below", type=_ranged(int, 0, MAX_STOCK), default=5)
    parser.add_argument("--restock-to", type=_ranged(int, 0, MAX_STOCK), default=30)
    return parser


def main(argv: list[str] | None = None, session_factory=SessionLocal) -> int:
    parser = build_parser()
    options = parser.parse_args(argv)
    if options.restock_to < options.restock_below:
        parser.error("--restock-to must be at least --restock-below")
    if SIMULATION_ENV != "1":
        print(NOT_SIMULATION_MESSAGE, file=sys.stderr)
        return EXIT_NOT_SIMULATION

    started_at = clock.utc_now()
    with session_factory() as db:
        if not _has_origin_column(db):
            print(NO_ORIGIN_MESSAGE, file=sys.stderr)
            return EXIT_SCHEMA
        try:
            summary = run_tick(db, options)
            db.commit()
        except Exception:
            db.rollback()
            raise
    # 데이터 원칙(docs/roadmap.md): UTC ISO 8601 ...Z
    at = started_at.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    print(json.dumps({"at": at, "seed": options.seed, **summary}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
