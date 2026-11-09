"""모의 시장 가격 모델(순수 함수, DB·파일·시계 없음). docs/specs/2026-11-01-market-model.md "시장 모델"

판매처 s(coupang, naver)의 상품 p 가격, 날짜 d(서울 날짜):

    price(p, s, d) = 100원 반올림( anchor × age × successor × cycle × event × flash × seller × noise )

- anchor: 상품의 실제 수집 가격(카탈로그 price.krw)을 그 수집일의 age·successor·cycle 로 나눈 값. 그래서 수집일의 모델 가격이
  실제 가격 근처가 된다(그날 event 는 1 이어야 한다. app/market_events.json 의 일정은 2026-11-01 에 행사가 없다).
- age: 출시 뒤 경과 개월 m 에 따라 max(floor, (1 - r) ^ m). r·floor 는 카테고리별 AGE_DECAY.
- successor: 같은 카테고리·같은 브랜드에서 성능 점수가 이 상품의 90%~130% 이고 더 늦게 출시된 상품이 나오면 그 출시일부터
  14일에 걸쳐 SUCCESSOR_DROP_PCT 안의 값(상품마다 고정)만큼 내려간다. 후속이 여럿이면 곱하지 않고 가장 큰 것 하나.
- cycle: market_events 의 demand 일정이 그 카테고리에 시작일부터 가운데 날까지 선형으로 오르고 끝날 때까지 내려오는 배율.
  최고 상승률은 일정의 min_pct~max_pct 안에서 카테고리마다 고정.
- event: 할인 행사(sale) 기간에 판매처·카테고리가 맞으면 할인율(일정의 범위 안에서 상품·판매처·행사마다 고정)만큼 내려간다.
  겹치면 가장 큰 할인 하나. 행사 3일 전부터는 PRE_RAISE_PROB(상품마다 고정)의 상품이 1~2% 오른다. launch 는 가격 영향 없음.
- flash: 일정과 관계없는 반짝 할인(상품·판매처마다). 하루마다 1/FLASH_INTERVAL_DAYS 확률로 시작하고(행사와 겹쳐도 된다),
  FLASH_PCT 할인이 FLASH_DAYS 일 이어진다. 시작 전 오름은 없다. 한 판매처에 반짝 할인이 시작되면 다른 판매처가
  FLASH_FOLLOW_PROB 확률로 1~3일 뒤 그 할인의 절반~전부를 같은 일수만큼 따라 한다. 겹치면 가장 큰 할인 하나.
  기준일(카탈로그 수집일)에 걸리는 반짝 할인은 없다(그날 모델 가격이 실제 가격 근처가 되게).
- seller: 판매처 차이(상품·판매처마다 고정). noise: 하루 ±NOISE_PCT%. 품절(판매처·날짜마다 SOLD_OUT_PROB)이면 가격 없음.
- 출시 전(released_on > d)이거나 기준 가격이 없는 상품은 가격이 없다(None).

난수는 unit(시드, 상품 id, 판매처, 날짜, 요소 이름)의 해시라 계산 순서·실행 횟수와 관계없이 같은 입력이면 같은 값이다.
판매가(store) 목표가와 "14일 안 5% 이상 하락" 라벨도 여기서 계산한다(정책 적용은 app/scripts/market_tick.py).
판매가 목표가에는 행사 할인율의 절반만 들어가고 반짝 할인(flash)은 들어가지 않는다.
"""
from __future__ import annotations

import hashlib
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta

SOURCE_COUPANG = "coupang"
SOURCE_NAVER = "naver"
SOURCES = (SOURCE_COUPANG, SOURCE_NAVER)
STORE = "store"

EVENT_SALE, EVENT_LAUNCH, EVENT_DEMAND = "sale", "launch", "demand"
EVENT_KINDS = (EVENT_SALE, EVENT_LAUNCH, EVENT_DEMAND)

DEFAULT_SEED = 20261101
REFERENCE_ON = date(2026, 11, 1)  # 카탈로그 가격을 모은 날(기준 가격에 수집일이 없을 때)
PRICE_UNIT_KRW = 100
DAYS_PER_MONTH = 365.25 / 12

# 카테고리 → (월 하락률 r, 하한 floor)
AGE_DECAY: dict[str, tuple[float, float]] = {
    "gpu": (0.016, 0.55),
    "cpu": (0.013, 0.55),
    "mainboard": (0.010, 0.60),
    "memory": (0.008, 0.60),
    "storage": (0.008, 0.60),
    "psu": (0.004, 0.75),
    "case": (0.004, 0.75),
    "cooler": (0.004, 0.75),
}
DEFAULT_AGE_DECAY = (0.008, 0.60)  # 카탈로그 밖 카테고리(예전 DB)
SUCCESSOR_SCORE_RATIO = (0.9, 1.3)  # 후속 상품의 성능 점수 ÷ 이 상품의 성능 점수
SUCCESSOR_DROP_PCT = (5.0, 12.0)
SUCCESSOR_RAMP_DAYS = 14
SELLER_OFFSET_PCT = {SOURCE_COUPANG: (-3.0, 2.0), SOURCE_NAVER: (-4.0, 1.0)}
NOISE_PCT = 0.8
SOLD_OUT_PROB = 0.02
PRE_RAISE_PROB = 0.3
PRE_RAISE_PCT = (1.0, 2.0)
PRE_RAISE_DAYS = 3
# 반짝 할인(flash): 상품·판매처마다 평균 FLASH_INTERVAL_DAYS 일에 한 번 시작
FLASH_INTERVAL_DAYS = 240
FLASH_PCT = (5.0, 15.0)
FLASH_DAYS = (3, 10)
FLASH_FOLLOW_PROB = 0.4  # 다른 판매처가 따라 할 확률
FLASH_FOLLOW_DELAY_DAYS = (1, 3)
FLASH_FOLLOW_SHARE = (0.5, 1.0)  # 따라 하는 할인 ÷ 먼저 한 할인
# 판매가(store) 정책: 목표가 = 외부 두 가격 평균 × 상품별 배율. 행사 중에는 행사 할인율의 절반을 반영한다
STORE_RATIO = (1.00, 1.05)
STORE_SALE_SHARE = 0.5
# 4-2 라벨: 14일 안에 오늘 가격보다 5% 이상 낮은 날이 있으면 양성
LABEL_HORIZON_DAYS = 14
LABEL_DROP_PCT = 5.0


# ---------------------------------------------------------------- 난수·반올림

def unit(seed: int, product: object, source: str, day: object, factor: str) -> float:
    """[0, 1) 의 결정적 난수 = hash(시드, 상품 id, 판매처, 날짜, 요소 이름). 쓰지 않는 자리는 빈 문자열."""
    key = f"{seed}|{product}|{source}|{day}|{factor}".encode("utf-8")
    return int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), "big") / 2.0**64


def between(low: float, high: float, fraction: float) -> float:
    return low + (high - low) * fraction


def round_to_unit(value: float) -> int:
    """가장 가까운 100원 단위(반올림)."""
    return math.floor(value / PRICE_UNIT_KRW + 0.5) * PRICE_UNIT_KRW


# ---------------------------------------------------------------- 입력

@dataclass(frozen=True)
class ScheduledEvent:
    """market_events 한 줄(DB 와 일정 파일에서 같은 모양으로 만든다)."""

    code: str
    kind: str
    starts_on: date
    ends_on: date
    categories: tuple[str, ...] = ()  # 빈 값 = 모든 카테고리
    sources: tuple[str, ...] = ()  # 빈 값 = 모든 판매처
    min_pct: float = 0.0
    max_pct: float = 0.0

    def active(self, day: date) -> bool:
        return self.starts_on <= day <= self.ends_on

    def covers_category(self, category: str) -> bool:
        return not self.categories or category in self.categories

    def covers_source(self, source: str) -> bool:
        return not self.sources or source in self.sources


@dataclass(frozen=True)
class MarketProduct:
    """모델이 보는 상품. reference_krw 가 없으면 후속 판단에만 쓰이고 가격은 없다."""

    id: int
    category: str
    brand: str
    released_on: date
    performance_score: int
    reference_krw: int | None = None
    reference_on: date | None = None  # 기준 가격을 모은 날. 없으면 REFERENCE_ON


@dataclass(frozen=True)
class Flash:
    """반짝 할인 하나. followed_from 이 있으면 그 판매처의 반짝 할인을 따라 한 것."""

    source: str
    starts_on: date
    days: int
    pct: float
    followed_from: str | None = None

    @property
    def ends_on(self) -> date:
        return self.starts_on + timedelta(days=self.days - 1)

    def active(self, day: date) -> bool:
        return self.starts_on <= day <= self.ends_on


@dataclass(frozen=True)
class PriceParts:
    """한 판매처·한 날짜의 요소별 값. price 가 None 이면 품절(그날 기록하지 않음)."""

    anchor: float
    age: float
    successor: float
    cycle: float
    event: float
    seller: float
    noise: float
    sale_pct: float  # 그날 적용된 행사 할인율(%). 없으면 0
    sold_out: bool
    flash: float = 1.0
    flash_pct: float = 0.0  # 그날 적용된 반짝 할인율(%). 없으면 0

    @property
    def value(self) -> float:
        return self.without_event * self.event * self.flash

    @property
    def without_event(self) -> float:
        """행사(event)와 반짝 할인(flash)을 뺀 값. 판매가 목표가의 바탕이다."""
        return self.anchor * self.age * self.successor * self.cycle * self.seller * self.noise

    @property
    def price(self) -> int | None:
        return None if self.sold_out else max(PRICE_UNIT_KRW, round_to_unit(self.value))


# ---------------------------------------------------------------- 요소(상품·판매처와 무관한 것)

def age_factor(category: str, released_on: date, day: date) -> float:
    rate, floor = AGE_DECAY.get(category, DEFAULT_AGE_DECAY)
    months = max(0, (day - released_on).days) / DAYS_PER_MONTH
    return max(floor, (1.0 - rate) ** months)


def demand_shape(event: ScheduledEvent, day: date) -> float:
    """시작일 0 → 가운데 날 1 → 끝날 0 인 삼각형. 기간 밖은 0."""
    if not event.active(day):
        return 0.0
    span = (event.ends_on - event.starts_on).days
    if span == 0:
        return 1.0
    position = (day - event.starts_on).days / span
    return 1.0 - abs(2.0 * position - 1.0)


def is_successor(product: MarketProduct, other: MarketProduct) -> bool:
    """other 가 product 의 후속인가: 같은 카테고리·브랜드, 성능 점수 90%~130%, 더 늦게 출시."""
    low, high = SUCCESSOR_SCORE_RATIO
    return (
        other.id != product.id
        and other.category == product.category
        and other.brand == product.brand
        and other.released_on > product.released_on
        and low * product.performance_score <= other.performance_score <= high * product.performance_score
    )


# ---------------------------------------------------------------- 모델

class MarketModel:
    """상품·일정·시드가 같으면 언제나 같은 가격을 돌려준다. 값은 필요할 때 계산하고 고정값만 기억한다."""

    def __init__(self, products: Iterable[MarketProduct], events: Iterable[ScheduledEvent] = (),
                 seed: int = DEFAULT_SEED):
        self.seed = seed
        self.products: dict[int, MarketProduct] = {product.id: product for product in products}
        self.events = tuple(sorted(events, key=lambda event: (event.starts_on, event.code)))
        self._sales = tuple(event for event in self.events if event.kind == EVENT_SALE)
        self._demands = tuple(event for event in self.events if event.kind == EVENT_DEMAND)
        groups: dict[tuple[str, str], list[MarketProduct]] = {}
        for product in self.products.values():
            groups.setdefault((product.category, product.brand), []).append(product)
        self._successor_launches: dict[int, tuple[date, ...]] = {
            product.id: tuple(sorted(
                other.released_on for other in groups[(product.category, product.brand)] if is_successor(product, other)
            ))
            for product in self.products.values()
        }
        self._anchors: dict[int, float | None] = {}
        self._flash_starts: dict[tuple[int, str, date], Flash | None] = {}

    # ------------------------------------------------------------ 고정값
    def successor_launches(self, product_id: int) -> tuple[date, ...]:
        """후속 상품들의 출시일(오래된 순)."""
        return self._successor_launches.get(product_id, ())

    def successor_drop_pct(self, product_id: int) -> float:
        return between(*SUCCESSOR_DROP_PCT, unit(self.seed, product_id, "", "", "successor"))

    def seller(self, product_id: int, source: str) -> float:
        low, high = SELLER_OFFSET_PCT[source]
        return 1.0 + between(low, high, unit(self.seed, product_id, source, "", "seller")) / 100.0

    def sale_discount_pct(self, product_id: int, source: str, event: ScheduledEvent) -> float:
        return between(event.min_pct, event.max_pct, unit(self.seed, product_id, source, event.code, "sale"))

    def pre_raises(self, product_id: int) -> bool:
        return unit(self.seed, product_id, "", "", "pre_raise") < PRE_RAISE_PROB

    def pre_raise_pct(self, product_id: int, event: ScheduledEvent) -> float:
        return between(*PRE_RAISE_PCT, unit(self.seed, product_id, "", event.code, "pre_raise_pct"))

    def demand_peak_pct(self, category: str, event: ScheduledEvent) -> float:
        return between(event.min_pct, event.max_pct, unit(self.seed, category, "", event.code, "demand"))

    def store_ratio(self, product_id: int) -> float:
        return between(*STORE_RATIO, unit(self.seed, product_id, STORE, "", "store_ratio"))

    # ------------------------------------------------------------ 날짜마다 바뀌는 요소
    def age(self, product: MarketProduct, day: date) -> float:
        return age_factor(product.category, product.released_on, day)

    def successor(self, product: MarketProduct, day: date) -> float:
        progress = 0.0
        for launched_on in self.successor_launches(product.id):
            if launched_on > day:
                break
            progress = max(progress, min(1.0, ((day - launched_on).days + 1) / SUCCESSOR_RAMP_DAYS))
        return 1.0 - self.successor_drop_pct(product.id) / 100.0 * progress if progress else 1.0

    def cycle(self, category: str, day: date) -> float:
        factor = 1.0
        for event in self._demands:
            if event.active(day) and event.covers_category(category):
                factor *= 1.0 + self.demand_peak_pct(category, event) / 100.0 * demand_shape(event, day)
        return factor

    def active_sales(self, category: str, source: str, day: date) -> list[ScheduledEvent]:
        return [event for event in self._sales
                if event.active(day) and event.covers_category(category) and event.covers_source(source)]

    def sale_pct(self, product: MarketProduct, source: str, day: date) -> float:
        """그날 이 판매처의 행사 할인율(%). 행사가 겹치면 가장 큰 것 하나, 없으면 0."""
        return max((self.sale_discount_pct(product.id, source, event)
                    for event in self.active_sales(product.category, source, day)), default=0.0)

    def event(self, product: MarketProduct, source: str, day: date) -> float:
        discount = self.sale_pct(product, source, day)
        if discount:
            return 1.0 - discount / 100.0
        if not self.pre_raises(product.id):
            return 1.0
        raise_pct = max((
            self.pre_raise_pct(product.id, event) for event in self._sales
            if 0 < (event.starts_on - day).days <= PRE_RAISE_DAYS
            and event.covers_category(product.category) and event.covers_source(source)
        ), default=0.0)
        return 1.0 + raise_pct / 100.0

    # ------------------------------------------------------------ 반짝 할인
    def flash_started(self, product_id: int, source: str, day: date) -> Flash | None:
        """이 판매처가 그날 스스로 시작한 반짝 할인(따라 한 것 제외). 없으면 None."""
        key = (product_id, source, day)
        if key not in self._flash_starts:
            on = day.isoformat()
            flash = None
            if unit(self.seed, product_id, source, on, "flash") < 1.0 / FLASH_INTERVAL_DAYS:
                low, high = FLASH_DAYS
                days = min(high, low + int(unit(self.seed, product_id, source, on, "flash_days") * (high - low + 1)))
                pct = between(*FLASH_PCT, unit(self.seed, product_id, source, on, "flash_pct"))
                flash = Flash(source, day, days, pct)
            self._flash_starts[key] = flash
        return self._flash_starts[key]

    def flash_follow(self, product_id: int, leader: Flash, source: str) -> Flash | None:
        """다른 판매처(source)가 leader 를 따라 하는 반짝 할인. 따라 하지 않으면 None."""
        on = leader.starts_on.isoformat()
        if unit(self.seed, product_id, leader.source, on, "flash_follow") >= FLASH_FOLLOW_PROB:
            return None
        low, high = FLASH_FOLLOW_DELAY_DAYS
        delay = min(high, low + int(unit(self.seed, product_id, leader.source, on, "flash_delay") * (high - low + 1)))
        share = between(*FLASH_FOLLOW_SHARE, unit(self.seed, product_id, leader.source, on, "flash_share"))
        return Flash(source, leader.starts_on + timedelta(days=delay), leader.days, leader.pct * share, leader.source)

    def flashes(self, product: MarketProduct, source: str, day: date) -> list[Flash]:
        """그날 이 판매처에 걸린 반짝 할인(스스로 한 것과 따라 한 것). 기준일에 걸리는 것은 없다."""
        found = []
        for back in range(FLASH_DAYS[1]):
            flash = self.flash_started(product.id, source, day - timedelta(days=back))
            if flash is not None and flash.active(day):
                found.append(flash)
        for leader_source in SOURCES:
            if leader_source == source:
                continue
            for back in range(1, FLASH_DAYS[1] + FLASH_FOLLOW_DELAY_DAYS[1]):
                leader = self.flash_started(product.id, leader_source, day - timedelta(days=back))
                follow = None if leader is None else self.flash_follow(product.id, leader, source)
                if follow is not None and follow.active(day):
                    found.append(follow)
        reference_on = max(product.reference_on or REFERENCE_ON, product.released_on)
        return [flash for flash in found if not flash.active(reference_on)]

    def flash_pct(self, product: MarketProduct, source: str, day: date) -> float:
        """그날 이 판매처의 반짝 할인율(%). 겹치면 가장 큰 것 하나, 없으면 0."""
        return max((flash.pct for flash in self.flashes(product, source, day)), default=0.0)

    def flash(self, product: MarketProduct, source: str, day: date) -> float:
        return 1.0 - self.flash_pct(product, source, day) / 100.0

    def noise(self, product_id: int, source: str, day: date) -> float:
        return 1.0 + between(-NOISE_PCT, NOISE_PCT, unit(self.seed, product_id, source, day.isoformat(), "noise")) / 100.0

    def sold_out(self, product_id: int, source: str, day: date) -> bool:
        return unit(self.seed, product_id, source, day.isoformat(), "sold_out") < SOLD_OUT_PROB

    # ------------------------------------------------------------ 가격
    def anchor(self, product: MarketProduct) -> float | None:
        """기준 가격 ÷ (수집일의 age × successor × cycle). 기준 가격이 없으면 None."""
        if product.id not in self._anchors:
            if product.reference_krw is None:
                self._anchors[product.id] = None
            else:
                on = max(product.reference_on or REFERENCE_ON, product.released_on)
                divisor = self.age(product, on) * self.successor(product, on) * self.cycle(product.category, on)
                self._anchors[product.id] = product.reference_krw / divisor
        return self._anchors[product.id]

    def parts(self, product_id: int, source: str, day: date) -> PriceParts | None:
        """요소별 값. 모르는 상품·출시 전·기준 가격 없음이면 None."""
        product = self.products.get(product_id)
        if product is None or product.released_on > day:
            return None
        anchor = self.anchor(product)
        if anchor is None:
            return None
        if source not in SELLER_OFFSET_PCT:
            raise ValueError(f"source must be one of {SOURCES}")
        flash_pct = self.flash_pct(product, source, day)
        return PriceParts(
            anchor=anchor, age=self.age(product, day), successor=self.successor(product, day),
            cycle=self.cycle(product.category, day), event=self.event(product, source, day),
            seller=self.seller(product_id, source), noise=self.noise(product_id, source, day),
            sale_pct=self.sale_pct(product, source, day), sold_out=self.sold_out(product_id, source, day),
            flash=1.0 - flash_pct / 100.0, flash_pct=flash_pct,
        )

    def price(self, product_id: int, source: str, day: date) -> int | None:
        parts = self.parts(product_id, source, day)
        return None if parts is None else parts.price

    # ------------------------------------------------------------ 판매가(store)
    def store_sale_pct(self, product: MarketProduct, day: date) -> float:
        """MOA Parts 가 그날 반영할 행사 할인율(%) = 카테고리가 맞는 행사의 할인율(상품·store 마다 고정) × 절반.
        판매처(sources)와 관계없이 행사 기간이면 함께 한다. 겹치면 가장 큰 것 하나."""
        discount = max((self.sale_discount_pct(product.id, STORE, event) for event in self._sales
                        if event.active(day) and event.covers_category(product.category)), default=0.0)
        return discount * STORE_SALE_SHARE

    def store_target(self, product_id: int, day: date) -> float | None:
        """판매가 목표 = (그날 기록되는 판매처들의 행사·반짝 할인 전 가격 평균) × 상품별 배율 × (1 - 행사 할인율의 절반).
        반짝 할인은 반영하지 않는다. 두 판매처가 모두 품절이거나 가격이 없으면 None."""
        product = self.products.get(product_id)
        bases = []
        for source in SOURCES:
            parts = self.parts(product_id, source, day)
            if parts is not None and not parts.sold_out:
                bases.append(parts.without_event)
        if product is None or not bases:
            return None
        return sum(bases) / len(bases) * self.store_ratio(product_id) * (1.0 - self.store_sale_pct(product, day) / 100.0)


# ---------------------------------------------------------------- 라벨(4-2)

def drop_label(prices: Mapping[date, int | None], day: date, horizon_days: int = LABEL_HORIZON_DAYS,
               drop_pct: float = LABEL_DROP_PCT) -> bool | None:
    """day 다음 날부터 horizon_days 일 안에 day 가격보다 drop_pct% 이상 낮은 가격이 있으면 True.
    day 가격이 없거나 그 뒤 가격이 하나도 없으면 None(라벨 없음)."""
    today = prices.get(day)
    if today is None:
        return None
    ahead = [prices.get(day + timedelta(days=offset)) for offset in range(1, horizon_days + 1)]
    ahead = [price for price in ahead if price is not None]
    if not ahead:
        return None
    return min(ahead) <= today * (1.0 - drop_pct / 100.0)
