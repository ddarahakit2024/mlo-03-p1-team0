"""반품·환불 요청·응답 스키마. docs/specs/2026-11-01-returns-refunds.md 의 API 계약."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.return_request import RETURN_REASONS, RETURN_STATUSES
from app.schemas.product import MAX_ID

ReturnReason = Literal[RETURN_REASONS]
ReturnStatus = Literal[RETURN_STATUSES]
MAX_DETAIL_LENGTH = 500
MAX_REJECT_REASON_LENGTH = 200
# 한 주문의 줄 수 상한(app/schemas/order.py 의 MAX_LINES_PER_ORDER)과 같다. 실제 상한(주문 줄 수)은 서버가 409 로 본다.
MAX_RETURN_LINES = 20


class ReturnLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int = Field(ge=1, le=MAX_ID, strict=True)
    # 1 이상. 신청 가능 수량(주문 수량 − 이미 신청한 수량)을 넘으면 409 다(422 가 아니다).
    quantity: int = Field(ge=1, le=MAX_ID, strict=True)


class CreateReturnRequest(BaseModel):
    # 가격·환불 금액은 받지 않는다. 서버가 주문 당시 단가로 계산한다.
    model_config = ConfigDict(extra="forbid")

    reason: ReturnReason
    # 선택. 없거나 null 이면 빈 문자열로 저장한다. 앞뒤 공백은 지운다.
    detail: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_DETAIL_LENGTH)] | None = None
    items: list[ReturnLine] = Field(min_length=1, max_length=MAX_RETURN_LINES)

    @field_validator("items")
    @classmethod
    def unique_products(cls, items: list[ReturnLine]) -> list[ReturnLine]:
        product_ids = [item.product_id for item in items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Duplicate product_id")
        return items


class RejectReturnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_REJECT_REASON_LENGTH)
    ]


class ReturnItem(BaseModel):
    product_id: int
    # 주문 당시 이름(product_order_items.product_name)
    product_name: str
    quantity: int
    unit_price_krw: int


class ReturnRequestResult(BaseModel):
    id: int
    payment_id: str
    status: ReturnStatus
    reason: ReturnReason
    detail: str
    items: list[ReturnItem]
    items_total_krw: int
    shipping_deduction_krw: int
    refund_amount_krw: int
    requested_at: datetime
    decided_at: datetime | None
    reject_reason: str | None
    refunded_at: datetime | None


class AdminReturn(ReturnRequestResult):
    # 개인정보(이메일·이름·배송지)는 넣지 않는다. 구매자는 subject 로만 가리킨다.
    order_name: str
    buyer_subject: str
    paid_at: datetime | None
    payment_provider: str
    refund_error: str | None


class ReturnableLine(BaseModel):
    product_id: int
    quantity: int


class AdminReturnPage(BaseModel):
    items: list[AdminReturn]
    total: int
    page: int


class ReturnRequestResponse(BaseModel):
    code: int
    message: str
    result: ReturnRequestResult


class AdminReturnResponse(BaseModel):
    code: int
    message: str
    result: AdminReturn


class AdminReturnPageResponse(BaseModel):
    code: int
    message: str
    result: AdminReturnPage
