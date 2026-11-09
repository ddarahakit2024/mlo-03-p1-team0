"""관리자 추천 학습. docs/specs/2026-11-03-product-recommendations.md 의 API 계약.

POST /admin/recommendations/train                 학습(201). MongoDB 상품 조회 이벤트 → Item-CF → 상품마다 추천 20개 저장
GET  /admin/recommendations/models                학습 기록(server_time + 최근 모델 5개, 최신 먼저)
GET  /admin/recommendations/products/{product_id} 상품별 순위 비교(current = 최신 모델, previous = 그 전 모델·기본 추천·null)

관리자는 app/core/session.py 의 get_admin_subject(비로그인 401, 관리자 아님 403). 학습은 상태를 바꾸므로 Origin 검사를 붙인다.

학습 순서: since 검사(422) → 프로세스 잠금(이미 학습 중이면 409) → 출시된 상품 읽기 → 읽기 트랜잭션 끝내기
→ MongoDB 읽기·학습(이 동안 DB 연결을 잡지 않는다. 저장소 없음·연결 실패 503) → 모델·추천 행 저장(한 트랜잭션).
경로 함수가 일반 def 라 스레드 풀에서 돈다(이벤트 루프를 막지 않는다). 잠금은 한 프로세스 안에서만 하나를 보장한다.
"""
import logging
import threading
import time
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_event_store, require_allowed_origin
from app.api.routers.products import get_product_or_404
from app.core import clock
from app.core import recommendation_store as store
from app.core import recommendations as itemcf
from app.core.event_store import EventStore, EventStoreUnavailable
from app.core.session import get_admin_subject
from app.db.database import end_read_snapshot
from app.models import Product, RecommendationModel
from app.schemas.product import MAX_ID
from app.schemas.recommendation import (
    ModelListResponse, RecommendationCompareResponse, TrainRequest, TrainResponse,
)

router = APIRouter(prefix="/admin/recommendations", tags=["admin"])
logger = logging.getLogger(__name__)

TRAINING_IN_PROGRESS = "추천 학습이 이미 진행 중입니다. 끝난 뒤 다시 시도해 주세요."
SINCE_IN_FUTURE = "학습 시작 시각은 지금보다 미래일 수 없습니다."
# 한 프로세스에서 학습은 한 번에 하나. 기다리지 않고(blocking=False) 바로 409 로 답한다
TRAIN_LOCK = threading.Lock()


def _envelope(result, message: str, code: int = status.HTTP_200_OK):
    return {"code": code, "message": message, "result": result}


@router.post(
    "/train",
    status_code=status.HTTP_201_CREATED,
    response_model=TrainResponse,
    dependencies=[Depends(require_allowed_origin)],
)
def train_model(
    payload: Annotated[TrainRequest | None, Body()] = None,
    admin: str = Depends(get_admin_subject),
    db: Session = Depends(get_db),
    event_store: EventStore = Depends(get_event_store),
):
    """본문 {"since": ISO 8601(시간대 포함) | null}. 본문이 없으면 전체 기간."""
    since = payload.since if payload is not None else None
    if since is not None and since > clock.utc_now():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, SINCE_IN_FUTURE)
    if not TRAIN_LOCK.acquire(blocking=False):
        raise HTTPException(status.HTTP_409_CONFLICT, TRAINING_IN_PROGRESS)
    try:
        started = time.perf_counter()
        products = store.catalog_items(db)
        # MongoDB 를 읽고 학습하는 동안 DB 트랜잭션·연결을 잡고 있지 않는다(저장은 새 트랜잭션에서 상품 행부터 잠근다)
        end_read_snapshot(db)
        try:
            result = itemcf.train(event_store.product_views(since), products)
        except EventStoreUnavailable as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
        duration_ms = round((time.perf_counter() - started) * 1000)
        model_id = store.save_model(db, result, trained_by=admin, events_since=since, duration_ms=duration_ms)
    finally:
        TRAIN_LOCK.release()
    logger.info("Recommendation model %s trained by an admin: %d events, %d sessions.",
                model_id, result.event_count, result.session_count)
    return _envelope(
        store.model_summary(db.get(RecommendationModel, model_id)), "추천 모델을 학습했습니다.",
        status.HTTP_201_CREATED,
    )


@router.get("/models", response_model=ModelListResponse)
def list_models(_admin: str = Depends(get_admin_subject), db: Session = Depends(get_db)):
    return _envelope(
        {
            "server_time": clock.utc_now(),
            "items": [store.model_summary(model) for model in store.latest_models(db)],
        },
        "추천 학습 기록을 조회했습니다.",
    )


def _compare_ranking(db: Session, product: Product, model: RecommendationModel | None, limit: int) -> dict:
    return {
        "model": store.model_reference(model),
        "items": [
            {
                "rank": item.rank, "product_id": item.product.id, "name": item.product.name,
                "price_krw": item.product.price_krw, "score": item.score, "cf_score": item.cf_score,
                "base_score": item.base_score, "co_sessions": item.co_sessions, "reason": item.reason,
            }
            for item in store.ranking(db, product, model, limit)
        ],
    }


@router.get("/products/{product_id}", response_model=RecommendationCompareResponse)
def compare_product(
    product_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
    _admin: str = Depends(get_admin_subject),
    db: Session = Depends(get_db),
):
    """current = 최신 모델(없으면 기본 추천). previous = 그 전 모델(모델이 1개면 기본 추천, 0개면 null)."""
    product = get_product_or_404(db, product_id)
    models = store.latest_models(db, 2)
    current_model = models[0] if models else None
    if not models:
        previous = None
    else:
        previous = _compare_ranking(db, product, models[1] if len(models) > 1 else None, limit)
    return _envelope(
        {
            "product": {
                "id": product.id, "name": product.name, "category": product.category, "price_krw": product.price_krw,
            },
            "current": _compare_ranking(db, product, current_model, limit),
            "previous": previous,
        },
        "상품별 추천 순위를 조회했습니다.",
    )
