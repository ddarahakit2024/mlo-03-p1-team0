"""LOG_DIR 아래 날짜별 로그 파일과 uvicorn 로그.

LOG_DIR 이 있으면 그 폴더에 쓴다(매일 UTC 자정 회전, LOG_RETENTION_DAYS 개 보관). 표준 출력은 그대로 둔다.
- access.jsonl: 요청 로그(moa.access, app/core/access_log.py)
- uvicorn-access.log, uvicorn-error.log: uvicorn 이 만든 `uvicorn.access`·`uvicorn.error` 로거에 파일 핸들러를 더한다
- events-fallback.jsonl: MongoDB 대체 저장(moa.event, app/core/event_store.py)

핸들러는 표식(_MOA_HANDLER)으로 찾아 바꾸므로 여러 번 불러도 겹치지 않고, 다른 핸들러(uvicorn 의 표준 출력 등)는 건드리지 않는다.
"""
import logging
import sys
import time
from datetime import datetime, timezone
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from app.core import config
from app.core.secret_query import redact_secret_query

ACCESS_LOG_FILE = "access.jsonl"
EVENT_FALLBACK_FILE = "events-fallback.jsonl"
UVICORN_LOG_FILES = {"uvicorn.access": "uvicorn-access.log", "uvicorn.error": "uvicorn-error.log"}
UVICORN_FILE_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"
_MOA_HANDLER = "_moa_handler"

logger = logging.getLogger(__name__)


class SafeTimedRotatingFileHandler(TimedRotatingFileHandler):
    """회전(이름 바꾸기·옛 파일 지우기)이 실패해도 예외 없이 지금 파일에 계속 쓴다.

    Windows 는 다른 프로세스(워커, 로그 뷰어)가 연 파일의 이름을 바꿀 수 없다. 표준 핸들러는 그때 기록을 잃고
    다음 기록마다 회전을 다시 시도한다. 여기서는 다음 자정에 다시 시도한다. 다른 프로세스가 이미 회전했으면
    새 파일을 다시 연다.
    """

    def doRollover(self) -> None:
        now = int(time.time())
        try:
            super().doRollover()
        except OSError as exc:
            logger.warning("Log rotation failed for %s; keep writing to the current file (%s).", self.baseFilename, exc)
        if self.rolloverAt <= now:
            if self.stream:
                self.stream.close()
                self.stream = None  # delay=True 라 다음 기록이 baseFilename 을 다시 연다
            self.rolloverAt = self.computeRollover(now)


class _StdoutHandler(logging.StreamHandler):
    """쓸 때마다 현재 sys.stdout 을 찾는다(테스트 출력 캡처가 바뀌어도 닫힌 스트림에 쓰지 않는다)."""

    def __init__(self) -> None:
        super().__init__(sys.stdout)

    @property
    def stream(self):
        return sys.stdout

    @stream.setter
    def stream(self, _value) -> None:
        pass


class UtcTextFormatter(logging.Formatter):
    """uvicorn 파일 로그 한 줄: `2026-10-30T03:00:00.000Z INFO uvicorn.access 1.2.3.4:5 - "GET / HTTP/1.1" 200`."""

    def __init__(self) -> None:
        super().__init__(UVICORN_FILE_FORMAT)

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        moment = datetime.fromtimestamp(record.created, timezone.utc)
        return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class RedactUvicornAccessQuery(logging.Filter):
    """uvicorn.access 기록의 경로에서 비밀값 query 값을 지운다(표준 출력·파일 모두에 적용된다)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
            record.args = (args[0], args[1], redact_secret_query(args[2]), args[3], args[4])
        return True


def retention_days(value: int | None = None) -> int:
    return max(1, int(config.LOG_RETENTION_DAYS if value is None else value))


def log_file_path(file_name: str, log_dir: str | None = None) -> Path | None:
    """LOG_DIR(또는 log_dir) 안의 파일 경로. 폴더가 비어 있으면 None(파일을 쓰지 않는다)."""
    directory = (config.LOG_DIR if log_dir is None else log_dir).strip()
    return Path(directory) / file_name if directory else None


def _ours(target: logging.Logger, kind: type) -> list[logging.Handler]:
    return [h for h in target.handlers if getattr(h, _MOA_HANDLER, False) and type(h) is kind]


def attach_daily_file(target: logging.Logger, path: Path | None, retention: int,
                      formatter: logging.Formatter) -> logging.Handler | None:
    """target 로거에 날짜별 파일 핸들러를 하나만 둔다. 같은 경로·보관 개수면 그대로, 다르면 바꾸고, path 가 None 이면 뗀다."""
    wanted = str(path.resolve()) if path is not None else None
    kept = None
    for handler in _ours(target, SafeTimedRotatingFileHandler):
        if kept is None and handler.baseFilename == wanted and handler.backupCount == retention:
            kept = handler
            continue
        target.removeHandler(handler)
        handler.close()
    if kept is None and wanted is not None:
        try:
            Path(wanted).parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            logger.exception("Cannot create the log directory for %s; logging to stdout only.", wanted)
            return None
        kept = SafeTimedRotatingFileHandler(
            wanted, when="midnight", backupCount=retention, encoding="utf-8", utc=True, delay=True,
        )
        setattr(kept, _MOA_HANDLER, True)
        target.addHandler(kept)
    if kept is not None:
        kept.setFormatter(formatter)
    return kept


def ensure_stdout_handler(target: logging.Logger, formatter: logging.Formatter) -> logging.Handler:
    """target 로거에 표준 출력 핸들러를 하나만 둔다."""
    handlers = _ours(target, _StdoutHandler)
    for extra in handlers[1:]:
        target.removeHandler(extra)
    if handlers:
        handler = handlers[0]
    else:
        handler = _StdoutHandler()
        setattr(handler, _MOA_HANDLER, True)
        target.addHandler(handler)
    handler.setFormatter(formatter)
    return handler


def remove_stdout_handler(target: logging.Logger) -> None:
    for handler in _ours(target, _StdoutHandler):
        target.removeHandler(handler)


def configure_uvicorn_file_logs(log_dir: str | None = None, retention: int | None = None) -> None:
    """uvicorn.access·uvicorn.error 로거에 LOG_DIR 의 날짜별 파일 핸들러를 더한다(uvicorn 의 표준 출력 핸들러는 그대로).

    uvicorn 은 앱을 import 하기 전에 로깅을 설정하므로 create_app 과 앱 시작(lifespan) 때 부르면 붙어 있다.
    """
    keep = retention_days(retention)
    for logger_name, file_name in UVICORN_LOG_FILES.items():
        attach_daily_file(logging.getLogger(logger_name), log_file_path(file_name, log_dir), keep, UtcTextFormatter())
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, RedactUvicornAccessQuery) for item in access_logger.filters):
        access_logger.addFilter(RedactUvicornAccessQuery())
