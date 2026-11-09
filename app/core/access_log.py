"""FastAPI 요청 로그(JSON Lines)와 X-Request-ID.

요청마다 logger `moa.access` 로 JSON 한 줄을 남긴다. 표준 출력에는 항상, LOG_DIR 이 있으면
LOG_DIR/access.jsonl 에도 쓴다(매일 UTC 자정 회전, LOG_RETENTION_DAYS 개 보관. app/core/log_files.py).
쿠키·Authorization 헤더·요청 본문·비밀값 query 는 남기지 않는다(docs/roadmap.md 데이터 원칙).
client_ip 와 X-Request-ID 재사용은 신뢰 프록시(TRUSTED_PROXY_IPS)에서 온 요청만 헤더를 믿는다(app/core/trusted_proxy.py).
필드 이름은 바꾸지 않고 추가만 한다.
"""
import json
import logging
import re
import time
from collections.abc import Callable
from uuid import uuid4

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core import clock, trusted_proxy
from app.core.log_files import ACCESS_LOG_FILE, attach_daily_file, ensure_stdout_handler, log_file_path, retention_days
from app.core.secret_query import SECRET_QUERY_KEYS, is_secret_key
from app.core.security import access_token_subject
from app.core.session import ACCESS_TOKEN_COOKIE

__all__ = [
    "ACCESS_LOGGER_NAME", "REQUEST_ID_HEADER", "SECRET_QUERY_KEYS", "AccessLogMiddleware", "JsonLineFormatter",
    "client_ip", "configure_access_logger", "request_id_from", "safe_query", "token_subject",
]

ACCESS_LOGGER_NAME = "moa.access"
REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9-]{1,64}")


class JsonLineFormatter(logging.Formatter):
    """레코드의 `access` 필드를 ts, level, logger 다음에 붙여 JSON 한 줄로 만든다."""

    def format(self, record: logging.LogRecord) -> str:
        fields = getattr(record, "access", None)
        if fields is None:
            fields = {"ts": _iso(clock.utc_now()), "message": record.getMessage()}
        payload = {"ts": fields.get("ts"), "level": record.levelname, "logger": record.name}
        payload.update((key, value) for key, value in fields.items() if key != "ts")
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)


def configure_access_logger(log_dir: str | None = None, retention: int | None = None) -> logging.Logger:
    """moa.access 로거에 표준 출력과(폴더가 있으면) access.jsonl 핸들러를 단다. 여러 번 불러도 겹치지 않는다.

    log_dir 를 주지 않으면 설정(LOG_DIR), retention 을 주지 않으면 LOG_RETENTION_DAYS 를 쓴다.
    빈 문자열이면 파일 없이 표준 출력만.
    """
    logger = logging.getLogger(ACCESS_LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = False  # uvicorn·루트 로거와 겹쳐 두 번 찍히지 않게 한다
    formatter = JsonLineFormatter()
    ensure_stdout_handler(logger, formatter)
    attach_daily_file(logger, log_file_path(ACCESS_LOG_FILE, log_dir), retention_days(retention), formatter)
    return logger


def _iso(value) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request_id_from(headers, trusted: bool = False) -> str:
    """신뢰 프록시에서 온 요청(trusted)의 X-Request-ID 가 1~64자 [A-Za-z0-9-] 이면 그대로, 아니면 새 uuid4 hex."""
    incoming = headers.get(REQUEST_ID_HEADER) if trusted else None
    if incoming is not None and _REQUEST_ID_PATTERN.fullmatch(incoming):
        return incoming
    return uuid4().hex


def safe_query(request: Request) -> dict[str, str | list[str]]:
    """비밀값 키를 뺀 query. 같은 키가 여러 번 오면 값 목록."""
    result: dict[str, str | list[str]] = {}
    for key, value in request.query_params.multi_items():
        if is_secret_key(key):
            continue
        if key not in result:
            result[key] = value
        elif isinstance(result[key], list):
            result[key].append(value)
        else:
            result[key] = [result[key], value]
    return result


def token_subject(request: Request) -> str | None:
    """서명·만료가 유효한 access_token 쿠키의 sub. 계정 존재 여부는 확인하지 않는다(로그 때문에 DB 를 부르지 않는다)."""
    return access_token_subject(request.cookies.get(ACCESS_TOKEN_COOKIE))


def client_ip(request: Request) -> str | None:
    """접속 주소. 신뢰 프록시에서 온 요청만 X-Forwarded-For 의 클라이언트 주소(app/core/trusted_proxy.py)."""
    return trusted_proxy.client_address(request.scope, request.headers)


class AccessLogMiddleware:
    """요청마다 JSON 한 줄을 남기고 응답에 X-Request-ID 를 붙인다.

    가장 바깥 사용자 미들웨어로 단다(CORS 사전 요청까지 기록). 처리 중 예외가 나면 error_response 로 500 을
    직접 보내 X-Request-ID 를 붙이고, 예외는 다시 던져 서버가 traceback 을 남기게 한다.
    """

    def __init__(self, app: ASGIApp, error_response: Callable[[], Response] | None = None) -> None:
        self.app = app
        self.error_response = error_response
        self.logger = logging.getLogger(ACCESS_LOGGER_NAME)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started_at = clock.utc_now()
        started = time.perf_counter()
        request = Request(scope)
        request_id = request_id_from(request.headers, trusted=trusted_proxy.is_trusted_peer(scope))
        # 앱 코드가 request.state.request_id 로 같은 값을 쓸 수 있다(이벤트 로그 연결용).
        scope.setdefault("state", {})["request_id"] = request_id
        status: dict[str, int | None] = {"code": None}

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            if status["code"] is None and self.error_response is not None:
                await self.error_response()(scope, receive, send_with_request_id)
            raise
        finally:
            code = status["code"] or 500
            self._write(request, scope, request_id, started_at, started, code)

    def _write(self, request: Request, scope: Scope, request_id: str, started_at, started: float, code: int) -> None:
        try:
            route = getattr(scope.get("route"), "path", None)
            fields = {
                "ts": _iso(started_at),
                "request_id": request_id,
                "method": scope["method"],
                "path": scope["path"],
                "route": route if isinstance(route, str) else None,
                "query": safe_query(request),
                "status": code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "subject": token_subject(request),
                "client_ip": client_ip(request),
                "user_agent": request.headers.get("user-agent") or None,
            }
            level = logging.ERROR if code >= 500 else logging.INFO
            self.logger.log(level, "%s %s %s", fields["method"], fields["path"], code, extra={"access": fields})
        except Exception:  # 로그 실패가 응답을 망치지 않게 한다
            logging.getLogger(__name__).exception("Failed to write the access log line.")
