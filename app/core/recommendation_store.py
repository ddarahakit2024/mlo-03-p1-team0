"""추천 모델 저장과 서빙(상품 상세 추천·관리자 순위 비교 공용). docs/specs/2026-11-03-product-recommendations.md

- save_model: 모델 기록 1행 + 상품마다 추천 행을 한 트랜잭션으로 넣고, 최근 KEEP_MODELS 개보다 오래된 모델과
  그 추천 행을 같은 트랜잭션에서 지운다. 버전은 itemcf-<id>(id 를 얻으려고 임시 버전으로 넣은 뒤 바꾼다).
- ranking: 한 상품의 추천 순위. 모델이 있으면 그 모델의 순위, 없으면 기본 점수(같은 카테고리·비슷한 가격).
  자기 자신·출시 전·재고 0 상품은 빼고, 모자라면 기본 점수 순으로 채운다. rank 는 뺀 뒤의 자리(1 부터)다.
  채운 항목의 점수는 기본 점수로 계산한 값이고 co_sessions 는 0 이다.
"""
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session, load_only

from app.core import clock
from app.core import recommendations as itemcf
from app.core.product_release import released
from app.models import Product, ProductRecommendation, RecommendationModel

KEEP_MODELS = 5  # 남기는 최근 모델 수
REASON_CO_VIEW = "co_view"  # 함께 본 세션이 있다
REASON_SIMILAR = "similar"  # 같은 카테고리·비슷한 가격(기본 점수)
# 서빙에서 읽는 상품 컬럼(목록 API 의 ProductSummary 와 같다. 긴 description·specs 는 읽지 않는다)
SUMMARY_FIELDS = (
    "id", "name", "brand", "category", "price_krw", "stock", "thumbnail_url", "summary",
    "released_on", "performance_score",
)


@dataclass
class RankedItem:
    rank: int
    product: Product
    score: float
    cf_score: float
    base_score: float
    co_sessions: int

    @property
    def reason(self) -> str:
        return REASON_CO_VIEW if self.co_sessions > 0 else REASON_SIMILAR


# ---------------------------------------------------------------- 학습 입력·저장

def catalog_items(db: Session) -> list[itemcf.CatalogItem]:
    """학습에 쓰는 출시된 상품(id·카테고리·판매가). 재고 0 상품도 넣는다(서빙에서 뺀다)."""
    rows = db.execute(
        select(Product.id, Product.category, Product.price_krw).where(released()).order_by(Product.id)
    ).all()
    return [itemcf.CatalogItem(product_id, category, price) for product_id, category, price in rows]


def save_model(
    db: Session,
    result: itemcf.TrainingResult,
    *,
    trained_by: str,
    events_since: datetime | None,
    duration_ms: int,
) -> int:
    """학습 결과를 저장하고 새 모델 id 를 돌려준다. 실패하면 롤백하고 예외를 그대로 낸다.

    추천 행의 외래 키 확인은 상품 행을 공유 잠금한다. 주문 확인·반품 승인처럼 상품 id 순서로 먼저 잠가
    (LOCK IN SHARE MODE) 서로 교착하지 않게 한다. 부르기 전에 읽기 스냅샷을 닫아 둔다(end_read_snapshot)."""
    try:
        product_ids: set[int] = set()
        for product_id, product_rows in result.recommendations.items():
            if product_rows:
                product_ids.add(product_id)
                product_ids.update(row["recommended_product_id"] for row in product_rows)
        if product_ids:
            db.execute(
                select(Product.id).where(Product.id.in_(sorted(product_ids))).order_by(Product.id)
                .with_for_update(read=True)
            )
        model = RecommendationModel(
            version=f"pending-{uuid4().hex}",  # 40자. id 를 얻은 뒤 itemcf-<id> 로 바꾼다
            algorithm=itemcf.ALGORITHM,
            trained_by=trained_by,
            events_since=events_since,
            event_count=result.event_count,
            session_count=result.session_count,
            product_count=result.product_count,
            pair_count=result.pair_count,
            params=dict(result.params),
            duration_ms=duration_ms,
        )
        db.add(model)
        db.flush()
        model_id = model.id
        model.version = f"{itemcf.VERSION_PREFIX}{model_id}"
        rows = [
            {"model_id": model_id, "product_id": product_id, **row}
            for product_id, product_rows in sorted(result.recommendations.items())
            for row in product_rows
        ]
        if rows:
            db.execute(insert(ProductRecommendation), rows)
        old_ids = db.scalars(
            select(RecommendationModel.id).order_by(RecommendationModel.id.desc()).offset(KEEP_MODELS)
        ).all()
        if old_ids:
            db.execute(delete(ProductRecommendation).where(ProductRecommendation.model_id.in_(old_ids)))
            db.execute(delete(RecommendationModel).where(RecommendationModel.id.in_(old_ids)))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return model_id


# ---------------------------------------------------------------- 모델 기록

def latest_models(db: Session, count: int = KEEP_MODELS) -> list[RecommendationModel]:
    """최근 모델(최신 먼저, id 내림차순). 가상 시계를 되돌려도 순서가 바뀌지 않게 trained_at 이 아니라 id 로 정한다."""
    return list(db.scalars(select(RecommendationModel).order_by(RecommendationModel.id.desc()).limit(count)))


def model_reference(model: RecommendationModel | None) -> dict | None:
    """응답의 model: {version, trained_at} 또는 null(기본 추천)."""
    if model is None:
        return None
    return {"version": model.version, "trained_at": clock.as_utc(model.trained_at)}


def model_summary(model: RecommendationModel) -> dict:
    """학습 응답·학습 기록 항목(학습한 관리자 subject 는 넣지 않는다)."""
    return {
        "id": model.id,
        "version": model.version,
        "algorithm": model.algorithm,
        "trained_at": clock.as_utc(model.trained_at),
        "events_since": clock.as_utc(model.events_since),
        "event_count": model.event_count,
        "session_count": model.session_count,
        "product_count": model.product_count,
        "pair_count": model.pair_count,
        "params": model.params,
        "duration_ms": model.duration_ms,
    }


# ---------------------------------------------------------------- 서빙

def _servable(db: Session, *conditions) -> list[Product]:
    """추천에 보여 줄 수 있는 상품: 출시됨·재고 1 이상. 목록 응답 컬럼만 읽는다."""
    summary_columns = [getattr(Product, name) for name in SUMMARY_FIELDS]
    return list(db.scalars(
        select(Product).options(load_only(*summary_columns)).where(released(), Product.stock > 0, *conditions)
    ))


def ranking(db: Session, product: Product, model: RecommendationModel | None, limit: int) -> list[RankedItem]:
    """product 의 추천 limit 개. 모델 순위(있으면) → 기본 점수 채우기 순서."""
    picked: list[tuple[Product, float, float, float, int]] = []
    if model is not None:
        rows = db.scalars(
            select(ProductRecommendation)
            .where(ProductRecommendation.model_id == model.id, ProductRecommendation.product_id == product.id)
            .order_by(ProductRecommendation.rank)
        ).all()
        ids = [row.recommended_product_id for row in rows if row.recommended_product_id != product.id]
        servable = {item.id: item for item in _servable(db, Product.id.in_(ids))} if ids else {}
        for row in rows:
            item = servable.get(row.recommended_product_id)
            if item is not None:
                picked.append((item, row.score, row.cf_score, row.base_score, row.co_sessions))
            if len(picked) >= limit:
                break
    if len(picked) < limit:
        chosen = {item.id for item, *_scores in picked} | {product.id}
        candidates = {
            item.id: item for item in _servable(db, Product.category == product.category, Product.id.not_in(chosen))
        }
        source = itemcf.CatalogItem(product.id, product.category, product.price_krw)
        fills = itemcf.baseline_ranking(
            source,
            [itemcf.CatalogItem(item.id, item.category, item.price_krw) for item in candidates.values()],
            limit - len(picked),
        )
        for row in fills:
            picked.append((
                candidates[row["recommended_product_id"]], row["score"], row["cf_score"], row["base_score"], 0,
            ))
    return [
        RankedItem(rank, item, score, cf_score, base_score, co_sessions)
        for rank, (item, score, cf_score, base_score, co_sessions) in enumerate(picked[:limit], start=1)
    ]
