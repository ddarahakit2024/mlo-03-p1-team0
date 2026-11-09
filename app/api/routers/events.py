"""사용자 이벤트 수집 POST /events. docs/specs/2026-10-30-event-logging.md 의 API 계약.

순서: Origin(403) → Content-Length(413) → 본문을 64KB 까지만 읽기(413) → JSON·스키마(422) → 저장(202 {accepted}).
본문 크기를 먼저 막으려고 FastAPI 본문 매개변수 대신 직접 읽고 EventBatch 로 검증한다(오류 형식은 다른 422 와 같다).
"""
import json
from email.message import Message
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from app.api.deps import get_db, get_event_store, require_allowed_origin
from app.core import clock
from app.core.event_store import EventStore
from app.core.secret_query import redact_secret_query
from app.core.session import get_optional_subject
from app.schemas.event import MAX_EVENT_BODY_BYTES, Event, EventBatch, EventsAcceptedResponse

router = APIRouter(prefix="/events", tags=["events"])

EVENTS_ACCEPTED_MESSAGE = "이벤트를 받았습니다."
BODY_TOO_LARGE_MESSAGE = "요청 본문이 너무 큽니다. 64KB 이하로 보내 주세요."
CLIENT_DISCONNECTED_MESSAGE = "요청 본문을 끝까지 받지 못했습니다."
MAX_USER_AGENT_LENGTH = 512


def reject_large_content_length(request: Request) -> None:
    """Content-Length 가 64KB 를 넘으면 본문을 읽기 전에 413."""
    declared = (request.headers.get("content-length") or "").strip()
    if declared.isdigit() and int(declared) > MAX_EVENT_BODY_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, BODY_TOO_LARGE_MESSAGE)


def event_subject(request: Request, db: Session = Depends(get_db)) -> str | None:
    """선택 인증. 쿠키가 유효하면 subject, 아니면 None. 저장(MongoDB) 동안 DB 연결을 잡지 않게 읽은 뒤 트랜잭션을 끝낸다."""
    try:
        return get_optional_subject(request, db)
    finally:
        db.rollback()


async def _read_body(request: Request) -> bytes:
    """실제 본문을 64KB 까지만 읽는다(Content-Length 가 없거나 틀려도 413).

    본문을 받는 중에 브라우저가 연결을 끊으면(페이지를 닫을 때의 keepalive 전송 등) 서버 오류가 아니라 400 이다.
    아무것도 저장하지 않고, 받을 사람이 없으니 응답은 접근 로그에만 남는다.
    """
    chunks, size = [], 0
    try:
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_EVENT_BODY_BYTES:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, BODY_TOO_LARGE_MESSAGE)
            chunks.append(chunk)
    except ClientDisconnect:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CLIENT_DISCONNECTED_MESSAGE) from None
    return b"".join(chunks)


def _is_json_content_type(value: str | None) -> bool:
    """application/json(·+json)과 text/plain(sendBeacon), 생략을 JSON 으로 받는다."""
    if not value:
        return True
    message = Message()
    message["content-type"] = value
    maintype, subtype = message.get_content_maintype(), message.get_content_subtype()
    if maintype == "application":
        return subtype == "json" or subtype.endswith("+json")
    return maintype == "text" and subtype == "plain"


def _reject_constant(name: str):
    raise ValueError(f"{name} is not valid JSON")


def _invalid(kind: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"type": kind, "loc": ("body",), "msg": message, "input": None}])


def _parse_batch(content_type: str | None, body: bytes) -> EventBatch:
    if not _is_json_content_type(content_type):
        raise _invalid("content_type", "Content-Type 은 application/json 이어야 합니다.")
    try:
        data = json.loads(body, parse_constant=_reject_constant)
    except (ValueError, RecursionError):  # 잘못된 JSON·UTF-8, NaN/Infinity, 너무 깊은 중첩
        raise _invalid("json_invalid", "JSON 형식이 아닙니다.") from None
    try:
        return EventBatch.model_validate(data)
    except ValidationError as exc:
        errors = [{**error, "loc": ("body", *error["loc"])} for error in exc.errors(include_url=False, include_context=False)]
        raise RequestValidationError(errors) from None


def event_document(event: Event, *, subject: str | None, received_at, request_id: str, user_agent: str | None) -> dict:
    """저장 문서 = 요청 필드(schema_version 포함, 없으면 1) + subject·received_at·request_id·user_agent. 경로·referrer 의 비밀값 query 는 지운다."""
    return {
        "event_id": event.event_id,
        "type": event.type,
        "occurred_at": event.occurred_at,
        "session_id": event.session_id,
        "anonymous_id": event.anonymous_id,
        "page": {
            "path": redact_secret_query(event.page.path),
            "referrer": redact_secret_query(event.page.referrer),
        },
        "props": dict(event.props),
        "subject": subject,
        "received_at": received_at,
        "request_id": request_id,
        "user_agent": user_agent,
        "schema_version": event.schema_version,
    }


@router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=EventsAcceptedResponse,
    dependencies=[Depends(require_allowed_origin), Depends(reject_large_content_length)],
)
async def collect_events(
    request: Request,
    subject: str | None = Depends(event_subject),
    store: EventStore = Depends(get_event_store),
):
    """본문 `{events: Event[]}`(1~50개, 64KB 이하). Event 모양은 app/schemas/event.py."""
    batch = _parse_batch(request.headers.get("content-type"), await _read_body(request))
    received_at = clock.utc_now()
    request_id = getattr(request.state, "request_id", None) or uuid4().hex
    user_agent = (request.headers.get("user-agent") or "")[:MAX_USER_AGENT_LENGTH] or None
    documents = [
        event_document(event, subject=subject, received_at=received_at, request_id=request_id, user_agent=user_agent)
        for event in batch.events
    ]
    accepted = await run_in_threadpool(store.save, documents)
    return {"code": status.HTTP_202_ACCEPTED, "message": EVENTS_ACCEPTED_MESSAGE, "result": {"accepted": accepted}}
