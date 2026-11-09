from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.api.routers.products import get_product_or_404
from app.core import clock, product_metrics
from app.core.session import get_current_subject, get_optional_subject, get_subject_profile
from app.db.database import end_read_snapshot
from app.models import ProductOrder, ProductOrderItem, ProductReview
from app.models.product_order import ORDER_PAID
from app.schemas.product import MAX_ID
from app.schemas.review import (
    REVIEW_RATINGS, EmptyResponse, ReviewCreate, ReviewPageResponse, ReviewResponse, ReviewUpdate,
)

router = APIRouter(prefix="/products/{product_id}/reviews", tags=["reviews"])

REVIEW_NOT_FOUND = "리뷰를 찾을 수 없습니다."
NOT_PURCHASED = "구매한 상품만 리뷰를 남길 수 있습니다."
ALREADY_REVIEWED = "이미 이 상품의 리뷰를 작성했습니다."
NOT_REVIEW_OWNER = "본인이 작성한 리뷰만 수정하거나 삭제할 수 있습니다."

ProductId = Annotated[int, Path(ge=1, le=MAX_ID)]
ReviewId = Annotated[int, Path(ge=1, le=MAX_ID)]


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def has_paid_order(db: Session, subject: str, product_id: int) -> bool:
    """그 상품이 들어 있는 PAID 주문이 있는지."""
    found = db.scalar(
        select(ProductOrderItem.id)
        .join(ProductOrder, ProductOrder.payment_id == ProductOrderItem.payment_id)
        .where(
            ProductOrder.buyer_subject == subject,
            ProductOrder.status == ORDER_PAID,
            ProductOrderItem.product_id == product_id,
        )
        .limit(1)
    )
    return found is not None


def _review(review: ProductReview, subject: str | None) -> dict:
    return {
        "id": review.id, "product_id": review.product_id,
        "author": {"id": review.author_subject, "name": review.author_name},
        "rating": review.rating, "content": review.content,
        "created_at": clock.as_utc(review.created_at), "updated_at": clock.as_utc(review.updated_at),
        "is_owner": subject is not None and review.author_subject == subject,
    }


def _own_review(db: Session, product_id: int, review_id: int, subject: str) -> ProductReview:
    get_product_or_404(db, product_id)
    review = db.get(ProductReview, review_id)
    if review is None or review.product_id != product_id:
        raise HTTPException(404, REVIEW_NOT_FOUND)
    if review.author_subject != subject:
        raise HTTPException(403, NOT_REVIEW_OWNER)
    return review


@router.get("", response_model=ReviewPageResponse)
def list_reviews(
    product_id: ProductId,
    response: Response,
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
    subject: str | None = Depends(get_optional_subject),
    db: Session = Depends(get_db),
):
    # my_review·can_review·is_owner 가 쿠키에 따라 달라진다.
    response.headers["Cache-Control"] = "private, no-store"
    get_product_or_404(db, product_id)
    of_product = ProductReview.product_id == product_id
    # 전체 수 = 평점 분포의 합(rating 은 NOT NULL 이라 모든 리뷰가 어느 한 평점에 들어간다). count(*) 를 따로 하지 않는다.
    counts = {str(rating): 0 for rating in REVIEW_RATINGS}
    rating_sum = total = 0
    for rating, count in db.execute(
        select(ProductReview.rating, func.count(ProductReview.id)).where(of_product).group_by(ProductReview.rating)
    ).all():
        counts[str(rating)] = count
        rating_sum += rating * count
        total += count
    offset = (page - 1) * page_size
    reviews = [] if offset >= total else db.scalars(
        select(ProductReview).where(of_product)
        .order_by(ProductReview.created_at.desc(), ProductReview.id.desc())
        .offset(offset).limit(page_size)
    ).all()

    my_review, can_review = None, False
    if subject is not None:
        mine = db.scalars(select(ProductReview).where(of_product, ProductReview.author_subject == subject)).first()
        my_review = None if mine is None else _review(mine, subject)
        can_review = mine is None and has_paid_order(db, subject, product_id)
    return _envelope(
        {
            "items": [_review(review, subject) for review in reviews],
            "total": total, "page": page, "page_size": page_size,
            "rating_average": product_metrics.rating_average(rating_sum, total),
            "rating_counts": counts,
            "my_review": my_review,
            "can_review": can_review,
        },
        "리뷰 목록을 조회했습니다.",
    )


@router.post("", response_model=ReviewResponse, status_code=201, dependencies=[Depends(require_allowed_origin)])
def create_review(
    product_id: ProductId,
    payload: ReviewCreate,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    get_product_or_404(db, product_id)
    if not has_paid_order(db, subject, product_id):
        raise HTTPException(403, NOT_PURCHASED)
    existing = db.scalar(
        select(ProductReview.id).where(ProductReview.product_id == product_id, ProductReview.author_subject == subject)
    )
    if existing is not None:
        raise HTTPException(409, ALREADY_REVIEWED)
    author_name = get_subject_profile(db, subject)["name"]
    # INSERT 의 외래 키 확인이 products 행을 공유 잠금한다. 위 확인들이 연 스냅샷을 닫아, 그 사이 재고·가격이 바뀐
    # 상품이어도 MariaDB 가 1020 으로 거부하지 않게 한다(중복 리뷰는 UNIQUE 제약이, 구매 여부는 위 확인이 맡는다).
    end_read_snapshot(db)
    now = clock.utc_now()
    review = ProductReview(
        product_id=product_id, author_subject=subject, author_name=author_name,
        rating=payload.rating, content=payload.content, created_at=now, updated_at=now,
    )
    try:
        db.add(review)
        db.commit()
    except IntegrityError:
        # 같은 사용자의 동시 요청: UNIQUE(product_id, author_subject) 가 막는다.
        db.rollback()
        raise HTTPException(409, ALREADY_REVIEWED) from None
    except Exception:
        db.rollback()
        raise
    return _envelope(_review(review, subject), "리뷰가 등록되었습니다.", 201)


@router.patch("/{review_id}", response_model=ReviewResponse, dependencies=[Depends(require_allowed_origin)])
def update_review(
    product_id: ProductId,
    review_id: ReviewId,
    payload: ReviewUpdate,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    review = _own_review(db, product_id, review_id, subject)
    try:
        if payload.rating is not None:
            review.rating = payload.rating
        if payload.content is not None:
            review.content = payload.content
        review.updated_at = clock.utc_now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(_review(review, subject), "리뷰가 수정되었습니다.")


@router.delete("/{review_id}", response_model=EmptyResponse, dependencies=[Depends(require_allowed_origin)])
def delete_review(
    product_id: ProductId,
    review_id: ReviewId,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    review = _own_review(db, product_id, review_id, subject)
    db.delete(review)
    db.commit()
    return _envelope(None, "리뷰가 삭제되었습니다.")
