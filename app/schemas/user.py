import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.community import BuildPurpose


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    # 선택 항목 "사용 목적"(견적 게시판 용도와 같은 값). 없거나 null 이면 고르지 않은 것이다.
    # docs/specs/2026-11-01-build-id-purpose.md
    purpose: BuildPurpose | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("유효한 이메일 주소를 입력해 주세요.")
        return value

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("이름을 입력해 주세요.")
        return value


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str


class SignupResponse(BaseModel):
    code: int
    message: str
    result: UserResult


class LoginResult(BaseModel):
    authenticated: bool = True


class LoginResponse(BaseModel):
    code: int
    message: str
    result: LoginResult


class CurrentUser(BaseModel):
    name: str
    provider: Literal["local", "kakao"]
    # 회원가입 때 고른 사용 목적. 카카오 회원·고르지 않은 회원·이 기능 전에 가입한 회원은 null
    purpose: str | None
    # 관리자면 "admin", 아니면 null(docs/specs/2026-11-01-returns-refunds.md)
    role: Literal["admin"] | None


class CurrentUserResponse(BaseModel):
    code: int
    message: str
    result: CurrentUser


class LogoutResponse(BaseModel):
    code: int
    message: str
    result: None = None


class MyPost(BaseModel):
    """내가 쓴 글(GET /user/me/posts). 질문 게시판 질문과 커뮤니티 글을 한 목록으로."""

    kind: Literal["question", "free", "build"]
    id: int
    title: str
    created_at: datetime
    reply_count: int  # 질문은 답변 수, 커뮤니티 글은 댓글 수


class MyPostPage(BaseModel):
    items: list[MyPost]  # 최신순
    total: int
    page: int
    page_size: int


class MyPostPageResponse(BaseModel):
    code: int
    message: str
    result: MyPostPage
