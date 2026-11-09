"""커뮤니티 게시판(자유·견적) 요청·응답. docs/specs/2026-11-01-community-dark-theme.md 의 API 계약."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.schemas.product import MAX_ID

BOARD_BUILD = "build"  # 견적 게시판. 자유 게시판은 "free"
MAX_ITEM_QUANTITY = 10  # 부품 한 줄의 최대 수량(DB CHECK 와 같다)
MAX_ITEMS_PER_COMMENT = 15  # 답글 하나의 최대 부품 줄 수
CommunityBoard = Literal["free", "build"]
BuildPurpose = Literal["gaming", "office", "creative", "development", "other"]
# 견적 글의 모니터 해상도와 선호 조건(2026-11-05). 이름은 프런트가 붙인다.
MonitorResolution = Literal["fhd", "qhd", "uhd", "none"]
BuildPreference = Literal["quiet", "small", "white", "rgb", "upgradable"]
MAX_PREFERENCES = 5
BuildPreferences = Annotated[list[BuildPreference], Field(max_length=MAX_PREFERENCES)]
PostTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
PostContent = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)]
CommentContent = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
# 정수만 받는다(1500000.0·"1500000"·true 는 422).
BudgetKrw = Annotated[int, Field(ge=100_000, le=100_000_000, strict=True)]
BUILD_ONLY_FIELDS = frozenset({"budget_krw", "purpose", "monitor_resolution", "preferences"})
# PATCH 에서 null 을 받는 필드(null = 비움). 그 밖의 필드는 null 을 받지 않는다.
NULLABLE_UPDATE_FIELDS = frozenset({"monitor_resolution", "preferences"})


class CommentItemWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int = Field(ge=1, le=MAX_ID, strict=True)
    quantity: int = Field(ge=1, le=MAX_ITEM_QUANTITY, strict=True)


CommentItems = Annotated[list[CommentItemWrite], Field(max_length=MAX_ITEMS_PER_COMMENT)]


def _unique_products(items: list[CommentItemWrite] | None) -> list[CommentItemWrite] | None:
    if items is not None and len({item.product_id for item in items}) != len(items):
        raise ValueError("같은 상품을 두 줄로 넣을 수 없습니다.")
    return items


def _unique_preferences(values: list[str] | None) -> list[str] | None:
    if values is not None and len(set(values)) != len(values):
        raise ValueError("선호 조건을 두 번 넣을 수 없습니다.")
    return values


def _reject_empty_or_null(model: BaseModel, nullable: frozenset[str] = frozenset()) -> None:
    """PATCH: 보낸 필드만 바꾼다. 하나 이상 보내야 하고 null 은 받지 않는다(리뷰 수정과 같은 규칙). nullable 은 예외."""
    fields = model.model_fields_set
    if not fields or any(getattr(model, name) is None for name in fields - nullable):
        raise ValueError("바꿀 값을 하나 이상 보내야 하고 null 은 보낼 수 없습니다.")


class PostCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    board: CommunityBoard
    title: PostTitle
    content: PostContent
    budget_krw: BudgetKrw | None = None
    purpose: BuildPurpose | None = None
    # 견적 글만(선택). 자유 글에 null 이 아닌 값을 보내면 422
    monitor_resolution: MonitorResolution | None = None
    preferences: BuildPreferences | None = None

    @field_validator("preferences")
    @classmethod
    def unique_preferences(cls, values: list[str] | None) -> list[str] | None:
        return _unique_preferences(values)

    @model_validator(mode="after")
    def build_fields_match_board(self):
        if self.board == BOARD_BUILD:
            if self.budget_krw is None or self.purpose is None:
                raise ValueError("견적 글에는 예산과 용도가 필요합니다.")
        elif any(getattr(self, name) is not None for name in BUILD_ONLY_FIELDS):
            raise ValueError("자유 글에는 예산·용도·모니터·선호 조건을 적지 않습니다.")
        return self


class PostUpdate(BaseModel):
    """board 는 바꿀 수 없다(보내면 extra="forbid" 로 422). BUILD_ONLY_FIELDS 는 견적 글에서만(라우터가 확인).

    monitor_resolution·preferences 는 null 을 받는다(비움). 자유 글에 null 을 보내는 것은 바뀌는 것이 없어 받는다.
    """

    model_config = ConfigDict(extra="forbid")

    title: PostTitle | None = None
    content: PostContent | None = None
    budget_krw: BudgetKrw | None = None
    purpose: BuildPurpose | None = None
    monitor_resolution: MonitorResolution | None = None
    preferences: BuildPreferences | None = None

    @field_validator("preferences")
    @classmethod
    def unique_preferences(cls, values: list[str] | None) -> list[str] | None:
        return _unique_preferences(values)

    @model_validator(mode="after")
    def at_least_one_value(self):
        _reject_empty_or_null(self, NULLABLE_UPDATE_FIELDS)
        return self


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: CommentContent
    # 견적 게시판 글의 댓글에만(라우터가 확인). 없거나 [] 면 부품 목록이 없는 댓글.
    items: CommentItems = Field(default_factory=list)

    @field_validator("items")
    @classmethod
    def unique_products(cls, items: list[CommentItemWrite]) -> list[CommentItemWrite]:
        return _unique_products(items)


class CommentUpdate(BaseModel):
    """items 를 보내면 부품 목록 전체를 바꾼다([] 는 비움)."""

    model_config = ConfigDict(extra="forbid")

    content: CommentContent | None = None
    items: CommentItems | None = None

    @field_validator("items")
    @classmethod
    def unique_products(cls, items: list[CommentItemWrite] | None) -> list[CommentItemWrite] | None:
        return _unique_products(items)

    @model_validator(mode="after")
    def at_least_one_value(self):
        _reject_empty_or_null(self)
        return self


class CommunityAuthor(BaseModel):
    id: str
    name: str


class PostListItem(BaseModel):
    id: int
    board: CommunityBoard
    title: str
    preview: str  # 본문 앞 120자(연속 공백·줄바꿈은 공백 하나로)
    author: CommunityAuthor
    budget_krw: int | None
    purpose: str | None
    monitor_resolution: str | None
    preferences: list[str]  # DB NULL 은 []
    comment_count: int
    quote_count: int  # 부품 목록이 1줄 이상인 댓글 수(자유 게시판은 언제나 0)
    created_at: datetime
    updated_at: datetime


class PostPage(BaseModel):
    items: list[PostListItem]
    total: int
    page: int
    page_size: int


class PostListResponse(BaseModel):
    code: int
    message: str
    result: PostPage


class CommentItemResult(BaseModel):
    product_id: int
    name: str
    brand: str
    category: str
    thumbnail_url: str
    price_krw: int  # 지금 판매가(products.price_krw)
    stock: int
    quantity: int
    line_total_krw: int  # price_krw × quantity


class CommentResult(BaseModel):
    id: int
    post_id: int
    author: CommunityAuthor
    content: str
    is_owner: bool
    created_at: datetime
    updated_at: datetime
    items: list[CommentItemResult]  # 넣은 순서
    items_total_krw: int  # 줄 금액 합계(부품이 없으면 0)
    # 견적 글의 댓글이고 부품이 있으면 items_total_krw − 글의 budget_krw(양수 = 예산 초과, 음수 = 남음). 그 밖에는 null
    budget_gap_krw: int | None


class CommentResponse(BaseModel):
    code: int
    message: str
    result: CommentResult


class PostDetail(BaseModel):
    id: int
    board: CommunityBoard
    title: str
    content: str
    author: CommunityAuthor
    budget_krw: int | None
    purpose: str | None
    monitor_resolution: str | None
    preferences: list[str]  # DB NULL 은 []
    is_owner: bool
    created_at: datetime
    updated_at: datetime
    comments: list[CommentResult]  # 오래된 순


class PostDetailResponse(BaseModel):
    code: int
    message: str
    result: PostDetail


class CommunityEmptyResponse(BaseModel):
    code: int
    message: str
    result: None = None
