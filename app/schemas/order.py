from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.cart import MAX_QUANTITY_PER_PRODUCT
from app.schemas.product import MAX_ID
from app.schemas.returns import ReturnableLine, ReturnRequestResult

MAX_LINES_PER_ORDER = 20
# spec 의 ^0\d{1,2}-?\d{3,4}-?\d{4}$ 와 같다. \d 가 전각·아랍 숫자까지 받지 않도록 [0-9] 로 쓴다(JS 의 \d 와 같은 범위).
PHONE_PATTERN = r"^0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}$"
POSTAL_CODE_PATTERN = r"^[0-9]{5}$"


def _text(min_length: int, max_length: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)]


class Shipping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient_name: _text(1, 50)
    phone: Annotated[str, StringConstraints(strip_whitespace=True, pattern=PHONE_PATTERN)]
    postal_code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=POSTAL_CODE_PATTERN)]
    address1: _text(1, 200)
    address2: _text(0, 200) = ""
    delivery_memo: _text(0, 100) = ""


class OrderLine(BaseModel):
    # 가격·합계는 받지 않는다. 서버 DB 값만 쓴다.
    model_config = ConfigDict(extra="forbid")

    product_id: int = Field(ge=1, le=MAX_ID, strict=True)
    quantity: int = Field(ge=1, le=MAX_QUANTITY_PER_PRODUCT, strict=True)


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[OrderLine] = Field(min_length=1, max_length=MAX_LINES_PER_ORDER)
    shipping: Shipping

    @field_validator("items")
    @classmethod
    def unique_products(cls, items: list[OrderLine]) -> list[OrderLine]:
        product_ids = [item.product_id for item in items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Duplicate product_id")
        return items


class ConfirmOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payment_id: str = Field(min_length=1, max_length=100)


class PaymentRequest(BaseModel):
    payment_id: str
    order_name: str
    total_amount: int
    currency: Literal["KRW"] = "KRW"
    store_id: str
    channel_key: str
    # "mock" 이면 PortOne 결제창 없이 바로 POST /orders/confirm 을 부른다(store_id·channel_key 는 빈 문자열).
    provider: Literal["portone", "mock"]
    status: str


class OrderItem(BaseModel):
    product_id: int
    product_name: str
    unit_price_krw: int
    quantity: int
    subtotal_krw: int
    # 견적에서 담은 장바구니 줄로 주문했으면 그 묶음 id, 아니면 null(docs/specs/2026-11-01-build-id-purpose.md)
    build_id: str | None


class ShippingInfo(BaseModel):
    """응답용 배송지. 저장된 값을 다시 검증하지 않고 그대로 돌려준다."""

    recipient_name: str
    phone: str
    postal_code: str
    address1: str
    address2: str
    delivery_memo: str


class OrderSummary(BaseModel):
    payment_id: str
    order_name: str
    status: str
    total_krw: int
    item_count: int
    thumbnail_url: str
    created_at: datetime
    paid_at: datetime | None


class OrderDetail(OrderSummary):
    items: list[OrderItem]
    shipping: ShippingInfo
    cancelled_at: datetime | None
    # 반품(docs/specs/2026-11-01-returns-refunds.md): 신청 순 반품 내역, 상품별 신청 가능 수량(0 인 상품은 빼고,
    # PAID 가 아니면 빈 배열), 신청 기한(paid_at + 7일, PAID 가 아니면 null)
    returns: list[ReturnRequestResult]
    returnable: list[ReturnableLine]
    return_deadline: datetime | None


class OrderPage(BaseModel):
    items: list[OrderSummary]
    total: int
    page: int
    page_size: int


class PaymentRequestResponse(BaseModel):
    code: int
    message: str
    result: PaymentRequest


class OrderDetailResponse(BaseModel):
    code: int
    message: str
    result: OrderDetail


class OrderPageResponse(BaseModel):
    code: int
    message: str
    result: OrderPage
