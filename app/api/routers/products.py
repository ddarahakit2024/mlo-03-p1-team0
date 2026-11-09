from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, load_only

from app.api.deps import get_db, require_allowed_origin
from app.core import clock, price_trends, pricing, product_metrics
from app.core import recommendation_store
from app.core.product_release import released
from app.core.session import get_current_subject
from app.db.database import end_read_snapshot
from app.models import PriceMatchRequest, Product, ProductPriceHistory, ProductReview
from app.models.price_alert import PRICE_MATCH_REQUESTED
from app.schemas.alert import PriceMatchResponse
from app.schemas.product import (
    MAX_ID, PriceHistoryResponse, PriceSummaryResponse, ProductCategory, ProductDetailResponse,
    ProductFacetsResponse, ProductPageResponse, ProductSort,
)
from app.schemas.recommendation import ProductRecommendationsResponse

router = APIRouter(prefix="/products", tags=["products"])

PRODUCT_NOT_FOUND = "상품을 찾을 수 없습니다."
INVALID_REQUEST = "요청 값이 올바르지 않습니다."
ALREADY_LOWEST = "이미 MOA Parts 가 가장 저렴한 상품입니다."
MAX_PRICE_FILTER = 100_000_000

_ORDERINGS = {
    "recommended": (Product.display_order.asc(), Product.id.asc()),
    "price_asc": (Product.price_krw.asc(), Product.id.asc()),
    "price_desc": (Product.price_krw.desc(), Product.id.asc()),
    "newest": (Product.released_on.desc(), Product.id.desc()),
}
_SUMMARY_FIELDS = (
    "id", "name", "brand", "category", "price_krw", "stock", "thumbnail_url", "summary",
    "released_on", "performance_score",
)


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def get_product_or_404(db: Session, product_id: int) -> Product:
    """출시된 상품. 없거나 출시 전이면 404(출시 전 상품은 없는 상품처럼 다룬다)."""
    product = db.scalars(select(Product).where(Product.id == product_id, released())).first()
    if product is None:
        raise HTTPException(404, PRODUCT_NOT_FOUND)
    return product


def rating_stats(db: Session, product_ids: list[int]) -> dict[int, tuple[float | None, int]]:
    """상품마다 (평균 평점, 리뷰 수). 리뷰가 없는 상품은 결과에 없다."""
    if not product_ids:
        return {}
    rows = db.execute(
        select(ProductReview.product_id, func.count(ProductReview.id), func.sum(ProductReview.rating))
        .where(ProductReview.product_id.in_(product_ids))
        .group_by(ProductReview.product_id)
    ).all()
    return {
        product_id: (product_metrics.rating_average(rating_sum, count), count)
        for product_id, count, rating_sum in rows
    }


def product_trends(db: Session, products) -> dict[int, dict]:
    """상품들의 price_trend(app/core/price_trends.py)."""
    return price_trends.trends_for(db, [(product.id, product.price_krw) for product in products])


def product_summary(
    product: Product, stats: dict[int, tuple[float | None, int]], trends: dict[int, dict],
) -> dict:
    """ProductSummary 응답 값. value_score·is_new 는 스키마가 계산한다. trends 는 product_trends 의 결과."""
    average, count = stats.get(product.id, (None, 0))
    return {
        **{field: getattr(product, field) for field in _SUMMARY_FIELDS},
        "rating_average": average,
        "review_count": count,
        "price_trend": trends[product.id],
    }


def summaries(db: Session, products) -> list[dict]:
    """상품 목록 → ProductSummary 값 목록(리뷰 집계·가격 추세를 한꺼번에 읽는다)."""
    stats = rating_stats(db, [product.id for product in products])
    trends = product_trends(db, products)
    return [product_summary(product, stats, trends) for product in products]


def _value_desc_ordering():
    # 1만 원당 성능 점수. 가격이 0 이하인 비정상 상품은 계산할 수 없어 맨 뒤로 보낸다.
    value = case((Product.price_krw > 0, Product.performance_score * 10000 / Product.price_krw), else_=None)
    return (value.is_(None), value.desc(), Product.id.asc())


@router.get("", response_model=ProductPageResponse)
def list_products(
    category: ProductCategory | None = None,
    search: Annotated[str | None, Query(min_length=1, max_length=50)] = None,
    brand: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    min_price: Annotated[int | None, Query(ge=0, le=MAX_PRICE_FILTER)] = None,
    max_price: Annotated[int | None, Query(ge=0, le=MAX_PRICE_FILTER)] = None,
    sort: ProductSort = "recommended",
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
    dropping: bool = False,
    near_low: bool = False,
    store_lowest: bool = False,
    db: Session = Depends(get_db),
):
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(422, INVALID_REQUEST)
    conditions = [released()]  # 출시 전 상품은 목록에도, 개수에도 없다
    if category is not None:
        conditions.append(Product.category == category)
    if search is not None:
        term = search.strip()
        if not term:
            raise HTTPException(422, INVALID_REQUEST)
        conditions.append(or_(
            Product.name.icontains(term, autoescape=True),
            Product.brand.icontains(term, autoescape=True),
        ))
    if brand is not None:
        conditions.append(Product.brand == brand)
    if min_price is not None:
        conditions.append(Product.price_krw >= min_price)
    if max_price is not None:
        conditions.append(Product.price_krw <= max_price)
    # 목록 응답에 쓰지 않는 긴 컬럼(description TEXT, specs JSON)은 읽지 않는다.
    summary_columns = [getattr(Product, field) for field in _SUMMARY_FIELDS]
    query = select(Product).where(*conditions)
    trend_checks = [
        check for wanted, check in (
            (dropping, price_trends.is_dropping),
            (near_low, price_trends.is_near_low),
            (store_lowest, lambda trend: trend["store_is_lowest"]),
        ) if wanted
    ]

    if sort == "drop_desc":
        ordering = (Product.id.asc(),)  # 아래에서 가격 추세로 다시 정렬한다
    elif sort == "value_desc":
        ordering = _value_desc_ordering()
    elif sort == "rating_desc":
        # 평균 평점 높은 순, 같으면 리뷰 많은 순. 리뷰 없는 상품은 뒤.
        stats = (
            select(
                ProductReview.product_id.label("product_id"),
                func.avg(ProductReview.rating).label("rating_avg"),
                func.count(ProductReview.id).label("review_count"),
            )
            .group_by(ProductReview.product_id)
            .subquery()
        )
        query = query.outerjoin(stats, stats.c.product_id == Product.id)
        ordering = (
            stats.c.rating_avg.is_(None), stats.c.rating_avg.desc(), stats.c.review_count.desc(), Product.id.asc(),
        )
    else:
        ordering = _ORDERINGS[sort]
    offset = (page - 1) * page_size
    if trend_checks or sort == "drop_desc":
        # 가격 추세 필터·정렬: 조건에 맞는 상품(출시된 상품 전체 이하)의 id·판매가만 SQL 순서대로 읽고 추세로 거른다.
        rows = db.execute(query.with_only_columns(Product.id, Product.price_krw).order_by(*ordering)).all()
        trends = price_trends.trends_for(db, rows)
        ids = [product_id for product_id, _price in rows if all(check(trends[product_id]) for check in trend_checks)]
        if sort == "drop_desc":
            ids.sort(key=lambda product_id: price_trends.drop_sort_key(product_id, trends[product_id]))
        total = len(ids)
        page_ids = ids[offset:offset + page_size]
        by_id = {
            product.id: product
            for product in db.scalars(
                select(Product).options(load_only(*summary_columns)).where(Product.id.in_(page_ids))
            )
        } if page_ids else {}
        products = [by_id[product_id] for product_id in page_ids if product_id in by_id]
    else:
        # Query.count() 는 모든 컬럼을 고르는 서브쿼리를 세므로 COUNT(*) 를 바로 만든다.
        total = db.scalar(select(func.count()).select_from(Product).where(*conditions))
        products = db.scalars(
            query.options(load_only(*summary_columns)).order_by(*ordering).offset(offset).limit(page_size)
        ).all()
    return _envelope(
        {"items": summaries(db, products), "total": total, "page": page, "page_size": page_size},
        "상품 목록을 조회했습니다.",
    )


# /{product_id} 보다 먼저 등록해야 "price-summary" 가 상품 ID 로 해석되지 않는다.
@router.get("/price-summary", response_model=PriceSummaryResponse)
def price_summary(db: Session = Depends(get_db)):
    rows = db.execute(select(Product.id, Product.price_krw).where(released())).all()
    trends = price_trends.trends_for(db, rows).values()
    return _envelope(
        {
            "product_count": len(rows),
            "dropping_count": sum(1 for trend in trends if price_trends.is_dropping(trend)),
            "lowest_1y_count": sum(1 for trend in trends if trend["is_lowest_1y"]),
        },
        "가격 요약을 조회했습니다.",
    )


# /{product_id} 보다 먼저 등록해야 "facets" 가 상품 ID 로 해석되지 않는다.
@router.get("/facets", response_model=ProductFacetsResponse)
def product_facets(category: ProductCategory | None = None, db: Session = Depends(get_db)):
    conditions = [released()] if category is None else [released(), Product.category == category]
    brand_rows = db.execute(
        select(Product.brand, func.count(Product.id)).where(*conditions).group_by(Product.brand)
    ).all()
    price_min, price_max = db.execute(
        select(func.min(Product.price_krw), func.max(Product.price_krw)).where(*conditions)
    ).one()
    # 이름순. DB 정렬 규칙(collation)에 따라 달라지지 않게 파이썬에서 대소문자 무시로 정렬한다.
    brands = sorted(({"name": name, "count": count} for name, count in brand_rows),
                    key=lambda item: (item["name"].casefold(), item["name"]))
    return _envelope(
        {"brands": brands, "price_min": price_min, "price_max": price_max},
        "상품 필터 정보를 조회했습니다.",
    )


@router.get("/{product_id}", response_model=ProductDetailResponse)
def get_product(product_id: Annotated[int, Path(ge=1, le=MAX_ID)], db: Session = Depends(get_db)):
    product = get_product_or_404(db, product_id)
    return _envelope(
        {
            **summaries(db, [product])[0],
            "description": product.description,
            "specs": product.specs,
            "lowest_store_price_90d": pricing.lowest_store_price_since(db, product.id),
            "store_prices": price_trends.product_store_prices(db, product.id, product.price_krw),
        },
        "상품을 조회했습니다.",
    )


@router.get("/{product_id}/price-history", response_model=PriceHistoryResponse)
def get_price_history(
    product_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    days: Annotated[int, Query(ge=7, le=365)] = 90,
    db: Session = Depends(get_db),
):
    get_product_or_404(db, product_id)
    # 지금(가상 시계) 이후 기록은 보이지 않는다: 가상 시계를 과거로 돌린 시뮬레이션에서 실제 수집일(미래)의 가격이 섞이지 않게
    now = clock.utc_now()
    since = now - timedelta(days=days)
    rows = db.scalars(
        select(ProductPriceHistory)
        .where(
            ProductPriceHistory.product_id == product_id,
            ProductPriceHistory.recorded_at >= since,
            ProductPriceHistory.recorded_at <= now,
        )
        .order_by(ProductPriceHistory.recorded_at.asc(), ProductPriceHistory.id.asc())
    ).all()
    prices = [row.price_krw for row in rows]
    return _envelope(
        {
            "items": [
                {"price_krw": row.price_krw, "source": row.source, "recorded_at": clock.as_utc(row.recorded_at)}
                for row in rows
            ],
            "lowest_price_krw": min(prices) if prices else None,
            "highest_price_krw": max(prices) if prices else None,
        },
        "가격 이력을 조회했습니다.",
    )


@router.get("/{product_id}/recommendations", response_model=ProductRecommendationsResponse)
def get_recommendations(
    product_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    limit: Annotated[int, Query(ge=1, le=20)] = 6,
    db: Session = Depends(get_db),
):
    """상품 상세 추천(docs/specs/2026-11-03-product-recommendations.md). 최신 모델의 순위, 없으면 기본 추천.
    자기 자신·출시 전·재고 0 상품은 빼고 모자라면 기본 점수 순으로 채운다(app/core/recommendation_store.py)."""
    product = get_product_or_404(db, product_id)
    models = recommendation_store.latest_models(db, 1)
    model = models[0] if models else None
    ranked = recommendation_store.ranking(db, product, model, limit)
    items = summaries(db, [item.product for item in ranked])
    return _envelope(
        {
            "product_id": product.id,
            "model": recommendation_store.model_reference(model),
            "items": [
                {"rank": item.rank, "reason": item.reason, **summary} for item, summary in zip(ranked, items)
            ],
        },
        "추천 상품을 조회했습니다.",
    )


def price_match_result(row: PriceMatchRequest) -> dict:
    return {
        "id": row.id, "product_id": row.product_id, "store_price_krw": row.store_price_krw,
        "external_source": row.external_source, "external_price_krw": row.external_price_krw,
        "status": row.status, "created_at": clock.as_utc(row.created_at),
    }


@router.post(
    "/{product_id}/price-match", response_model=PriceMatchResponse, status_code=201,
    dependencies=[Depends(require_allowed_origin)],
)
def request_price_match(
    product_id: Annotated[int, Path(ge=1, le=MAX_ID)], response: Response,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    """최저가 매칭 요청. 같은 사용자의 "requested" 요청이 이미 있으면 그 요청을 200 으로 돌려준다(멱등)."""
    product = get_product_or_404(db, product_id)
    existing = db.scalars(
        select(PriceMatchRequest)
        .where(
            PriceMatchRequest.product_id == product.id, PriceMatchRequest.owner_subject == subject,
            PriceMatchRequest.status == PRICE_MATCH_REQUESTED,
        )
        .order_by(PriceMatchRequest.id.desc())
    ).first()
    if existing is not None:
        response.status_code = 200
        return _envelope(price_match_result(existing), "이미 최저가 매칭을 요청했습니다.")
    trend = price_trends.trends_for(db, [(product.id, product.price_krw)])[product.id]
    if trend["store_is_lowest"]:
        raise HTTPException(422, ALREADY_LOWEST)
    request = PriceMatchRequest(
        owner_subject=subject, product_id=product.id, store_price_krw=product.price_krw,
        external_source=trend["external_lowest"]["source"], external_price_krw=trend["external_lowest"]["price_krw"],
        status=PRICE_MATCH_REQUESTED, created_at=clock.utc_now(),
    )
    # INSERT 의 외래 키 확인이 상품 행을 공유 잠금한다. 위 읽기가 연 스냅샷을 닫아 MariaDB 1020 을 피한다(값은 이미 꺼냈다).
    end_read_snapshot(db)
    try:
        db.add(request)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(price_match_result(request), "최저가 매칭을 요청했습니다.", 201)
