from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core import product_metrics

# 순서 고정. 한글 이름은 프런트 stores 가 매핑한다.
PRODUCT_CATEGORIES = ("cpu", "mainboard", "memory", "gpu", "storage", "psu", "case", "cooler")
ProductCategory = Literal["cpu", "mainboard", "memory", "gpu", "storage", "psu", "case", "cooler"]
# drop_desc: 30일 가격 변동률 오름차순(많이 내린 것 먼저, 변동률 없는 상품은 뒤)
ProductSort = Literal["recommended", "price_asc", "price_desc", "newest", "value_desc", "rating_desc", "drop_desc"]
PriceSource = Literal["store", "coupang", "naver"]

# DB INTEGER 범위. 이보다 큰 ID 는 DB 로 보내기 전에 422 로 막는다.
MAX_ID = 2_147_483_647


class SpecItem(BaseModel):
    label: str
    value: str


class ExternalLowest(BaseModel):
    source: Literal["coupang", "naver"]
    price_krw: int


class PriceTrend(BaseModel):
    """가격 추세. 계산은 app/core/price_trends.py(지금 이후 기록은 세지 않는다)."""

    change_30d_pct: float | None  # 30일 전 가격 대비 변동률(%)
    lowest_1y_krw: int | None
    lowest_1y_on: date | None  # 서울 날짜
    highest_1y_krw: int | None
    average_30d_krw: int | None
    is_lowest_1y: bool  # 판매가 <= 1년 최저가 × 1.01
    lowest_gap_pct: float | None
    sparkline_30d: list[int]  # 서울 날짜마다 그날 마지막 store 가격(오래된 순, 마지막 = 판매가)
    external_lowest: ExternalLowest | None
    store_is_lowest: bool
    store_gap_krw: int | None


class ProductSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    brand: str
    category: str
    price_krw: int
    stock: int
    thumbnail_url: str
    summary: str
    released_on: date
    performance_score: int
    # 리뷰 집계. 라우터가 채운다(리뷰가 없으면 null 과 0).
    rating_average: float | None = None
    review_count: int = 0
    # 가격 추세. 라우터가 app.core.price_trends 로 채운다.
    price_trend: PriceTrend

    @computed_field
    @property
    def value_score(self) -> float | None:
        """1만 원당 성능 점수(소수 2자리). 가격이 0 이하인 비정상 데이터만 null."""
        return product_metrics.value_score(self.performance_score, self.price_krw)

    @computed_field
    @property
    def is_new(self) -> bool:
        """출시일이 오늘(Asia/Seoul) 기준 90일 이내(출시 예정 포함)."""
        return product_metrics.is_new(self.released_on)


class StorePrice(BaseModel):
    source: PriceSource
    price_krw: int
    recorded_at: datetime | None  # store 는 마지막 store 기록 시각(없으면 null)


class ProductDetail(ProductSummary):
    description: str
    specs: list[SpecItem]
    # 우리 판매가 + 판매처별 365일 안 최신가. 가격 오름차순, 같으면 store 먼저
    store_prices: list[StorePrice]
    # 최근 90일 store 이력 중 최저가. 응답에는 내보내지 않고 lowest_price_90d 계산에만 쓴다.
    lowest_store_price_90d: int | None = Field(default=None, exclude=True)

    @computed_field
    @property
    def lowest_price_90d(self) -> int:
        """최근 90일 store 이력과 현재 가격 중 최저."""
        history = self.lowest_store_price_90d
        return self.price_krw if history is None else min(self.price_krw, history)


class ProductPage(BaseModel):
    items: list[ProductSummary]
    total: int
    page: int
    page_size: int


class ProductPageResponse(BaseModel):
    code: int
    message: str
    result: ProductPage


class ProductDetailResponse(BaseModel):
    code: int
    message: str
    result: ProductDetail


class BrandFacet(BaseModel):
    name: str
    count: int


class ProductFacets(BaseModel):
    brands: list[BrandFacet]
    price_min: int | None
    price_max: int | None


class ProductFacetsResponse(BaseModel):
    code: int
    message: str
    result: ProductFacets


class PriceSummary(BaseModel):
    product_count: int  # 출시된 상품 수
    dropping_count: int  # change_30d_pct <= -1.0
    lowest_1y_count: int  # is_lowest_1y


class PriceSummaryResponse(BaseModel):
    code: int
    message: str
    result: PriceSummary


class PriceHistoryItem(BaseModel):
    price_krw: int
    source: str  # store, coupang, naver
    recorded_at: datetime


class PriceHistory(BaseModel):
    items: list[PriceHistoryItem]
    lowest_price_krw: int | None
    highest_price_krw: int | None


class PriceHistoryResponse(BaseModel):
    code: int
    message: str
    result: PriceHistory
