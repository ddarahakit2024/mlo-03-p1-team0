"""커뮤니티 게시판(자유·견적) 글·댓글 API. docs/specs/2026-11-01-community-dark-theme.md

질문 게시판(/questions)과는 따로다. 견적 게시판 글의 댓글(답글)에는 판매 상품 부품 목록을 붙이고,
줄 금액·합계는 저장하지 않고 응답할 때마다 지금 판매가(products.price_krw)로 계산한다.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_allowed_origin
from app.core import clock, notifications
from app.core.product_release import released
from app.core.session import get_current_subject, get_optional_subject, get_subject_profile
from app.db.database import end_read_snapshot
from app.models import CommunityComment, CommunityCommentItem, CommunityPost, Product
from app.schemas.community import (
    BOARD_BUILD, BUILD_ONLY_FIELDS, BuildPurpose, CommentCreate, CommentItemWrite, CommentResponse, CommentUpdate,
    CommunityBoard, CommunityEmptyResponse, PostCreate, PostDetailResponse, PostListResponse, PostUpdate,
)
from app.schemas.product import MAX_ID

router = APIRouter(prefix="/community", tags=["community"])

POST_NOT_FOUND = "글을 찾을 수 없습니다."
COMMENT_NOT_FOUND = "댓글을 찾을 수 없습니다."
NOT_POST_OWNER = "본인이 작성한 글만 수정하거나 삭제할 수 있습니다."
NOT_COMMENT_OWNER = "본인이 작성한 댓글만 수정하거나 삭제할 수 있습니다."
ITEMS_ONLY_ON_BUILD = "부품 목록은 견적 게시판 답글에만 붙일 수 있습니다."
UNKNOWN_PRODUCT = "목록에 없는 상품이 있습니다. 상품을 다시 골라 주세요."
# 요청 본문 검증(app/main.py 의 RequestValidationError 처리)과 같은 문구. 게시판에 따라 달라지는 검증에 쓴다.
INVALID_REQUEST = "요청 값이 올바르지 않습니다."
PREVIEW_LENGTH = 120


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def _author(subject: str, name: str) -> dict:
    return {"id": subject, "name": name}


def _preview(content: str) -> str:
    # 연속 공백·줄바꿈을 공백 하나로 줄인 뒤 앞 120자
    return " ".join(content.split())[:PREVIEW_LENGTH]


# ---------------------------------------------------------------- 조회 도우미

def _post_or_404(db: Session, post_id: int, *options) -> CommunityPost:
    # 경로 값에 범위 제한이 없다(API 계약). id 컬럼 범위 밖은 DB 에 묻지 않고 없는 글로 답한다.
    post = db.get(CommunityPost, post_id, options=options) if 1 <= post_id <= MAX_ID else None
    if post is None:
        raise HTTPException(404, POST_NOT_FOUND)
    return post


def _own_post(db: Session, post_id: int, subject: str, *options) -> CommunityPost:
    post = _post_or_404(db, post_id, *options)
    if post.author_subject != subject:
        raise HTTPException(403, NOT_POST_OWNER)
    return post


def _own_comment(db: Session, comment_id: int, subject: str) -> CommunityComment:
    comment = db.get(CommunityComment, comment_id) if 1 <= comment_id <= MAX_ID else None
    if comment is None:
        raise HTTPException(404, COMMENT_NOT_FOUND)
    if comment.author_subject != subject:
        raise HTTPException(403, NOT_COMMENT_OWNER)
    return comment


def _comment_counts(db: Session, post_ids: list[int]) -> dict[int, tuple[int, int]]:
    """글 id → (댓글 수, 견적 수). 견적 = 부품 목록이 1줄 이상인 댓글. 쿼리 한 번(LEFT JOIN 이라 DISTINCT 로 센다)."""
    if not post_ids:
        return {}
    rows = db.execute(
        select(
            CommunityComment.post_id,
            func.count(func.distinct(CommunityComment.id)),
            func.count(func.distinct(CommunityCommentItem.comment_id)),
        )
        .outerjoin(CommunityCommentItem, CommunityCommentItem.comment_id == CommunityComment.id)
        .where(CommunityComment.post_id.in_(post_ids))
        .group_by(CommunityComment.post_id)
    ).all()
    return {post_id: (comments, quotes) for post_id, comments, quotes in rows}


def _items_by_comment(db: Session, comment_ids: list[int]) -> dict[int, list[dict]]:
    """댓글들의 부품 목록을 쿼리 한 번으로 읽는다(댓글 id → 넣은 순서의 줄 목록). 상품 값은 지금 products 행."""
    if not comment_ids:
        return {}
    rows = db.execute(
        select(
            CommunityCommentItem.comment_id, CommunityCommentItem.quantity,
            Product.id, Product.name, Product.brand, Product.category, Product.thumbnail_url,
            Product.price_krw, Product.stock,
        )
        .join(Product, Product.id == CommunityCommentItem.product_id)
        .where(CommunityCommentItem.comment_id.in_(comment_ids))
        .order_by(CommunityCommentItem.id)
    ).all()
    result: dict[int, list[dict]] = {}
    for comment_id, quantity, product_id, name, brand, category, thumbnail_url, price_krw, stock in rows:
        result.setdefault(comment_id, []).append({
            "product_id": product_id, "name": name, "brand": brand, "category": category,
            "thumbnail_url": thumbnail_url, "price_krw": price_krw, "stock": stock,
            "quantity": quantity, "line_total_krw": price_krw * quantity,
        })
    return result


def _build_extras(post: CommunityPost) -> dict:
    """견적 글의 모니터 해상도·선호 조건(자유 글은 null·[])."""
    return {"monitor_resolution": post.monitor_resolution, "preferences": list(post.preferences or [])}


def _quote_budget(post: CommunityPost) -> int | None:
    """견적 글이면 예산(budget_gap_krw 계산 기준), 아니면 None."""
    return post.budget_krw if post.board == BOARD_BUILD else None


def _comment_result(comment: CommunityComment, items: list[dict], subject: str | None, budget: int | None) -> dict:
    total = sum(item["line_total_krw"] for item in items)
    return {
        "id": comment.id, "post_id": comment.post_id,
        "author": _author(comment.author_subject, comment.author_name),
        "content": comment.content,
        "is_owner": subject is not None and comment.author_subject == subject,
        "created_at": clock.as_utc(comment.created_at), "updated_at": clock.as_utc(comment.updated_at),
        "items": items,
        "items_total_krw": total,
        # 양수 = 예산 초과, 음수 = 남음. 견적 글의 부품이 있는 댓글만
        "budget_gap_krw": total - budget if budget is not None and items else None,
    }


def _comment_payload(db: Session, comment: CommunityComment, subject: str, budget: int | None) -> dict:
    return _comment_result(comment, _items_by_comment(db, [comment.id]).get(comment.id, []), subject, budget)


def _detail(db: Session, post: CommunityPost, subject: str | None) -> dict:
    # 쿼리 수는 댓글 수와 상관없이 일정하다: 댓글 1번 + 부품 목록·상품 1번.
    comments = db.scalars(
        select(CommunityComment).where(CommunityComment.post_id == post.id)
        .order_by(CommunityComment.created_at, CommunityComment.id)
    ).all()
    items = _items_by_comment(db, [comment.id for comment in comments])
    return {
        "id": post.id, "board": post.board, "title": post.title, "content": post.content,
        "author": _author(post.author_subject, post.author_name),
        "budget_krw": post.budget_krw, "purpose": post.purpose, **_build_extras(post),
        "is_owner": subject is not None and post.author_subject == subject,
        "created_at": clock.as_utc(post.created_at), "updated_at": clock.as_utc(post.updated_at),
        "comments": [
            _comment_result(comment, items.get(comment.id, []), subject, _quote_budget(post)) for comment in comments
        ],
    }


def _summary(post: CommunityPost, comment_count: int, quote_count: int) -> dict:
    return {
        "id": post.id, "board": post.board, "title": post.title, "preview": _preview(post.content),
        "author": _author(post.author_subject, post.author_name),
        "budget_krw": post.budget_krw, "purpose": post.purpose, **_build_extras(post),
        "comment_count": comment_count, "quote_count": quote_count,
        "created_at": clock.as_utc(post.created_at), "updated_at": clock.as_utc(post.updated_at),
    }


def _check_items(db: Session, post: CommunityPost, items: list[CommentItemWrite]) -> None:
    """부품 목록 검증. 길이·수량·중복은 스키마가 이미 확인했다. [] 는 부품이 없는 것이라 어느 게시판이든 된다."""
    if not items:
        return
    if post.board != BOARD_BUILD:
        raise HTTPException(422, ITEMS_ONLY_ON_BUILD)
    product_ids = [item.product_id for item in items]
    # 출시 전 상품은 판매하지 않는 상품과 같은 오류다.
    found = db.scalars(select(Product.id).where(Product.id.in_(product_ids), released())).all()
    if len(found) != len(product_ids):
        raise HTTPException(422, UNKNOWN_PRODUCT)


def _new_items(items: list[CommentItemWrite]) -> list[CommunityCommentItem]:
    # 요청 순서대로 넣는다(id 순서 = 보여 주는 순서).
    return [CommunityCommentItem(product_id=item.product_id, quantity=item.quantity) for item in items]


# ---------------------------------------------------------------- 글

@router.get("/posts", response_model=PostListResponse)
def list_posts(
    board: Annotated[CommunityBoard, Query()],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
    search: Annotated[str, Query(max_length=200)] = "",
    purpose: Annotated[BuildPurpose | None, Query()] = None,
    db: Session = Depends(get_db),
):
    conditions = [CommunityPost.board == board]
    if purpose is not None:
        if board != BOARD_BUILD:
            raise HTTPException(422, INVALID_REQUEST)  # 용도는 견적 게시판에만 있다
        conditions.append(CommunityPost.purpose == purpose)
    term = search.strip()
    if term:
        conditions.append(or_(
            CommunityPost.title.contains(term, autoescape=True),
            CommunityPost.content.contains(term, autoescape=True),
        ))
    total = db.scalar(select(func.count()).select_from(CommunityPost).where(*conditions))
    # page 에 상한이 없어(API 계약) 아주 큰 값이면 OFFSET 이 DB 정수 범위를 넘는다. 마지막 쪽 뒤는 읽지 않고 빈 목록이다.
    offset = (page - 1) * page_size
    posts = [] if offset >= total else db.scalars(
        select(CommunityPost).where(*conditions)
        .order_by(CommunityPost.created_at.desc(), CommunityPost.id.desc()).offset(offset).limit(page_size)
    ).all()
    counts = _comment_counts(db, [post.id for post in posts])
    return _envelope(
        {
            "items": [_summary(post, *counts.get(post.id, (0, 0))) for post in posts],
            "total": total, "page": page, "page_size": page_size,
        },
        "게시글 목록을 조회했습니다.",
    )


@router.get("/posts/{post_id}", response_model=PostDetailResponse)
def get_post(
    post_id: int, response: Response,
    subject: str | None = Depends(get_optional_subject), db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"  # is_owner 가 쿠키에 따라 달라진다
    return _envelope(_detail(db, _post_or_404(db, post_id), subject), "게시글을 조회했습니다.")


@router.post("/posts", response_model=PostDetailResponse, status_code=201, dependencies=[Depends(require_allowed_origin)])
def create_post(
    payload: PostCreate, subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    now = clock.utc_now()
    post = CommunityPost(
        board=payload.board, title=payload.title, content=payload.content,
        author_subject=subject, author_name=get_subject_profile(db, subject)["name"],
        budget_krw=payload.budget_krw, purpose=payload.purpose,
        monitor_resolution=payload.monitor_resolution, preferences=payload.preferences,
        created_at=now, updated_at=now,
    )
    try:
        db.add(post)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(_detail(db, post, subject), "게시글이 등록되었습니다.", 201)


@router.patch("/posts/{post_id}", response_model=PostDetailResponse, dependencies=[Depends(require_allowed_origin)])
def update_post(
    post_id: int, payload: PostUpdate,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    post = _own_post(db, post_id, subject)
    fields = payload.model_fields_set
    if post.board != BOARD_BUILD and any(getattr(payload, name) is not None for name in fields & BUILD_ONLY_FIELDS):
        raise HTTPException(422, INVALID_REQUEST)  # 예산·용도·모니터·선호 조건은 견적 글에만
    try:
        for name in fields:
            setattr(post, name, getattr(payload, name))
        post.updated_at = clock.utc_now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(_detail(db, post, subject), "게시글이 수정되었습니다.")


@router.delete("/posts/{post_id}", response_model=CommunityEmptyResponse, dependencies=[Depends(require_allowed_origin)])
def delete_post(
    post_id: int, subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    # 댓글과 부품 목록을 한꺼번에 읽어 두면 ORM cascade 가 댓글마다 부품 목록을 따로 읽지 않는다.
    post = _own_post(
        db, post_id, subject, selectinload(CommunityPost.comments).selectinload(CommunityComment.items),
    )
    try:
        db.delete(post)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(None, "게시글이 삭제되었습니다.")


# ---------------------------------------------------------------- 댓글

@router.post(
    "/posts/{post_id}/comments", response_model=CommentResponse, status_code=201,
    dependencies=[Depends(require_allowed_origin)],
)
def create_comment(
    post_id: int, payload: CommentCreate,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    post = _post_or_404(db, post_id)
    _check_items(db, post, payload.items)
    budget = _quote_budget(post)
    author_name = get_subject_profile(db, subject)["name"]
    # 견적(부품 목록이 있는 견적 게시판 댓글)이면 글 작성자에게 알린다. 아래에서 스냅샷을 닫기 전에 값을 꺼내 둔다.
    quote_for = (post.author_subject, post.title) if post.board == BOARD_BUILD and payload.items else None
    # INSERT 의 외래 키 확인이 글·상품 행을 공유 잠금한다. 위 확인들이 연 스냅샷을 닫아, 그 사이 가격이 바뀐 상품이나
    # 수정된 글이어도 MariaDB 가 1020 으로 거부하지 않게 한다(리뷰 작성과 같다).
    end_read_snapshot(db)
    now = clock.utc_now()
    comment = CommunityComment(
        post_id=post_id, author_subject=subject, author_name=author_name, content=payload.content,
        created_at=now, updated_at=now, items=_new_items(payload.items),
    )
    try:
        db.add(comment)
        if quote_for is not None:
            notifications.notify_quote(db, quote_for[0], post_id, quote_for[1], subject, author_name)
        db.commit()
    except IntegrityError:
        # 확인한 뒤 글이나 상품이 지워졌다(외래 키 위반).
        db.rollback()
        _post_or_404(db, post_id)
        raise HTTPException(422, UNKNOWN_PRODUCT) from None
    except Exception:
        db.rollback()
        raise
    return _envelope(_comment_payload(db, comment, subject, budget), "댓글이 등록되었습니다.", 201)


@router.patch("/comments/{comment_id}", response_model=CommentResponse, dependencies=[Depends(require_allowed_origin)])
def update_comment(
    comment_id: int, payload: CommentUpdate,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    comment = _own_comment(db, comment_id, subject)
    fields = payload.model_fields_set
    post = _post_or_404(db, comment.post_id)
    budget = _quote_budget(post)
    if "items" in fields:
        _check_items(db, post, payload.items)
    # 부품 INSERT 의 외래 키 확인 전에 스냅샷을 닫는다(댓글 작성과 같다). 이 뒤로는 잠그는 문장만 쓴다:
    # 만료된 ORM 객체를 고치면 flush 가 일반 SELECT 로 다시 읽어 스냅샷을 다시 연다.
    end_read_snapshot(db)
    values = {"updated_at": clock.utc_now()}
    if "content" in fields:
        values["content"] = payload.content
    no_sync = {"synchronize_session": False}
    try:
        updated = db.execute(
            update(CommunityComment).where(CommunityComment.id == comment_id).values(**values), execution_options=no_sync,
        ).rowcount
        if not updated:  # 확인한 뒤 다른 요청이 댓글을 지웠다
            raise HTTPException(404, COMMENT_NOT_FOUND)
        if "items" in fields:
            # 목록 전체를 바꾼다. 같은 상품을 다시 넣을 수 있게(UNIQUE) 먼저 지운 뒤 넣는다.
            db.execute(
                delete(CommunityCommentItem).where(CommunityCommentItem.comment_id == comment_id),
                execution_options=no_sync,
            )
            for item in _new_items(payload.items):
                item.comment_id = comment_id
                db.add(item)
        db.commit()
    except IntegrityError:
        # 확인한 뒤 상품이 지워졌다(외래 키 위반). 댓글 행은 위 UPDATE 가 잠가 두어 그 사이 지워지지 않는다.
        db.rollback()
        raise HTTPException(422, UNKNOWN_PRODUCT) from None
    except Exception:
        db.rollback()
        raise
    return _envelope(_comment_payload(db, comment, subject, budget), "댓글이 수정되었습니다.")


@router.delete(
    "/comments/{comment_id}", response_model=CommunityEmptyResponse, dependencies=[Depends(require_allowed_origin)],
)
def delete_comment(
    comment_id: int, subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    comment = _own_comment(db, comment_id, subject)
    try:
        db.delete(comment)  # ORM cascade 가 부품 목록도 지운다
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(None, "댓글이 삭제되었습니다.")
