from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.product import MAX_ID, PriceTrend

MAX_QUANTITY_PER_PRODUCT = 10
# 견적 담기(POST /cart/builds)에서 담지 못한 이유. docs/specs/2026-11-01-build-id-purpose.md
SKIP_SOLD_OUT = "sold_out"  # 재고 0
SKIP_UNAVAILABLE = "unavailable"  # 출시 전·판매하지 않는 상품
SKIP_LIMIT = "limit"  # 이미 한도(MAX_QUANTITY_PER_PRODUCT 또는 재고)만큼 담겨 있다
SkipReason = Literal["sold_out", "unavailable", "limit"]


class CartItemAdd(BaseModel):
    # 가격·합계는 받지 않는다. 서버 DB 값만 쓴다.
    model_config = ConfigDict(extra="forbid")

    product_id: int = Field(ge=1, le=MAX_ID, strict=True)
    quantity: int = Field(ge=1, le=MAX_QUANTITY_PER_PRODUCT, strict=True)


class CartItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quantity: int = Field(ge=1, le=MAX_QUANTITY_PER_PRODUCT, strict=True)


class BuildAddRequest(BaseModel):
    """견적 댓글 하나를 장바구니에 담는다. 범위 밖 id 는 DB 에 묻지 않고 없는 댓글(404)로 답한다(커뮤니티와 같다)."""

    model_config = ConfigDict(extra="forbid")

    comment_id: int = Field(ge=1, strict=True)


class CartBuild(BaseModel):
    """장바구니 줄을 마지막으로 담은 견적 묶음."""

    id: str
    post_id: int | None
    comment_id: int | None


class CartItem(BaseModel):
    product_id: int
    name: str
    brand: str
    category: str
    thumbnail_url: str
    price_krw: int
    stock: int
    quantity: int
    subtotal_krw: int
    # 견적에서 담은 줄이면 그 묶음, 아니면 null
    build: CartBuild | None
    # 처음 담을 때의 판매가(이 기능 전에 담은 줄은 null)와 그 뒤 바뀐 금액(price_krw − added_price_krw)
    added_price_krw: int | None
    price_change_krw: int | None
    # 상품 목록과 같은 가격 추세(타몰 비교 문구에 쓴다)
    price_trend: PriceTrend


class Cart(BaseModel):
    items: list[CartItem]
    item_count: int
    total_krw: int
    # 우리가 가장 싼 줄의 (외부 최저가 − 판매가) × 수량 합계
    external_saving_krw: int


class CartResponse(BaseModel):
    code: int
    message: str
    result: Cart


class BuildAddedLine(BaseModel):
    product_id: int
    quantity: int  # 이번에 더한 수량(댓글의 수량, 한도에 걸리면 줄어든 값)


class BuildSkippedLine(BaseModel):
    product_id: int
    reason: SkipReason


class BuildAddResult(BaseModel):
    build_id: str
    post_id: int
    comment_id: int
    added: list[BuildAddedLine]
    skipped: list[BuildSkippedLine]
    cart: Cart


class BuildAddResponse(BaseModel):
    code: int
    message: str
    result: BuildAddResult
