"""상품 상세 추천·관리자 추천 학습 스키마. docs/specs/2026-11-03-product-recommendations.md 의 API 계약."""
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.schemas.product import ProductSummary

RecommendationReason = Literal["co_view", "similar"]


def _since(value: Any) -> datetime | None:
    """학습 시작 시각: null 이거나 시간대가 있는 ISO 8601 문자열만 받아 UTC 로 바꾼다(숫자·시간대 없는 값은 422)."""
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("since 는 ISO 8601 문자열이어야 합니다.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("since 는 ISO 8601 문자열이어야 합니다.") from None
    if parsed.utcoffset() is None:
        raise ValueError("since 에 시간대가 있어야 합니다.")
    try:
        return parsed.astimezone(timezone.utc)
    except OverflowError:
        raise ValueError("since 가 범위를 벗어났습니다.") from None


class TrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 이 시각 이후(received_at >= since)의 상품 조회 이벤트만 쓴다. null = 전체
    since: Annotated[datetime | None, BeforeValidator(_since)] = None


class ModelReference(BaseModel):
    version: str
    trained_at: datetime


class RecommendationModelSummary(BaseModel):
    id: int
    version: str
    algorithm: str
    trained_at: datetime
    events_since: datetime | None
    event_count: int
    session_count: int
    product_count: int
    pair_count: int
    params: dict[str, Any]
    duration_ms: int


class TrainResponse(BaseModel):
    code: int
    message: str
    result: RecommendationModelSummary


class ModelList(BaseModel):
    server_time: datetime  # 앱 시계(가상 시계) 지금. 화면의 "이 시각 이후" 기본값
    items: list[RecommendationModelSummary]


class ModelListResponse(BaseModel):
    code: int
    message: str
    result: ModelList


class RecommendedProduct(ProductSummary):
    rank: int
    reason: RecommendationReason


class ProductRecommendations(BaseModel):
    product_id: int
    model: ModelReference | None  # null = 기본 추천(같은 카테고리·비슷한 가격)
    items: list[RecommendedProduct]


class ProductRecommendationsResponse(BaseModel):
    code: int
    message: str
    result: ProductRecommendations


class CompareProduct(BaseModel):
    id: int
    name: str
    category: str
    price_krw: int


class CompareItem(BaseModel):
    rank: int
    product_id: int
    name: str
    price_krw: int
    score: float
    cf_score: float
    base_score: float
    co_sessions: int
    reason: RecommendationReason


class CompareRanking(BaseModel):
    model: ModelReference | None  # null = 기본 추천
    items: list[CompareItem]


class RecommendationCompare(BaseModel):
    product: CompareProduct
    current: CompareRanking
    previous: CompareRanking | None  # 모델이 0개면 null


class RecommendationCompareResponse(BaseModel):
    code: int
    message: str
    result: RecommendationCompare
