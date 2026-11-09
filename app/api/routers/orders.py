import logging
from datetime import datetime, timezone
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.api.routers.cart import stock_shortage_message
from app.api.routers.products import PRODUCT_NOT_FOUND
from app.core import clock, mock_payment, portone
from app.core import returns as return_policy
from app.core.product_release import released
from app.core.session import get_current_subject
from app.db.database import end_read_snapshot, is_retryable_conflict
from app.models import CartItem, Product, ProductOrder, ProductOrderItem, ReturnRequest
from app.models.product_order import (
    ORDER_CANCELLED, ORDER_PAID, ORDER_READY, PAYMENT_PROVIDER_MOCK, PAYMENT_PROVIDER_PORTONE,
)
from app.schemas.order import (
    ConfirmOrderRequest, CreateOrderRequest, OrderDetailResponse, OrderLine, OrderPageResponse,
    PaymentRequestResponse,
)

router = APIRouter(prefix="/orders", tags=["orders"])
logger = logging.getLogger(__name__)

ORDER_NOT_FOUND = "주문을 찾을 수 없습니다."
CANCELLED_ORDER = "취소된 주문입니다."
PAYMENT_NOT_CONFIGURED = "결제 연동 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요."
PAYMENT_LOOKUP_FAILED = "포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
PAYMENT_MISMATCH = "결제가 완료되지 않았거나 결제 금액이 주문과 일치하지 않습니다."
STOCK_CANCELLED = "재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다."
STOCK_CANCEL_FAILED = "재고가 부족하지만 결제 취소에 실패했습니다. 고객센터로 문의해 주세요."
STOCK_CANCEL_REASON = "재고 부족"
# 결제 확인 트랜잭션 시도 횟수. 1020(스냅샷 충돌)·1213(교착)이면 롤백하고 한 번 더 한다.
PAY_ATTEMPTS = 2
ORDER_NAME_MAX = 200


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def _utc(value: datetime | None) -> datetime | None:
    # SQLite·MariaDB 는 시간대 없이 돌려준다. 저장 값은 UTC 다.
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    # 결제·취소 시각. 가상 시계를 따른다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


def _order_name(names: list[str]) -> str:
    if len(names) == 1:
        return names[0][:ORDER_NAME_MAX]
    suffix = f" 외 {len(names) - 1}건"
    return names[0][: ORDER_NAME_MAX - len(suffix)] + suffix


def _require_payment_configuration() -> None:
    if not portone.is_configured():
        raise HTTPException(503, PAYMENT_NOT_CONFIGURED)


def _own_order(db: Session, payment_id: str, subject: str) -> ProductOrder:
    order = db.get(ProductOrder, payment_id)
    if order is None or order.buyer_subject != subject:
        # 남의 주문도 없는 주문과 같은 답을 준다(존재 여부를 알리지 않는다).
        raise HTTPException(404, ORDER_NOT_FOUND)
    return order


def _thumbnails(db: Session, orders: list[ProductOrder]) -> dict[str, str]:
    """주문마다 첫 상품의 현재 이미지. 상품이 없으면 빈 문자열."""
    first_product = {order.payment_id: order.items[0].product_id for order in orders if order.items}
    if not first_product:
        return {}
    rows = db.execute(
        select(Product.id, Product.thumbnail_url).where(Product.id.in_(set(first_product.values())))
    ).all()
    by_product = {product_id: url for product_id, url in rows}
    return {payment_id: by_product.get(product_id, "") for payment_id, product_id in first_product.items()}


def _summary(order: ProductOrder, thumbnail_url: str) -> dict:
    return {
        "payment_id": order.payment_id, "order_name": order.order_name, "status": order.status,
        "total_krw": order.total_krw, "item_count": sum(item.quantity for item in order.items),
        "thumbnail_url": thumbnail_url, "created_at": _utc(order.created_at), "paid_at": _utc(order.paid_at),
    }


def _detail(db: Session, order: ProductOrder) -> dict:
    # 반품 내역(신청 순)과 신청 가능 수량·기한. docs/specs/2026-11-01-returns-refunds.md
    returns = db.scalars(
        select(ReturnRequest).where(ReturnRequest.payment_id == order.payment_id).order_by(ReturnRequest.id)
    ).all()
    product_names = {item.product_id: item.product_name for item in order.items}
    return {
        **_summary(order, _thumbnails(db, [order]).get(order.payment_id, "")),
        "items": [
            {
                "product_id": item.product_id, "product_name": item.product_name,
                "unit_price_krw": item.unit_price_krw, "quantity": item.quantity,
                "subtotal_krw": item.unit_price_krw * item.quantity, "build_id": item.build_id,
            }
            for item in order.items
        ],
        "shipping": {
            "recipient_name": order.recipient_name, "phone": order.phone, "postal_code": order.postal_code,
            "address1": order.address1, "address2": order.address2, "delivery_memo": order.delivery_memo,
        },
        "cancelled_at": _utc(order.cancelled_at),
        "returns": [return_policy.return_result(request, product_names) for request in returns],
        "returnable": return_policy.returnable(
            order.status, [(item.product_id, item.quantity) for item in order.items],
            return_policy.claimed_quantities(returns),
        ),
        "return_deadline": return_policy.return_deadline(order.status, order.paid_at),
    }


def _confirmed(db: Session, order: ProductOrder) -> dict:
    return _envelope(_detail(db, order), "결제가 확인되었습니다.")


def _finished_order_response(db: Session, order: ProductOrder) -> dict:
    """이미 처리된 주문: PAID 는 같은 결과(멱등), CANCELLED 는 409."""
    if order.status == ORDER_PAID:
        return _confirmed(db, order)
    if order.status == ORDER_CANCELLED:
        raise HTTPException(409, CANCELLED_ORDER)
    raise HTTPException(409, "주문 상태가 바뀌었습니다. 다시 시도해 주세요.")


def _cart_build_ids(db: Session, subject: str, lines: list[OrderLine]) -> dict[int, str | None]:
    """장바구니 주문이면 상품 id → 그 장바구니 줄의 build_id, 아니면 {}(바로 구매). docs/specs/2026-11-01-build-id-purpose.md

    요청에는 어느 화면에서 주문했는지가 없다(API 계약 그대로). 장바구니 주문 화면은 장바구니 전체를 그대로 보내므로,
    주문 줄(상품·수량)이 지금 장바구니 전체와 같을 때만 장바구니 주문으로 본다. 바로 구매(한 상품)는 장바구니에 그 상품
    하나만 같은 수량으로 있을 때만 장바구니 주문과 구별되지 않는다(그때는 그 줄을 주문하는 것과 같다).
    """
    cart = {
        product_id: (quantity, build_id)
        for product_id, quantity, build_id in db.execute(
            select(CartItem.product_id, CartItem.quantity, CartItem.build_id).where(CartItem.owner_subject == subject)
        ).all()
    }
    ordered = {line.product_id: line.quantity for line in lines}
    if ordered != {product_id: quantity for product_id, (quantity, _) in cart.items()}:
        return {}
    return {product_id: build_id for product_id, (_, build_id) in cart.items()}


def _payment_matches(payment: dict, payment_id: str, total_krw: int) -> bool:
    amount = payment.get("amount")
    paid_total = amount.get("total") if isinstance(amount, dict) else None
    return (
        (payment.get("id") or payment.get("paymentId")) == payment_id
        and payment.get("status") == "PAID"
        and type(paid_total) is int
        and paid_total == total_krw
    )


def _pay_and_take_stock(db: Session, payment_id: str, buyer_subject: str, quantities: dict[int, int]) -> str:
    """한 트랜잭션에서 READY→PAID 와 재고 차감을 조건부로 한다. 부르기 전에 읽기 스냅샷을 닫아 둔다(end_read_snapshot).

    반환: "paid" 성공, "changed" 다른 요청이 먼저 상태를 바꿈, "short" 재고 부족(모두 롤백됨).
    MariaDB 가 1020(스냅샷 충돌)·1213(교착, 예: 같은 사용자의 장바구니 담기와)으로 거부하면 롤백하고 새 트랜잭션으로
    한 번 더 한다. 상태 변경·재고 차감·장바구니 정리가 한 트랜잭션이고 모두 조건부라, 다시 해도 재고를 두 번 줄이지 않는다.
    """
    attempt = 1
    while True:
        try:
            return _pay_and_take_stock_once(db, payment_id, buyer_subject, quantities)
        except OperationalError as exc:  # _pay_and_take_stock_once 가 이미 롤백했다
            if attempt >= PAY_ATTEMPTS or not is_retryable_conflict(exc):
                raise
            attempt += 1
            logger.warning("Order %s payment transaction hit a lock conflict; retrying once.", payment_id)


def _pay_and_take_stock_once(db: Session, payment_id: str, buyer_subject: str, quantities: dict[int, int]) -> str:
    try:
        # 상태를 먼저 바꾼다. 같은 주문을 동시에 확인하면 두 번째 UPDATE 는 0행이 되어 재고를 건드리지 않는다.
        claimed = db.execute(
            update(ProductOrder)
            .where(ProductOrder.payment_id == payment_id, ProductOrder.status == ORDER_READY)
            .values(status=ORDER_PAID, paid_at=_now())
            .execution_options(synchronize_session=False)
        ).rowcount
        if claimed != 1:
            db.rollback()
            return "changed"
        # 상품 ID 순서로 잠가 주문끼리 교착을 줄인다.
        for product_id in sorted(quantities):
            quantity = quantities[product_id]
            taken = db.execute(
                update(Product)
                .where(Product.id == product_id, Product.stock >= quantity)
                .values(stock=Product.stock - quantity)
                .execution_options(synchronize_session=False)
            ).rowcount
            if taken != 1:
                db.rollback()
                return "short"
        db.execute(
            delete(CartItem)
            .where(CartItem.owner_subject == buyer_subject, CartItem.product_id.in_(list(quantities)))
            .execution_options(synchronize_session=False)
        )
        db.commit()
        return "paid"
    except Exception:
        db.rollback()
        raise


def _cancel_for_stock_shortage(db: Session, payment_id: str, subject: str) -> None:
    try:
        portone.cancel_payment(payment_id, STOCK_CANCEL_REASON)
    except portone.PortOneError:
        if _own_order(db, payment_id, subject).status == ORDER_CANCELLED:
            # 같은 주문의 다른 확인 요청이 먼저 취소를 끝냈다.
            raise HTTPException(409, STOCK_CANCELLED) from None
        logger.error("PortOne cancel failed after stock shortage; order %s stays READY.", payment_id)
        raise HTTPException(502, STOCK_CANCEL_FAILED) from None
    try:
        cancelled = db.execute(
            update(ProductOrder)
            .where(ProductOrder.payment_id == payment_id, ProductOrder.status == ORDER_READY)
            .values(status=ORDER_CANCELLED, cancelled_at=_now())
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
    except Exception:
        db.rollback()
        logger.error("PortOne payment %s was cancelled but the order could not be marked CANCELLED.", payment_id)
        raise
    if cancelled != 1:
        logger.error("PortOne payment %s was cancelled but the order was no longer READY.", payment_id)
    raise HTTPException(409, STOCK_CANCELLED)


def _cancel_mock_for_stock_shortage(db: Session, payment_id: str, subject: str) -> dict:
    """모의 결제는 PortOne 에 결제가 없으므로 취소 요청 없이 주문만 CANCELLED 로 바꾼다."""
    try:
        cancelled = db.execute(
            update(ProductOrder)
            .where(ProductOrder.payment_id == payment_id, ProductOrder.status == ORDER_READY)
            .values(status=ORDER_CANCELLED, cancelled_at=_now())
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
    except Exception:
        db.rollback()
        raise
    if cancelled != 1:
        # 그 사이 같은 주문의 다른 확인 요청이 상태를 바꿨다. PAID 면 그 결과를 그대로 돌려준다.
        current = _own_order(db, payment_id, subject)
        if current.status == ORDER_PAID:
            return _confirmed(db, current)
    raise HTTPException(409, STOCK_CANCELLED)


@router.post(
    "", response_model=PaymentRequestResponse, status_code=201,
    dependencies=[Depends(require_allowed_origin)],
)
def create_order(
    payload: CreateOrderRequest,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    # 모의 결제 대상(PAYMENT_MODE=mock + 시뮬레이션 도메인 이메일 회원)만 PortOne 설정 없이 주문을 만든다.
    is_mock = mock_payment.is_mock_buyer(db, subject)
    if not is_mock:
        _require_payment_configuration()
    product_ids = [line.product_id for line in payload.items]
    # 장바구니 주문이면 줄마다 장바구니 줄의 build_id 를 옮긴다. 잠그지 않는 읽기라 인증과 같은 읽기 트랜잭션에서 읽고
    # 값만 꺼내 둔다(아래 잠그는 트랜잭션에는 일반 SELECT 를 섞지 않는다).
    build_ids = _cart_build_ids(db, subject, payload.items)
    # 인증 SELECT 가 연 스냅샷을 닫고 잠그는 읽기부터 한다(스냅샷 뒤 재고가 바뀐 상품을 잠그면 MariaDB 1020).
    end_read_snapshot(db)
    # 품목 INSERT 의 외래 키 확인이 products 행에 공유 잠금을 거는데, 요청 순서대로 걸리면 상품 id 순서로 배타 잠금을
    # 거는 주문 확인(_pay_and_take_stock)·시장 도구와 교착할 수 있다. 처음 읽을 때 id 순서로 공유 잠금을 걸어 둔다.
    # 잠근 뒤 읽은 재고라 아래 재고 확인도 최신 값으로 한다. 잠금은 이 요청의 커밋·롤백까지(짧다).
    # 출시 전 상품은 없는 상품처럼 빠져 아래에서 404 가 된다.
    products = {
        product.id: product
        for product in db.scalars(
            select(Product).where(Product.id.in_(product_ids), released())
            .order_by(Product.id).with_for_update(read=True)
        )
    }
    if len(products) != len(product_ids):
        raise HTTPException(404, PRODUCT_NOT_FOUND)
    lines = [(products[line.product_id], line.quantity) for line in payload.items]
    for product, quantity in lines:
        if quantity > product.stock:
            raise HTTPException(409, stock_shortage_message(product))

    # 금액은 서버 DB 가격으로만 계산한다.
    order = ProductOrder(
        payment_id=f"order-{uuid4().hex}",
        buyer_subject=subject,
        status=ORDER_READY,
        order_name=_order_name([product.name for product, _ in lines]),
        total_krw=sum(product.price_krw * quantity for product, quantity in lines),
        payment_provider=PAYMENT_PROVIDER_MOCK if is_mock else PAYMENT_PROVIDER_PORTONE,
        **payload.shipping.model_dump(),
        items=[
            ProductOrderItem(
                product_id=product.id, product_name=product.name,
                unit_price_krw=product.price_krw, quantity=quantity, build_id=build_ids.get(product.id),
            )
            for product, quantity in lines
        ],
    )
    # 응답 값은 모두 위에서 정한 값이다. 커밋 뒤에 만들면 만료된 주문·품목을 다시 SELECT 한다.
    result = {
        "payment_id": order.payment_id, "order_name": order.order_name, "total_amount": order.total_krw,
        "currency": "KRW",
        "store_id": "" if is_mock else portone.PORTONE_STORE_ID,
        "channel_key": "" if is_mock else portone.PORTONE_CHANNEL_KEY,
        "provider": order.payment_provider,
        "status": order.status,
    }
    try:
        db.add(order)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(result, "주문을 생성했습니다.", 201)


@router.post("/confirm", response_model=OrderDetailResponse, dependencies=[Depends(require_allowed_origin)])
def confirm_order(
    payload: ConfirmOrderRequest,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    # 모의 결제 대상이 아니면 지금까지와 같이 PortOne 설정부터 확인한다.
    mock_allowed = mock_payment.is_mock_buyer(db, subject)
    if not mock_allowed:
        _require_payment_configuration()
    # 1. 없거나 남의 주문 404, PAID 200(멱등), CANCELLED 409
    order = _own_order(db, payload.payment_id, subject)
    if order.status != ORDER_READY:
        return _finished_order_response(db, order)
    is_mock = order.payment_provider == PAYMENT_PROVIDER_MOCK
    if is_mock and not mock_allowed:
        # 모의 결제가 꺼진 뒤(PAYMENT_MODE 변경 등)에는 모의 주문을 결제 완료로 만들지 않는다. 주문은 READY 로 남는다.
        raise HTTPException(503, PAYMENT_NOT_CONFIGURED)
    if not is_mock:
        _require_payment_configuration()
    payment_id, total_krw = order.payment_id, order.total_krw
    quantities: dict[int, int] = {}
    for item in order.items:
        quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity

    # 인증·주문 조회가 연 읽기 스냅샷을 닫는다. 그 사이 다른 확인·시장 도구가 같은 주문·상품을 바꾸고 커밋했어도
    # 3 의 조건부 UPDATE 가 1020 없이 최신 행을 잠근다. PortOne 조회(최대 10초) 동안 DB 연결도 쥐고 있지 않는다.
    # 필요한 값은 위에서 꺼내 두었다(닫으면 ORM 객체는 만료된다).
    end_read_snapshot(db)

    # 2. PortOne 에서 결제 상태와 금액을 확인한다. 실패하면 주문은 READY 로 남는다.
    #    모의 결제 주문은 PortOne 에 결제가 없으므로 조회하지 않고 금액이 맞는 결제로 본다.
    if not is_mock:
        try:
            payment = portone.get_payment(payment_id)
        except portone.PortOneError:
            raise HTTPException(502, PAYMENT_LOOKUP_FAILED) from None
        if not _payment_matches(payment, payment_id, total_krw):
            raise HTTPException(409, PAYMENT_MISMATCH)

    # 3. 상태 변경과 재고 차감을 한 트랜잭션에서 조건부로 한다.
    outcome = _pay_and_take_stock(db, payment_id, subject, quantities)
    if outcome == "changed":
        return _finished_order_response(db, _own_order(db, payment_id, subject))
    if outcome == "short":
        if is_mock:
            return _cancel_mock_for_stock_shortage(db, payment_id, subject)
        _cancel_for_stock_shortage(db, payment_id, subject)

    # 4. 성공: 장바구니 정리까지 커밋됐다.
    return _confirmed(db, _own_order(db, payment_id, subject))


@router.get("", response_model=OrderPageResponse)
def list_orders(
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    query = db.query(ProductOrder).filter(
        ProductOrder.buyer_subject == subject,
        ProductOrder.status.in_([ORDER_PAID, ORDER_CANCELLED]),
    )
    total = query.count()
    orders = (
        query.order_by(ProductOrder.created_at.desc(), ProductOrder.payment_id.desc())
        .offset((page - 1) * page_size).limit(page_size).all()
    )
    thumbnails = _thumbnails(db, orders)
    return _envelope(
        {
            "items": [_summary(order, thumbnails.get(order.payment_id, "")) for order in orders],
            "total": total, "page": page, "page_size": page_size,
        },
        "주문 내역을 조회했습니다.",
    )


@router.get("/{payment_id}", response_model=OrderDetailResponse)
def get_order(payment_id: str, subject: str = Depends(get_current_subject), db: Session = Depends(get_db)):
    return _envelope(_detail(db, _own_order(db, payment_id, subject)), "주문을 조회했습니다.")
