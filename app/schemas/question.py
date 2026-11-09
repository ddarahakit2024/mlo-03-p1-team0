from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.product import MAX_ID


class QuestionWrite(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)]
    # 관련 부품(출시된 상품 id, 정수만). 작성: 없거나 null 이면 연결 없음. 수정: 보내지 않으면 그대로, null 이면 연결을 끊는다.
    product_id: int | None = Field(default=None, ge=1, le=MAX_ID, strict=True)


class QuestionCreate(QuestionWrite):
    model_config = ConfigDict(extra="forbid")

    upload_ids: list[Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]] = Field(default_factory=list, max_length=5)

    @field_validator("upload_ids")
    @classmethod
    def unique_uploads(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("Duplicate upload IDs")
        return values


class UploadPresignRequest(BaseModel):
    filename: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    content_type: Literal["image/jpeg", "image/png", "image/gif", "image/webp"]
    size: int = Field(gt=0, le=5 * 1024 * 1024, strict=True)


class UploadPresignResult(BaseModel):
    upload_id: str
    url: str
    method: Literal["PUT"]
    headers: dict[str, str]
    expires_in: int


class UploadPresignResponse(BaseModel):
    code: int
    message: str
    result: UploadPresignResult


class QuestionAuthor(BaseModel):
    id: str
    name: str


class QuestionProduct(BaseModel):
    """질문에 연결한 부품(출시된 상품만, 출시 전이면 질문의 product 는 null)."""

    id: int
    name: str
    brand: str
    category: str
    thumbnail_url: str
    price_krw: int
    change_30d_pct: float | None  # price_trend.change_30d_pct 와 같다


class QuestionListItem(BaseModel):
    id: int
    title: str
    content: str
    author: QuestionAuthor
    created_at: datetime
    updated_at: datetime
    image_count: int
    answer_count: int
    product: QuestionProduct | None
    view_count: int  # DB NULL 은 0
    accepted_answer_id: int | None


class AnswerWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class Answer(BaseModel):
    id: int
    question_id: int
    author: QuestionAuthor
    content: str
    created_at: datetime
    updated_at: datetime
    is_owner: bool
    is_accepted: bool  # 질문 작성자가 채택한 답변


class AnswerResponse(BaseModel):
    code: int
    message: str
    result: Answer


class AnswerDeleteResponse(BaseModel):
    code: int
    message: str
    result: None = None


class QuestionImageResult(BaseModel):
    id: int
    filename: str
    url: str


class QuestionDetail(QuestionListItem):
    images: list[QuestionImageResult]
    is_owner: bool
    answers: list[Answer]  # 오래된 순


class QuestionPage(BaseModel):
    items: list[QuestionListItem]
    total: int
    page: int
    page_size: int


class QuestionListResponse(BaseModel):
    code: int
    message: str
    result: QuestionPage


class QuestionDetailResponse(BaseModel):
    code: int
    message: str
    result: QuestionDetail
