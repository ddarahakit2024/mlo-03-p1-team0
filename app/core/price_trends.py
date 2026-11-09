"""상품 가격 추세(ProductSummary.price_trend)와 판매처별 가격(상품 상세 store_prices).

- 계산은 순수 함수(price_trend, sparkline, pct_change, cheapest_external, store_prices)다. DB 를 읽지 않는다.
- DB 읽기(load_history_stats)는 상품마다 집계 SQL 로 "가장자리 값"만 읽는다(1년 최저·최고, 30일 전 가격, 외부 최신가 등).
  모든 이력 행을 파이썬으로 돌지 않는다. 행으로 읽는 것은 최근 30일 store 행(스파크라인)뿐이다.
- 집계 결과는 프로세스에 한 벌만 기억한다. 키 = (엔진, 서울 오늘, max(product_price_history.id), 행 수). 가격 이력이 한 줄이라도
  늘거나 날짜가 바뀌면 다시 읽는다. 현재 판매가(products.price_krw)는 기억하지 않고 부를 때마다 받는다.
- 지금(clock.utc_now()) 이후 기록은 세지 않는다(가상 시계). GET 에서 DB 에 쓰지 않는다.
"""
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from threading import Lock

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.product_metrics import round_half_up
from app.models import ProductPriceHistory
from app.models.product_price_history import PRICE_SOURCE_STORE, PRICE_SOURCES

YEAR_DAYS = 365
CHANGE_DAYS = 30
SPARKLINE_DAYS = 30
NEAR_LOWEST_RATIO = Decimal("1.01")  # 1년 최저가의 1% 이내면 is_lowest_1y
DROPPING_PCT = -1.0  # GET /products?dropping: change_30d_pct <= -1.0
NEAR_LOW_GAP_PCT = 3.0  # GET /products?near_low: lowest_gap_pct < 3.0
EXTERNAL_SOURCES = tuple(source for source in PRICE_SOURCES if source != PRICE_SOURCE_STORE)  # 보여 주는 순서


@dataclass(frozen=True)
class HistoryStats:
    """한 상품의 가격 이력 요약(현재 판매가와 무관한 값). 지금 기준으로 계산했다."""

    store_min_1y: int | None = None  # 최근 365일 store 최저가
    store_min_1y_on: date | None = None  # 그 가격을 마지막으로 기록한 서울 날짜
    store_max_1y: int | None = None
    change_base: int | None = None  # 30일 전 가격(P30). 없으면 365일 안의 가장 오래된 store 가격
    store_latest_at: datetime | None = None  # 가장 최근 store 기록 시각(UTC)
    sparkline_base: int | None = None  # 스파크라인 첫날 0시(서울) 전의 마지막 store 가격
    sparkline_days: Mapping[date, int] = field(default_factory=dict)  # 서울 날짜 → 그날 마지막 store 가격(30일 안)
    external: Mapping[str, tuple[int, datetime]] = field(default_factory=dict)  # 판매처 → (365일 안 최신가, 시각)


EMPTY_STATS = HistoryStats()


# ---------------------------------------------------------------- 순수 계산

def pct_change(value: int, base: int | None) -> float | None:
    """(value − base) ÷ base × 100, 소수 첫째 자리(0.5 올림). base 가 없거나 0 이하면 None."""
    if base is None or base <= 0:
        return None
    return round_half_up(Decimal(value - base) * 100 / Decimal(base), 1)


def sparkline_dates(today: date, days: int = SPARKLINE_DAYS) -> list[date]:
    """오늘로 끝나는 days 일(오래된 순)."""
    return [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def sparkline(
    days: list[date], base: int | None, day_prices: Mapping[date, int], price_krw: int,
) -> list[int]:
    """날마다 그날(까지) 마지막 store 가격. 첫 기록 전 날은 뺀다. 마지막 값은 현재 판매가. 이력이 없으면 [price_krw]."""
    values: list[int] = []
    last = base
    for day in days:
        last = day_prices.get(day, last)
        if last is not None:
            values.append(last)
    if not values:
        return [price_krw]
    values[-1] = price_krw
    return values


def cheapest_external(external: Mapping[str, tuple[int, datetime]]) -> dict | None:
    """판매처별 최신가 중 가장 싼 것 {source, price_krw}. 같으면 EXTERNAL_SOURCES 순서. 없으면 None."""
    best = None
    for source in EXTERNAL_SOURCES:
        if source in external:
            price = external[source][0]
            if best is None or price < best["price_krw"]:
                best = {"source": source, "price_krw": price}
    return best


def price_trend(price_krw: int, stats: HistoryStats, today: date) -> dict:
    """ProductSummary.price_trend. stats 는 지금 기준 이력 요약, today 는 서울 오늘."""
    lowest = price_krw if stats.store_min_1y is None else min(stats.store_min_1y, price_krw)
    highest = price_krw if stats.store_max_1y is None else max(stats.store_max_1y, price_krw)
    # 현재 판매가가 최저가면 오늘, 아니면 그 최저가를 마지막으로 기록한 날
    lowest_on = today if price_krw <= lowest else stats.store_min_1y_on
    line = sparkline(sparkline_dates(today), stats.sparkline_base, stats.sparkline_days, price_krw)
    external = cheapest_external(stats.external)
    return {
        "change_30d_pct": pct_change(price_krw, stats.change_base),
        "lowest_1y_krw": lowest,
        "lowest_1y_on": lowest_on,
        "highest_1y_krw": highest,
        "average_30d_krw": int(round_half_up(Decimal(sum(line)) / len(line), 0)),
        "is_lowest_1y": Decimal(price_krw) <= Decimal(lowest) * NEAR_LOWEST_RATIO,
        "lowest_gap_pct": pct_change(price_krw, lowest),
        "sparkline_30d": line,
        "external_lowest": external,
        "store_is_lowest": external is None or price_krw <= external["price_krw"],
        "store_gap_krw": None if external is None else abs(price_krw - external["price_krw"]),
    }


def is_dropping(trend: dict) -> bool:
    return trend["change_30d_pct"] is not None and trend["change_30d_pct"] <= DROPPING_PCT


def is_near_low(trend: dict) -> bool:
    return trend["lowest_gap_pct"] is not None and trend["lowest_gap_pct"] < NEAR_LOW_GAP_PCT


def drop_sort_key(product_id: int, trend: dict) -> tuple:
    """sort=drop_desc: 30일 변동률 오름차순(많이 내린 것 먼저), null 은 뒤, 같으면 id 오름차순."""
    change = trend["change_30d_pct"]
    return (change is None, change if change is not None else 0.0, product_id)


def store_prices(
    price_krw: int, store_latest_at: datetime | None, external: Mapping[str, tuple[int, datetime]],
) -> list[dict]:
    """상품 상세 store_prices: 우리 판매가 + 판매처별 최신가. 가격 오름차순, 같으면 store 먼저(그다음 EXTERNAL_SOURCES 순서)."""
    rows = [{"source": PRICE_SOURCE_STORE, "price_krw": price_krw, "recorded_at": store_latest_at}]
    rows += [
        {"source": source, "price_krw": external[source][0], "recorded_at": external[source][1]}
        for source in EXTERNAL_SOURCES if source in external
    ]
    order = {source: index for index, source in enumerate((PRICE_SOURCE_STORE, *EXTERNAL_SOURCES))}
    return sorted(rows, key=lambda row: (row["price_krw"], order[row["source"]]))


# ---------------------------------------------------------------- DB 읽기(집계)

def _seoul_day(value: datetime) -> date:
    return clock.as_utc(value).astimezone(clock.SEOUL).date()


def _seoul_midnight_utc(day: date) -> datetime:
    return datetime.combine(day, time(0), tzinfo=clock.SEOUL).astimezone(timezone.utc)


def load_history_stats(db: Session, now: datetime) -> dict[int, HistoryStats]:
    """모든 상품의 HistoryStats(이력이 없는 상품은 빠진다). 쿼리 5번, 행으로 읽는 것은 최근 30일 store 기록뿐이다."""
    history = ProductPriceHistory
    today = now.astimezone(clock.SEOUL).date()
    year_ago = now - timedelta(days=YEAR_DAYS)
    change_cutoff = now - timedelta(days=CHANGE_DAYS)
    window_start = _seoul_midnight_utc(sparkline_dates(today)[0])
    store_until_now = (history.source == PRICE_SOURCE_STORE, history.recorded_at <= now)
    in_year = history.recorded_at >= year_ago

    # 1) 상품마다 store 가장자리 값 한 줄
    edges = (
        select(
            history.product_id.label("product_id"),
            func.min(case((in_year, history.price_krw))).label("min_1y"),
            func.max(case((in_year, history.price_krw))).label("max_1y"),
            func.min(case((in_year, history.recorded_at))).label("oldest_1y_at"),
            func.max(case((history.recorded_at <= change_cutoff, history.recorded_at))).label("change_at"),
            func.max(case((history.recorded_at < window_start, history.recorded_at))).label("base_at"),
            func.max(history.recorded_at).label("latest_at"),
        )
        .where(*store_until_now)
        .group_by(history.product_id)
        .subquery()
    )
    edge_rows = {row.product_id: row for row in db.execute(select(edges))}

    # 2) 가장자리 시각의 가격(같은 시각이 여럿이면: 30일 전·첫날 전 가격은 마지막 id, 가장 오래된 가격은 첫 id)
    change_price: dict[int, tuple[int, int]] = {}
    oldest_price: dict[int, tuple[int, int]] = {}
    base_price: dict[int, tuple[int, int]] = {}
    at_edges = db.execute(
        select(
            history.product_id, history.id, history.price_krw, history.recorded_at,
            edges.c.change_at, edges.c.oldest_1y_at, edges.c.base_at,
        )
        .join(edges, edges.c.product_id == history.product_id)
        .where(*store_until_now, or_(
            history.recorded_at == edges.c.change_at,
            history.recorded_at == edges.c.oldest_1y_at,
            history.recorded_at == edges.c.base_at,
        ))
    )
    for product_id, row_id, price, recorded_at, change_at, oldest_at, base_at in at_edges:
        if recorded_at == change_at and row_id > change_price.get(product_id, (-1, 0))[0]:
            change_price[product_id] = (row_id, price)
        if recorded_at == oldest_at and row_id < oldest_price.get(product_id, (row_id + 1, 0))[0]:
            oldest_price[product_id] = (row_id, price)
        if recorded_at == base_at and row_id > base_price.get(product_id, (-1, 0))[0]:
            base_price[product_id] = (row_id, price)

    # 3) 1년 최저가를 마지막으로 기록한 시각
    lowest_at = dict(db.execute(
        select(history.product_id, func.max(history.recorded_at))
        .join(edges, edges.c.product_id == history.product_id)
        .where(*store_until_now, in_year, history.price_krw == edges.c.min_1y)
        .group_by(history.product_id)
    ).all())

    # 4) 스파크라인 기간(30일)의 store 기록: 서울 날짜마다 마지막 가격
    day_prices: dict[int, dict[date, int]] = {}
    recent = db.execute(
        select(history.product_id, history.price_krw, history.recorded_at)
        .where(*store_until_now, history.recorded_at >= window_start)
        .order_by(history.product_id, history.recorded_at, history.id)
    )
    for product_id, price, recorded_at in recent:
        day_prices.setdefault(product_id, {})[_seoul_day(recorded_at)] = price

    # 5) 외부 판매처마다 365일 안의 최신가(같은 시각이 여럿이면 마지막 id)
    latest_external = (
        select(
            history.product_id.label("product_id"), history.source.label("source"),
            func.max(history.recorded_at).label("latest_at"),
        )
        .where(history.source.in_(EXTERNAL_SOURCES), in_year, history.recorded_at <= now)
        .group_by(history.product_id, history.source)
        .subquery()
    )
    external: dict[int, dict[str, tuple[int, int, datetime]]] = {}
    external_rows = db.execute(
        select(history.product_id, history.source, history.id, history.price_krw, history.recorded_at)
        .join(latest_external, and_(
            latest_external.c.product_id == history.product_id,
            latest_external.c.source == history.source,
            latest_external.c.latest_at == history.recorded_at,
        ))
    )
    for product_id, source, row_id, price, recorded_at in external_rows:
        current = external.setdefault(product_id, {}).get(source)
        if current is None or row_id > current[0]:
            external[product_id][source] = (row_id, price, clock.as_utc(recorded_at))

    stats: dict[int, HistoryStats] = {}
    for product_id in set(edge_rows) | set(external):
        edge = edge_rows.get(product_id)
        change = change_price.get(product_id) or oldest_price.get(product_id)
        stats[product_id] = HistoryStats(
            store_min_1y=edge.min_1y if edge else None,
            store_min_1y_on=_seoul_day(lowest_at[product_id]) if product_id in lowest_at else None,
            store_max_1y=edge.max_1y if edge else None,
            change_base=change[1] if change else None,
            store_latest_at=clock.as_utc(edge.latest_at) if edge else None,
            sparkline_base=base_price[product_id][1] if product_id in base_price else None,
            sparkline_days=day_prices.get(product_id, {}),
            external={source: (price, at) for source, (_id, price, at) in external.get(product_id, {}).items()},
        )
    return stats


# ---------------------------------------------------------------- 프로세스 캐시

_cache_lock = Lock()
_cache: tuple[object, tuple, dict[int, HistoryStats]] | None = None  # (엔진, 키, 값) 한 벌


def history_stats(db: Session) -> dict[int, HistoryStats]:
    """모든 상품의 HistoryStats. 키(엔진, 서울 오늘, 이력 max(id), 행 수)가 같으면 기억해 둔 값을 쓴다."""
    global _cache
    engine = db.get_bind()
    now = clock.utc_now()
    max_id, count = db.execute(select(func.max(ProductPriceHistory.id), func.count(ProductPriceHistory.id))).one()
    key = (now.astimezone(clock.SEOUL).date(), max_id, count)
    cached = _cache
    if cached is not None and cached[0] is engine and cached[1] == key:
        return cached[2]
    stats = load_history_stats(db, now)
    with _cache_lock:
        _cache = (engine, key, stats)
    return stats


def clear_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def trends_for(db: Session, products: Iterable[tuple[int, int]]) -> dict[int, dict]:
    """(상품 id, 현재 판매가) 들의 price_trend. 이력 요약은 history_stats 를 쓴다."""
    stats = history_stats(db)
    today = clock.seoul_today()
    return {
        product_id: price_trend(price_krw, stats.get(product_id, EMPTY_STATS), today)
        for product_id, price_krw in products
    }


def product_store_prices(db: Session, product_id: int, price_krw: int) -> list[dict]:
    """상품 상세 store_prices."""
    stats = history_stats(db).get(product_id, EMPTY_STATS)
    return store_prices(price_krw, stats.store_latest_at, stats.external)
