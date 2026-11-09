from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.api.routers.products import PRODUCT_NOT_FOUND, get_product_or_404
from app.core import price_trends
from app.core.product_release import released
from app.core.session import get_current_subject
from app.db.database import end_read_snapshot, is_lock_conflict
from app.models import Build, CartItem, CommunityComment, CommunityCommentItem, CommunityPost, Product
from app.models.build import BUILD_SOURCE_QUOTE
from app.schemas.cart import (
    MAX_QUANTITY_PER_PRODUCT, SKIP_LIMIT, SKIP_SOLD_OUT, SKIP_UNAVAILABLE, BuildAddRequest, BuildAddResponse,
    CartItemAdd, CartItemUpdate, CartResponse,
)
from app.schemas.community import BOARD_BUILD
from app.schemas.product import MAX_ID

router = APIRouter(prefix="/cart", tags=["cart"])

ProductIdPath = Annotated[int, Path(ge=1, le=MAX_ID)]
CART_CHANGED = "장바구니가 다른 요청으로 바뀌었습니다. 다시 시도해 주세요."
# 견적 담기(POST /cart/builds). docs/specs/2026-11-01-build-id-purpose.md
QUOTE_NOT_FOUND = "견적 댓글을 찾을 수 없습니다."
NOT_A_QUOTE = "부품 목록이 있는 견적 댓글만 장바구니에 담을 수 있습니다."
NOTHING_TO_ADD = "담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다."


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def stock_shortage_message(product: Product) -> str:
    if product.stock <= 0:
        return f"'{product.name}' 상품은 품절되었습니다."
    return f"'{product.name}' 상품의 재고가 부족합니다. 최대 {product.stock}개까지 주문할 수 있습니다."


def _build_result(build: Build | None) -> dict | None:
    return None if build is None else {"id": build.id, "post_id": build.post_id, "comment_id": build.comment_id}


def cart_result(db: Session, subject: str) -> dict:
    # 견적 묶음도 같은 쿼리로 읽는다(LEFT JOIN. 견적에서 담지 않은 줄은 None).
    rows = db.execute(
        select(CartItem, Product, Build)
        .join(Product, Product.id == CartItem.product_id)
        .outerjoin(Build, Build.id == CartItem.build_id)
        .where(CartItem.owner_subject == subject)
        .order_by(CartItem.id)
    ).all()
    trends = price_trends.trends_for(db, [(product.id, product.price_krw) for _item, product, _build in rows])
    items, external_saving = [], 0
    for item, product, build in rows:
        trend = trends[product.id]
        items.append({
            "product_id": product.id, "name": product.name, "brand": product.brand,
            "category": product.category, "thumbnail_url": product.thumbnail_url,
            "price_krw": product.price_krw, "stock": product.stock,
            "quantity": item.quantity, "subtotal_krw": product.price_krw * item.quantity,
            "build": _build_result(build),
            "added_price_krw": item.added_price_krw,
            "price_change_krw": None if item.added_price_krw is None else product.price_krw - item.added_price_krw,
            "price_trend": trend,
        })
        # 우리가 가장 싼 줄: 외부 최저가보다 아낀 금액 × 수량
        if trend["store_is_lowest"] and trend["external_lowest"] is not None:
            external_saving += (trend["external_lowest"]["price_krw"] - product.price_krw) * item.quantity
    return {
        "items": items,
        "item_count": sum(item["quantity"] for item in items),
        "total_krw": sum(item["subtotal_krw"] for item in items),
        "external_saving_krw": external_saving,
    }


def _cart_item(db: Session, subject: str, product_id: int, *, lock: bool = False) -> CartItem | None:
    query = select(CartItem).where(CartItem.owner_subject == subject, CartItem.product_id == product_id)
    if lock:
        query = query.with_for_update()
    return db.scalars(query).first()


def _share_locked_product_or_404(db: Session, product_id: int) -> Product:
    """상품 행을 공유 잠금으로 읽는다. 장바구니 INSERT 의 외래 키 확인이 어차피 이 행을 공유 잠금하므로 먼저 잡아 둔다.

    잠금 순서가 상품 → 장바구니 행이 되어, 상품(배타) → 장바구니 DELETE 순서인 주문 확인과 교착하지 않는다.
    출시 전 상품은 없는 상품처럼 404 다.
    """
    product = db.scalars(
        select(Product).where(Product.id == product_id, released()).with_for_update(read=True)
    ).first()
    if product is None:
        raise HTTPException(404, PRODUCT_NOT_FOUND)
    return product


def _cart_item_or_404(db: Session, subject: str, product_id: int) -> CartItem:
    item = _cart_item(db, subject, product_id, lock=True)
    if item is None:
        raise HTTPException(404, "장바구니에 없는 상품입니다.")
    return item


def _check_quantity(product: Product, quantity: int) -> None:
    if quantity > MAX_QUANTITY_PER_PRODUCT:
        raise HTTPException(409, f"한 상품은 최대 {MAX_QUANTITY_PER_PRODUCT}개까지 담을 수 있습니다.")
    if quantity > product.stock:
        raise HTTPException(409, stock_shortage_message(product))


def _quote_lines(db: Session, comment_id: int) -> tuple[int, list[tuple[int, int]]]:
    """견적 댓글 → (글 id, 부품 줄 [(상품 id, 수량)] 댓글에 보이는 순서대로).

    없는 댓글과 견적 게시판이 아닌 글의 댓글은 404, 부품 목록이 없는 댓글(견적이 아님)은 409.
    """
    # id 컬럼 범위 밖은 DB 에 묻지 않고 없는 댓글로 답한다(커뮤니티와 같다).
    row = db.execute(
        select(CommunityComment.post_id, CommunityPost.board)
        .join(CommunityPost, CommunityPost.id == CommunityComment.post_id)
        .where(CommunityComment.id == comment_id)
    ).first() if comment_id <= MAX_ID else None
    if row is None or row.board != BOARD_BUILD:
        raise HTTPException(404, QUOTE_NOT_FOUND)
    lines = db.execute(
        select(CommunityCommentItem.product_id, CommunityCommentItem.quantity)
        .where(CommunityCommentItem.comment_id == comment_id)
        .order_by(CommunityCommentItem.id)
    ).all()
    if not lines:
        raise HTTPException(409, NOT_A_QUOTE)
    return row.post_id, [(product_id, quantity) for product_id, quantity in lines]


def _add_quote_lines(
    db: Session, subject: str, build_id: str, post_id: int, comment_id: int, lines: list[tuple[int, int]],
) -> tuple[list[dict], list[dict]]:
    """견적 부품을 댓글 순서대로 장바구니에 더한다. 하나라도 더하면 builds 행을 넣고 더한 줄의 build_id 를 바꾼다.

    잠금 순서는 장바구니 담기와 같다: 상품 행 공유 잠금 → 장바구니 줄 배타 잠금. 상품이 여럿이라 주문 만들기처럼 상품 id
    순서로 잠가, 상품 id 순서로 배타 잠금을 거는 주문 확인·시장 도구와 교착하지 않는다. 반환: (added, skipped).
    """
    products = {
        product.id: product
        for product in db.scalars(
            select(Product).where(Product.id.in_([product_id for product_id, _ in lines]), released())
            .order_by(Product.id).with_for_update(read=True)
        )
    }
    items = {
        item.product_id: item
        for item in db.scalars(
            select(CartItem).where(CartItem.owner_subject == subject, CartItem.product_id.in_(list(products)))
            .order_by(CartItem.product_id).with_for_update()
        )
    } if products else {}

    added, skipped, changes = [], [], []
    for product_id, quantity in lines:
        product = products.get(product_id)
        if product is None:  # 출시 전(또는 없는) 상품은 없는 상품처럼 다룬다
            skipped.append({"product_id": product_id, "reason": SKIP_UNAVAILABLE})
            continue
        if product.stock <= 0:
            skipped.append({"product_id": product_id, "reason": SKIP_SOLD_OUT})
            continue
        item = items.get(product_id)
        current = item.quantity if item is not None else 0
        # 합계가 한도(한 상품 최대 수량, 재고)를 넘으면 한도까지만 더한다.
        amount = min(quantity, min(MAX_QUANTITY_PER_PRODUCT, product.stock) - current)
        if amount <= 0:
            skipped.append({"product_id": product_id, "reason": SKIP_LIMIT})
            continue
        added.append({"product_id": product_id, "quantity": amount})
        changes.append((product_id, item, current + amount))
    if not added:
        return added, skipped

    db.add(Build(id=build_id, owner_subject=subject, source=BUILD_SOURCE_QUOTE, post_id=post_id, comment_id=comment_id))
    db.flush()  # 장바구니 줄의 외래 키(build_id)가 가리킬 행을 먼저 넣는다
    for product_id, item, quantity in changes:
        if item is None:
            db.add(CartItem(
                owner_subject=subject, product_id=product_id, quantity=quantity, build_id=build_id,
                added_price_krw=products[product_id].price_krw,
            ))
        else:
            item.quantity = quantity
            item.build_id = build_id  # 마지막으로 담은 견적
    return added, skipped


@router.get("", response_model=CartResponse)
def get_cart(subject: str = Depends(get_current_subject), db: Session = Depends(get_db)):
    return _envelope(cart_result(db, subject), "장바구니를 조회했습니다.")


@router.post("/items", response_model=CartResponse, dependencies=[Depends(require_allowed_origin)])
def add_cart_item(
    payload: CartItemAdd,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    # 인증 SELECT 가 연 스냅샷을 닫고 잠그는 읽기만 한다(스냅샷 뒤 바뀐 행을 잠그면 MariaDB 1020).
    end_read_snapshot(db)
    try:
        product = _share_locked_product_or_404(db, payload.product_id)
        item = _cart_item(db, subject, product.id, lock=True)
        quantity = payload.quantity + (item.quantity if item is not None else 0)
        _check_quantity(product, quantity)
        if item is None:
            # 처음 담을 때의 판매가를 남긴다(같은 상품을 더 담으면 처음 값 그대로)
            db.add(CartItem(
                owner_subject=subject, product_id=product.id, quantity=quantity, added_price_krw=product.price_krw,
            ))
        else:
            item.quantity = quantity
        db.commit()
    except IntegrityError:
        # 같은 사용자가 같은 상품을 동시에 처음 담으면 UNIQUE 제약이 하나를 막는다.
        db.rollback()
        raise HTTPException(409, CART_CHANGED) from None
    except OperationalError as exc:
        db.rollback()
        # MariaDB(REPEATABLE READ)에서는 없는 행을 SELECT ... FOR UPDATE 한 두 요청이 같은 갭 잠금을 잡고
        # 서로의 INSERT 를 막아 UNIQUE 위반보다 교착(1213)이 먼저 난다. 1020·1205 도 다른 요청과의 경쟁이다.
        # 같은 경쟁이므로 같은 409 로 답한다.
        if is_lock_conflict(exc):
            raise HTTPException(409, CART_CHANGED) from None
        raise
    except Exception:
        db.rollback()
        raise
    return _envelope(cart_result(db, subject), "장바구니에 담았습니다.")


@router.post("/builds", response_model=BuildAddResponse, dependencies=[Depends(require_allowed_origin)])
def add_build_to_cart(
    payload: BuildAddRequest,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    """견적 게시판의 견적 댓글(부품 목록)을 장바구니에 한 번에 담는다. 남의 글의 견적도 담을 수 있다(공개 게시판)."""
    # 견적 댓글·부품 목록은 인증과 같은 읽기 트랜잭션에서 읽고 값만 꺼내 둔다. 그 뒤 스냅샷을 닫고 잠그는 읽기부터 한다
    # (스냅샷 뒤 바뀐 행을 잠그면 MariaDB 1020).
    post_id, lines = _quote_lines(db, payload.comment_id)
    end_read_snapshot(db)
    build_id = uuid4().hex
    try:
        added, skipped = _add_quote_lines(db, subject, build_id, post_id, payload.comment_id, lines)
        if not added:
            # builds 행도 만들지 않는다. 잠근 행은 아래 롤백으로 놓는다.
            raise HTTPException(409, NOTHING_TO_ADD)
        db.commit()
    except IntegrityError:
        # 같은 사용자가 같은 상품을 동시에 처음 담으면 UNIQUE 제약이 하나를 막는다(장바구니 담기와 같다).
        db.rollback()
        raise HTTPException(409, CART_CHANGED) from None
    except OperationalError as exc:
        db.rollback()
        # 갭 잠금 교착(1213)·1020·1205 도 같은 사용자의 다른 요청과의 경쟁이다(장바구니 담기와 같다).
        if is_lock_conflict(exc):
            raise HTTPException(409, CART_CHANGED) from None
        raise
    except Exception:
        db.rollback()
        raise
    return _envelope(
        {
            "build_id": build_id, "post_id": post_id, "comment_id": payload.comment_id,
            "added": added, "skipped": skipped, "cart": cart_result(db, subject),
        },
        "견적의 부품을 장바구니에 담았습니다.",
    )


@router.patch("/items/{product_id}", response_model=CartResponse, dependencies=[Depends(require_allowed_origin)])
def update_cart_item(
    product_id: ProductIdPath,
    payload: CartItemUpdate,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    # 장바구니 행을 잠그기 전에 인증 SELECT 의 스냅샷을 닫는다. 상품은 잠근 뒤 일반 SELECT 로 읽는다(그 뒤 잠그는 행은
    # 이미 잠근 장바구니 행뿐이라 1020 이 나지 않는다).
    end_read_snapshot(db)
    try:
        item = _cart_item_or_404(db, subject, product_id)
        _check_quantity(get_product_or_404(db, product_id), payload.quantity)
        item.quantity = payload.quantity
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(cart_result(db, subject), "장바구니 수량을 변경했습니다.")


@router.delete("/items/{product_id}", response_model=CartResponse, dependencies=[Depends(require_allowed_origin)])
def delete_cart_item(
    product_id: ProductIdPath,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    end_read_snapshot(db)  # 장바구니 행을 잠그기 전에 인증 SELECT 의 스냅샷을 닫는다
    try:
        db.delete(_cart_item_or_404(db, subject, product_id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(cart_result(db, subject), "장바구니에서 삭제했습니다.")
