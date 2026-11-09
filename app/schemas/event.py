"""사용자 이벤트 수집(POST /events) 요청·응답 스키마. docs/specs/2026-10-30-event-logging.md 의 API 계약
(type 추가와 schema_version 은 docs/specs/2026-11-01-event-enrichment.md, 버전 3 은 docs/specs/2026-11-01-build-id-purpose.md,
버전 4 는 docs/specs/2026-11-01-returns-refunds.md, 버전 5 는 docs/specs/2026-11-03-product-recommendations.md).

정의되지 않은 필드는 어디서든 422 다(extra="forbid"). 사용자는 서버가 쿠키로 정한 subject 로만 이어지므로
클라이언트가 보낸 subject·user 류 필드(이벤트·묶음·page 의 모든 추가 필드, props 의 FORBIDDEN_PROP_KEYS)는 받지 않는다.
"""
import math
import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field, field_validator

EVENT_TYPES = (
    "page_view", "product_list_view", "search", "filter_change", "product_view", "price_history_view",
    "review_list_view", "add_to_cart", "buy_now", "cart_view", "cart_update", "cart_remove", "checkout_view",
    "payment_start", "payment_result", "order_view", "review_submit", "question_view", "answer_submit",
    "login", "signup", "logout", "compatibility_check",
    # schema_version 2 (docs/specs/2026-11-01-event-enrichment.md): 노출·클릭·체류, 비교함, 커뮤니티
    "product_impression", "product_click", "product_dwell",
    "compare_add", "compare_remove", "compare_clear", "compare_view",
    "community_list_view", "community_post_view", "community_post_submit", "community_comment_submit",
    # schema_version 3 (docs/specs/2026-11-01-build-id-purpose.md): 견적 담기. signup 에 purpose 추가
    "build_add_to_cart",
    # schema_version 4 (docs/specs/2026-11-01-returns-refunds.md): 반품 신청·철회(detail 은 넣지 않는다)
    "return_request", "return_withdraw",
)
# 이벤트 계약 버전. 클라이언트가 이벤트마다 보낸다(없으면 1 = 2026-11-01 이전 화면). 1~4 로 온 이벤트도 그대로 받는다
# 5(docs/specs/2026-11-03-product-recommendations.md): 새 type 없음. product_impression·product_click 에 list "recommendation"
# 과 source_product_id·model_version 을 싣는다(props 는 자유 형식이라 서버 검증은 같다)
DEFAULT_SCHEMA_VERSION = 1
CURRENT_SCHEMA_VERSION = 5
MAX_EVENTS_PER_REQUEST = 50
MAX_EVENT_BODY_BYTES = 64 * 1024
MAX_PATH_LENGTH = 500
MAX_REFERRER_LENGTH = 500
MAX_PROPS = 20
MAX_PROP_STRING_LENGTH = 200
MAX_PROP_LIST_LENGTH = 20
PROP_KEY_PATTERN = re.compile(r"[a-z][a-z0-9_]{0,39}")
# 사용자를 가리키거나 개인정보인 키. 사용자는 서버가 정한 subject 로만 잇는다(spec 정책).
FORBIDDEN_PROP_KEYS = frozenset({
    "subject", "sub", "user", "user_id", "userid", "username", "user_name", "member_id", "account_id",
    "email", "phone", "name", "address", "password", "token",
})
_INT64_MIN, _INT64_MAX = -(2 ** 63), 2 ** 63 - 1
_EVENT_ID_PATTERN = re.compile(
    r"[0-9A-Fa-f]{32}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
)
_CLIENT_ID_PATTERN = re.compile(r"[A-Za-z0-9-]{8,64}")

EventType = Literal[EVENT_TYPES]


def _event_id(value: str) -> str:
    """하이픈이 있거나 없는 uuid 문자열 → 소문자 하이픈 형식(같은 uuid 를 다르게 써도 중복으로 본다)."""
    if not _EVENT_ID_PATTERN.fullmatch(value):
        raise ValueError("event_id 는 uuid 문자열이어야 합니다.")
    return str(UUID(value))


def _client_id(value: str) -> str:
    if not _CLIENT_ID_PATTERN.fullmatch(value):
        raise ValueError("8~64자의 영문·숫자·하이픈이어야 합니다.")
    return value


def _occurred_at(value: Any) -> datetime:
    """ISO 8601 문자열(시간대 포함)만 받아 UTC 로 바꾼다. 숫자·시간대 없는 값은 받지 않는다."""
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("occurred_at 은 ISO 8601 문자열이어야 합니다.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("occurred_at 은 ISO 8601 문자열이어야 합니다.") from None
    if parsed.utcoffset() is None:
        raise ValueError("occurred_at 에 시간대가 있어야 합니다.")
    try:
        return parsed.astimezone(timezone.utc)
    except OverflowError:
        raise ValueError("occurred_at 이 범위를 벗어났습니다.") from None


def _page_path(value: str) -> str:
    if not value.startswith("/"):
        raise ValueError("page.path 는 / 로 시작해야 합니다.")
    return value


def _check_prop_value(value: Any, *, allow_list: bool) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if not _INT64_MIN <= value <= _INT64_MAX:
            raise ValueError("정수는 64비트 범위여야 합니다.")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("실수는 유한한 값이어야 합니다.")
        return
    if isinstance(value, str):
        if len(value) > MAX_PROP_STRING_LENGTH:
            raise ValueError(f"문자열은 {MAX_PROP_STRING_LENGTH}자 이하여야 합니다.")
        return
    if allow_list and isinstance(value, list):
        if len(value) > MAX_PROP_LIST_LENGTH:
            raise ValueError(f"배열은 {MAX_PROP_LIST_LENGTH}개 이하여야 합니다.")
        for item in value:
            _check_prop_value(item, allow_list=False)
        return
    raise ValueError("값은 문자열·정수·실수·불리언·null 또는 그런 값의 배열이어야 합니다.")


EventId = Annotated[str, Field(strict=True), AfterValidator(_event_id)]
ClientId = Annotated[str, Field(strict=True), AfterValidator(_client_id)]
OccurredAt = Annotated[AwareDatetime, BeforeValidator(_occurred_at)]


class EventPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: Annotated[str, Field(strict=True, min_length=1, max_length=MAX_PATH_LENGTH), AfterValidator(_page_path)]
    referrer: str = Field(default="", strict=True, max_length=MAX_REFERRER_LENGTH)


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: EventId
    type: EventType
    occurred_at: OccurredAt
    session_id: ClientId
    anonymous_id: ClientId
    page: EventPage
    props: dict[str, Any] = Field(default_factory=dict)
    schema_version: int = Field(default=DEFAULT_SCHEMA_VERSION, strict=True, ge=1, le=CURRENT_SCHEMA_VERSION)

    @field_validator("props", mode="before")
    @classmethod
    def check_props(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("props 는 객체여야 합니다.")
        if len(value) > MAX_PROPS:
            raise ValueError(f"props 는 {MAX_PROPS}개 이하여야 합니다.")
        for key, item in value.items():
            if not isinstance(key, str) or not PROP_KEY_PATTERN.fullmatch(key):
                raise ValueError("props 키는 소문자로 시작하는 40자 이하의 [a-z0-9_] 이어야 합니다.")
            if key in FORBIDDEN_PROP_KEYS:
                raise ValueError(f"props 에 '{key}' 를 보낼 수 없습니다.")
            _check_prop_value(item, allow_list=True)
        return value


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[Event] = Field(min_length=1, max_length=MAX_EVENTS_PER_REQUEST)


class EventsAccepted(BaseModel):
    accepted: int


class EventsAcceptedResponse(BaseModel):
    code: int
    message: str
    result: EventsAccepted
