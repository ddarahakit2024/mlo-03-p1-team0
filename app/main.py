import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import models  # noqa: F401 - 모든 ORM 모델을 Base.metadata 에 등록한다(create_all 대상)
from app.api.routers import (
    admin_recommendations, admin_returns, alerts, auth, cart, community, compatibility, events, kakao_auth,
    notifications, orders, products, question_answers, questions, returns, reviews, users,
)
from app.core.access_log import REQUEST_ID_HEADER, AccessLogMiddleware, configure_access_logger
from app.core.config import FRONTEND_ORIGINS
from app.core.event_store import EventStore, configure_event_logger
from app.core.log_files import configure_uvicorn_file_logs
from app.db.database import Base, SessionLocal, get_db, session_dependency

API_TITLE = "MOA Parts API"
INTERNAL_ERROR_MESSAGE = "서버 내부 오류가 발생했습니다."
DB_BUSY_MESSAGE = "요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
logger = logging.getLogger(__name__)


def _internal_error_response() -> JSONResponse:
    return JSONResponse(status_code=500, content={"code": 500, "message": INTERNAL_ERROR_MESSAGE, "result": None})


def configure_logging(log_dir: str | None = None, retention: int | None = None) -> None:
    """요청 로그(moa.access)·uvicorn 로그·이벤트 대체 저장(moa.event)의 출력 대상을 정한다. 여러 번 불러도 같다.

    log_dir·retention 을 주지 않으면 설정(LOG_DIR, LOG_RETENTION_DAYS). 빈 폴더면 표준 출력만.
    """
    configure_access_logger(log_dir, retention)
    configure_uvicorn_file_logs(log_dir, retention)
    configure_event_logger(log_dir, retention)


def create_app(session_factory=SessionLocal, create_schema: bool = True, event_store: EventStore | None = None) -> FastAPI:
    store = EventStore.from_settings() if event_store is None else event_store

    @asynccontextmanager
    async def lifespan(_application):
        # uvicorn 이 로깅을 다시 설정해 파일 핸들러가 떨어졌어도 다시 붙인다(이미 있으면 그대로).
        configure_logging()
        if create_schema:
            Base.metadata.create_all(bind=session_factory.kw["bind"])
        if store.enabled:
            await run_in_threadpool(store.ensure_indexes)  # 실패해도 앱은 뜬다(오류 로그만)
        try:
            yield
        finally:
            store.close()

    application = FastAPI(title=API_TITLE, lifespan=lifespan)
    application.state.event_store = store
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(FRONTEND_ORIGINS),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    # 마지막에 추가한 미들웨어가 가장 바깥이다. CORS 사전 요청과 500 까지 요청 로그를 남긴다.
    configure_logging()
    application.add_middleware(AccessLogMiddleware, error_response=_internal_error_response)

    @application.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.status_code, "message": str(exc.detail), "result": None},
            headers=exc.headers,
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"code": 422, "message": "요청 값이 올바르지 않습니다.", "result": None},
        )

    @application.exception_handler(PoolTimeoutError)
    async def pool_timeout_handler(_request: Request, _exc: PoolTimeoutError):
        # DB_POOL_TIMEOUT 초를 기다려도 연결이 나지 않았다(DB_POOL_SIZE + DB_MAX_OVERFLOW 개가 모두 사용 중).
        # 서버 고장이 아니라 일시적인 과부하이므로 503. 요청 로그에도 503 으로 남는다.
        logger.warning("DB connection pool exhausted: no connection within DB_POOL_TIMEOUT.")
        return JSONResponse(status_code=503, content={"code": 503, "message": DB_BUSY_MESSAGE, "result": None})

    @application.exception_handler(Exception)
    async def internal_error_handler(_request: Request, _exc: Exception):
        return _internal_error_response()

    application.include_router(users.router)
    application.include_router(auth.router)
    application.include_router(kakao_auth.router)
    application.include_router(products.router)
    application.include_router(reviews.router)
    application.include_router(cart.router)
    application.include_router(orders.router)
    application.include_router(returns.router)
    application.include_router(admin_returns.router)
    application.include_router(admin_recommendations.router)
    application.include_router(questions.router)
    application.include_router(question_answers.router)
    application.include_router(community.router)
    application.include_router(compatibility.router)
    application.include_router(events.router)
    application.include_router(alerts.router)
    application.include_router(notifications.router)
    if session_factory is not SessionLocal:
        application.dependency_overrides[get_db] = session_dependency(session_factory)
    return application


app = create_app()
