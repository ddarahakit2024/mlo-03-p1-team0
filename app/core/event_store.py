"""사용자 이벤트 저장소: MongoDB `events` 컬렉션과 대체 저장. docs/specs/2026-10-30-event-logging.md

- MONGODB_URI 가 있으면 처음 저장할 때 MongoClient 를 만든다(serverSelectionTimeoutMS=MONGODB_TIMEOUT_MS).
- insert_many(ordered=False): 같은 event_id(유일 인덱스, 오류 코드 11000)는 건너뛰고 accepted 에서 뺀다.
- 앱 시작 시 인덱스를 만든다(ensure_indexes). 실패해도 앱은 뜨고 오류 로그만 남긴다. 실패했으면 다음 저장 때 다시 시도한다.
- MongoDB 가 설정되지 않았거나 실패하면 같은 문서를 대체 저장한다: LOG_DIR 이 있으면 LOG_DIR/events-fallback.jsonl,
  없으면 표준 출력의 moa.event 로그. 줄은 MongoDB Extended JSON(relaxed) 이라 나중에
  `mongoimport --db moa --collection events --file events-fallback.jsonl` 로 옮길 수 있다(같은 event_id 는 유일 인덱스가 막는다).
- 접속 실패 뒤 FAILURE_COOLDOWN_SECONDS 동안은 MongoDB 를 부르지 않고 바로 대체 저장한다(요청마다 접속 대기 시간만큼 붙잡히지 않게).
- 읽기는 추천 학습의 상품 조회 이벤트(product_views)뿐이다. 대체 저장으로 돌아가지 않고 EventStoreUnavailable 을 낸다
  (docs/specs/2026-11-03-product-recommendations.md: 관리자 학습 API 가 503 으로 답한다).

테스트는 EventStore(collection=가짜 컬렉션) 이나 client_factory 로 바꿔 넣는다. 실제 MongoDB 에 접속하지 않는다.
"""
import json
import logging
import threading
import time
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from typing import Any

from bson import json_util
from pymongo import ASCENDING, MongoClient
from pymongo.errors import BulkWriteError, ConfigurationError, ConnectionFailure, DuplicateKeyError, PyMongoError

from app.core import config
from app.core.log_files import (
    EVENT_FALLBACK_FILE, attach_daily_file, ensure_stdout_handler, log_file_path, remove_stdout_handler, retention_days,
)

EVENT_LOGGER_NAME = "moa.event"
EVENTS_COLLECTION = "events"
DUPLICATE_KEY_ERROR = 11000
FAILURE_COOLDOWN_SECONDS = 30.0
EVENT_INDEXES = (
    ("event_id_unique", [("event_id", ASCENDING)], {"unique": True}),
    ("type_received_at", [("type", ASCENDING), ("received_at", ASCENDING)], {}),
    ("subject_received_at", [("subject", ASCENDING), ("received_at", ASCENDING)], {}),
    ("session_id_received_at", [("session_id", ASCENDING), ("received_at", ASCENDING)], {}),
    ("anonymous_id_received_at", [("anonymous_id", ASCENDING), ("received_at", ASCENDING)], {}),
)
_JSON_OPTIONS = json_util.RELAXED_JSON_OPTIONS
# 추천 학습이 읽는 필드(session_id, props.product_id)만 가져온다
PRODUCT_VIEW_PROJECTION = {"_id": 0, "session_id": 1, "props.product_id": 1}
EVENT_STORE_NOT_CONFIGURED = "이벤트 저장소(MongoDB)가 설정되지 않아 학습할 수 없습니다."
EVENT_STORE_UNREACHABLE = "이벤트 저장소(MongoDB)에서 이벤트를 읽지 못했습니다. 잠시 후 다시 시도해 주세요."

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- 대체 저장(moa.event)

def _fallback_line(record: logging.LogRecord, *, ensure_ascii: bool) -> str:
    document = getattr(record, "event_document", None)
    if document is not None:
        return json_util.dumps(document, json_options=_JSON_OPTIONS, ensure_ascii=ensure_ascii, separators=(",", ":"))
    return json.dumps({"message": record.getMessage()}, ensure_ascii=ensure_ascii, separators=(",", ":"))


class EventDocumentFormatter(logging.Formatter):
    """events-fallback.jsonl 한 줄 = 저장 문서 하나(Extended JSON relaxed)."""

    def format(self, record: logging.LogRecord) -> str:
        return _fallback_line(record, ensure_ascii=False)


class EventStdoutFormatter(logging.Formatter):
    """표준 출력 한 줄: {"ts","level","logger","event":문서}. 콘솔 인코딩과 상관없게 ASCII 로만 쓴다."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds")
        head = {"ts": ts.replace("+00:00", "Z"), "level": record.levelname, "logger": record.name}
        prefix = json.dumps(head, separators=(",", ":"))[:-1]
        return f'{prefix},"event":{_fallback_line(record, ensure_ascii=True)}}}'


def configure_event_logger(log_dir: str | None = None, retention: int | None = None) -> logging.Logger:
    """moa.event 로거: 폴더가 있으면 events-fallback.jsonl 에만, 없으면 표준 출력에 쓴다. 여러 번 불러도 겹치지 않는다."""
    event_logger = logging.getLogger(EVENT_LOGGER_NAME)
    event_logger.setLevel(logging.INFO)
    event_logger.propagate = False
    handler = attach_daily_file(
        event_logger, log_file_path(EVENT_FALLBACK_FILE, log_dir), retention_days(retention), EventDocumentFormatter(),
    )
    if handler is None:
        ensure_stdout_handler(event_logger, EventStdoutFormatter())
    else:
        remove_stdout_handler(event_logger)
    return event_logger


# ---------------------------------------------------------------- 저장소

class EventStoreUnavailable(RuntimeError):
    """이벤트를 읽을 수 없다(MongoDB 미설정·접속 실패). 메시지는 사용자에게 보여 줄 문구다."""


class EventStore:
    def __init__(
        self,
        uri: str = "",
        db_name: str = "moa",
        timeout_ms: int = 2000,
        *,
        collection: Any = None,
        client_factory: Callable[..., Any] = MongoClient,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._uri = (uri or "").strip()
        self._db_name = db_name
        self._timeout_ms = timeout_ms
        self._injected = collection is not None
        self._collection = collection
        self._client = None
        self._client_factory = client_factory
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._retry_after = 0.0
        self._indexes_ready = False
        self._index_retry_after = 0.0

    @classmethod
    def from_settings(cls, **options) -> "EventStore":
        """MONGODB_URI·MONGODB_DB·MONGODB_TIMEOUT_MS 로 만든다. options 는 client_factory 등(테스트용)."""
        return cls(config.MONGODB_URI, config.MONGODB_DB, config.MONGODB_TIMEOUT_MS, **options)

    @property
    def enabled(self) -> bool:
        """MongoDB 를 쓰도록 설정됐는가(아니면 늘 대체 저장)."""
        return self._injected or bool(self._uri)

    def _get_collection(self):
        if self._collection is not None:
            return self._collection
        with self._lock:
            if self._collection is None:
                self._client = self._client_factory(
                    self._uri,
                    serverSelectionTimeoutMS=self._timeout_ms,
                    connectTimeoutMS=self._timeout_ms,
                    socketTimeoutMS=self._timeout_ms * 5,
                    tz_aware=True,
                    appname="moa-parts-api",
                )
                self._collection = self._client[self._db_name][EVENTS_COLLECTION]
        return self._collection

    def _cooling_down(self) -> bool:
        return self._monotonic() < self._retry_after

    def _failed(self, action: str, exc: BaseException) -> None:
        """접속 실패·설정 오류면 잠시 MongoDB 를 쉬고, 그 밖의 오류는 로그만 남긴다."""
        if isinstance(exc, (ConnectionFailure, ConfigurationError)):
            self._retry_after = self._monotonic() + FAILURE_COOLDOWN_SECONDS
            logger.error("MongoDB %s failed; using the event fallback for %.0f seconds.",
                         action, FAILURE_COOLDOWN_SECONDS, exc_info=exc)
        else:
            logger.error("MongoDB %s failed; using the event fallback.", action, exc_info=exc)

    def ensure_indexes(self) -> bool:
        """event_id 유일 인덱스와 (type|subject|session_id|anonymous_id, received_at) 인덱스. 실패해도 예외를 내지 않는다."""
        if not self.enabled:
            return False
        try:
            collection = self._get_collection()
            for name, keys, options in EVENT_INDEXES:
                collection.create_index(keys, name=name, **options)
        except Exception as exc:  # 인덱스 생성 실패가 앱 시작·요청을 막지 않게 한다
            self._index_retry_after = self._monotonic() + FAILURE_COOLDOWN_SECONDS
            self._failed("index creation", exc)
            return False
        self._indexes_ready = True
        return True

    def save(self, documents: list[dict]) -> int:
        """문서를 저장하고 accepted(새로 저장했거나 대체 저장한 개수)를 돌려준다. 예외를 내지 않는다."""
        if not documents:
            return 0
        if not self.enabled or self._cooling_down():
            return self._fallback(documents)
        if not self._indexes_ready and self._monotonic() >= self._index_retry_after:
            self.ensure_indexes()
            if self._cooling_down():
                return self._fallback(documents)
        try:
            collection = self._get_collection()
            result = collection.insert_many([dict(document) for document in documents], ordered=False)
            return len(result.inserted_ids)
        except BulkWriteError as exc:
            return self._partial(exc.details or {}, documents)
        except DuplicateKeyError:
            return self._insert_one_by_one(collection, documents)
        except Exception as exc:
            self._failed("insert", exc)
            return self._fallback(documents)

    def _partial(self, details: dict, documents: list[dict]) -> int:
        """같은 event_id(11000)는 건너뛰고, 다른 이유로 거절된 문서만 대체 저장한다."""
        rejected = []
        for error in details.get("writeErrors") or []:
            index = error.get("index")
            if error.get("code") != DUPLICATE_KEY_ERROR and isinstance(index, int) and 0 <= index < len(documents):
                rejected.append(documents[index])
        if rejected:
            logger.error("MongoDB rejected %d event(s); writing them to the event fallback.", len(rejected))
            self._fallback(rejected)
        return int(details.get("nInserted") or 0) + len(rejected)

    def _insert_one_by_one(self, collection, documents: list[dict]) -> int:
        accepted = 0
        for position, document in enumerate(documents):
            try:
                collection.insert_one(dict(document))
            except DuplicateKeyError:
                continue
            except Exception as exc:
                self._failed("insert", exc)
                return accepted + self._fallback(documents[position:])
            accepted += 1
        return accepted

    # ------------------------------------------------------------ 읽기(추천 학습)

    def product_views(self, since: datetime | None = None) -> Iterator[tuple[str, int]]:
        """상품 조회 이벤트의 (session_id, product_id). docs/specs/2026-11-03-product-recommendations.md "학습"

        type_received_at 인덱스를 타는 쿼리로 session_id·props.product_id 만 읽는다. since 가 있으면 received_at >= since.
        모양이 틀린 문서(session_id 가 문자열이 아니거나 product_id 가 정수가 아닌 것, 불리언 포함)는 건너뛴다.
        읽기는 대체 저장(events-fallback.jsonl)으로 돌아가지 않는다: MongoDB 가 설정되지 않았거나 접속·읽기에 실패하면
        EventStoreUnavailable(라우터가 503 으로 바꾼다). 반복하는 동안의 실패도 같은 예외다.
        """
        if not self.enabled:
            raise EventStoreUnavailable(EVENT_STORE_NOT_CONFIGURED)
        query: dict[str, Any] = {"type": "product_view"}
        if since is not None:
            query["received_at"] = {"$gte": since}
        try:
            cursor = self._get_collection().find(query, PRODUCT_VIEW_PROJECTION)
        except PyMongoError as exc:
            logger.error("MongoDB read for recommendation training failed.", exc_info=exc)
            raise EventStoreUnavailable(EVENT_STORE_UNREACHABLE) from exc
        return self._product_view_pairs(cursor)

    @staticmethod
    def _product_view_pairs(cursor) -> Iterator[tuple[str, int]]:
        try:
            for document in cursor:
                session_id = document.get("session_id")
                props = document.get("props")
                product_id = props.get("product_id") if isinstance(props, dict) else None
                if not isinstance(session_id, str) or not session_id:
                    continue
                if type(product_id) is not int:  # bool·실수·문자열은 버린다
                    continue
                yield session_id, product_id
        except PyMongoError as exc:
            logger.error("MongoDB read for recommendation training failed.", exc_info=exc)
            raise EventStoreUnavailable(EVENT_STORE_UNREACHABLE) from exc

    def _fallback(self, documents: list[dict]) -> int:
        event_logger = logging.getLogger(EVENT_LOGGER_NAME)
        if not event_logger.handlers:
            configure_event_logger()
        for document in documents:
            event_logger.info("event fallback", extra={"event_document": document})
        return len(documents)

    def close(self) -> None:
        """앱 종료 시 MongoClient 를 닫는다. 바꿔 넣은 컬렉션은 그대로 둔다."""
        with self._lock:
            client, self._client = self._client, None
            if not self._injected:
                self._collection = None
        if client is not None:
            client.close()
