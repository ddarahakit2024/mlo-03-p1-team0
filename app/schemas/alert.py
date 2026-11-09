"""목표가 알림(/alerts)·최저가 매칭 요청(POST /products/{id}/price-match) 요청·응답."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.product import ProductSummary

MAX_TARGET_PRICE_KRW = 100_000_000


class AlertWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 정수만 받는다(389000.0·"389000"·true 는 422).
    target_price_krw: int = Field(ge=1, le=MAX_TARGET_PRICE_KRW, strict=True)


class Alert(BaseModel):
    product_id: int
    target_price_krw: int
    reached: bool  # product.price_krw <= target_price_krw
    created_at: datetime
    updated_at: datetime
    product: ProductSummary


class AlertResponse(BaseModel):
    code: int
    message: str
    result: Alert


class AlertList(BaseModel):
    items: list[Alert]  # 최근 수정 순


class AlertListResponse(BaseModel):
    code: int
    message: str
    result: AlertList


class AlertEmptyResponse(BaseModel):
    code: int
    message: str
    result: None = None


class PriceMatch(BaseModel):
    id: int
    product_id: int
    store_price_krw: int
    external_source: Literal["coupang", "naver"]
    external_price_krw: int
    status: str
    created_at: datetime


class PriceMatchResponse(BaseModel):
    code: int
    message: str
    result: PriceMatch
