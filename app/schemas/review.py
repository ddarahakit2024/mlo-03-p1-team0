from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

REVIEW_RATINGS = (1, 2, 3, 4, 5)
ReviewContent = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2000)]


class ReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int = Field(ge=1, le=5, strict=True)
    content: ReviewContent


class ReviewUpdate(BaseModel):
    """보낸 필드만 바꾼다. 하나 이상 보내야 하고, null 은 받지 않는다."""

    model_config = ConfigDict(extra="forbid")

    rating: int | None = Field(default=None, ge=1, le=5, strict=True)
    content: ReviewContent | None = None

    @model_validator(mode="after")
    def at_least_one_value(self):
        if not self.model_fields_set or any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("rating 또는 content 를 하나 이상 보내야 합니다.")
        return self


class ReviewAuthor(BaseModel):
    id: str
    name: str


class Review(BaseModel):
    id: int
    product_id: int
    author: ReviewAuthor
    rating: int
    content: str
    created_at: datetime
    updated_at: datetime
    is_owner: bool


class ReviewPage(BaseModel):
    items: list[Review]
    total: int
    page: int
    page_size: int
    rating_average: float | None
    rating_counts: dict[str, int]
    my_review: Review | None
    can_review: bool


class ReviewResponse(BaseModel):
    code: int
    message: str
    result: Review


class ReviewPageResponse(BaseModel):
    code: int
    message: str
    result: ReviewPage


class EmptyResponse(BaseModel):
    code: int
    message: str
    result: None = None
