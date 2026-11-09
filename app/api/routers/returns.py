"""반품 신청·철회(구매자). docs/specs/2026-11-01-returns-refunds.md 의 API 계약.

POST /orders/{payment_id}/returns                      신청(201 ReturnRequest)
POST /orders/{payment_id}/returns/{return_id}/withdraw 철회(200 ReturnRequest, REQUESTED 일 때만)

잠금(신청): 인증·주문 조회가 연 읽기 스냅샷을 닫고(end_read_snapshot) 한 트랜잭션에서
주문 행(배타) → 상품 행(공유, id 순서) → 이미 신청한 반품 줄(공유) → INSERT 순서로 한다.
- 주문 행 배타 잠금이 같은 주문의 신청끼리 줄을 세운다(신청 가능 수량을 두 번 쓰지 않는다).
- 상품 공유 잠금은 반품 줄 INSERT 의 외래 키 확인이 거는 잠금을 id 순서로 미리 건다(주문 생성과 같은 이유).
- 상품 → 반품 행 순서는 관리자 승인(상품 배타 → 반품 행 배타)과 같아 서로 교착하지 않는다.
- MariaDB 가 1020·1213 으로 거부하면 롤백하고 한 번 더 한다(주문 확인과 같다).
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.api.routers.orders import _own_order
from app.core import clock
from app.core import returns as return_policy
from app.core.session import get_current_subject
from app.db.database import end_read_snapshot, is_retryable_conflict
from app.models import Product, ProductOrder, ReturnRequest, ReturnRequestItem
from app.models.product_order import ORDER_PAID
from app.models.return_request import CLAIMING_STATUSES, RETURN_REQUESTED, RETURN_WITHDRAWN
from app.schemas.product import MAX_ID
from app.schemas.returns import CreateReturnRequest, ReturnRequestResponse

router = APIRouter(prefix="/orders", tags=["returns"])
logger = logging.getLogger(__name__)

RETURN_NOT_FOUND = "반품 신청을 찾을 수 없습니다."
NOT_PAID = "결제 완료된 주문만 반품을 신청할 수 있습니다."
DEADLINE_PASSED = "반품 신청 기간(결제 후 7일)이 지났습니다."
NOT_IN_ORDER = "주문에 없는 상품은 반품을 신청할 수 없습니다."
WITHDRAW_ONLY_REQUESTED = "신청 상태인 반품만 철회할 수 있습니다."
# 신청 트랜잭션 시도 횟수. 1020(스냅샷 충돌)·1213(교착)이면 롤백하고 한 번 더 한다.
CREATE_ATTEMPTS = 2

ReturnId = Annotated[int, Path(ge=1, le=MAX_ID)]


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def _over_quantity_message(name: str, available: int) -> str:
    if available <= 0:
        return f"'{name}' 상품은 이미 주문 수량만큼 반품을 신청했습니다."
    return f"'{name}' 상품은 최대 {available}개까지 반품을 신청할 수 있습니다."


def _create_once(
    db: Session, payment_id: str, subject: str, payload: CreateReturnRequest, lines: dict[int, tuple[str, int, int]],
) -> dict:
    """한 트랜잭션에서 잠그고 확인한 뒤 신청을 만든다. lines: 상품 id → (주문 당시 이름, 단가, 주문 수량)."""
    try:
        # 1. 주문 행 배타 잠금. 상태와 기한을 잠근 행으로 다시 본다.
        order = db.execute(
            select(ProductOrder.status, ProductOrder.paid_at)
            .where(ProductOrder.payment_id == payment_id).with_for_update()
        ).one()
        if order.status != ORDER_PAID:
            raise HTTPException(409, NOT_PAID)
        now = clock.utc_now()
        if return_policy.is_past_deadline(return_policy.return_deadline(order.status, order.paid_at), now):
            raise HTTPException(409, DEADLINE_PASSED)
        requested = {line.product_id: line.quantity for line in payload.items}
        if any(product_id not in lines for product_id in requested):
            raise HTTPException(409, NOT_IN_ORDER)

        # 2. 상품 행 공유 잠금(id 순서). 반품 줄 INSERT 의 외래 키 확인이 같은 행을 잠근다.
        db.execute(
            select(Product.id).where(Product.id.in_(list(requested))).order_by(Product.id).with_for_update(read=True)
        )
        # 3. 이미 신청한 수량(잠그는 읽기: 이 트랜잭션에는 일반 SELECT 를 섞지 않는다)
        claimed: dict[int, int] = {}
        for product_id, quantity in db.execute(
            select(ReturnRequestItem.product_id, ReturnRequestItem.quantity)
            .join(ReturnRequest, ReturnRequest.id == ReturnRequestItem.return_id)
            .where(ReturnRequest.payment_id == payment_id, ReturnRequest.status.in_(CLAIMING_STATUSES))
            .with_for_update(read=True)
        ):
            claimed[product_id] = claimed.get(product_id, 0) + quantity
        for product_id, (name, _price, ordered) in lines.items():  # 주문 줄 순서로 첫 초과 상품을 알린다
            if product_id in requested:
                available = ordered - claimed.get(product_id, 0)
                if requested[product_id] > available:
                    raise HTTPException(409, _over_quantity_message(name, available))

        # 4. 금액은 주문 당시 단가로 서버가 계산한다.
        items_total, deduction, refund = return_policy.refund_amounts(
            [(lines[line.product_id][1], line.quantity) for line in payload.items], payload.reason,
        )
        request = ReturnRequest(
            payment_id=payment_id, requester_subject=subject, reason=payload.reason, detail=payload.detail or "",
            status=RETURN_REQUESTED, items_total_krw=items_total, shipping_deduction_krw=deduction,
            refund_amount_krw=refund, requested_at=now,
            items=[
                ReturnRequestItem(product_id=line.product_id, quantity=line.quantity,
                                  unit_price_krw=lines[line.product_id][1])
                for line in payload.items
            ],
        )
        db.add(request)
        db.flush()  # id 가 정해진다
        # 응답은 커밋 전에 만든다(커밋 뒤에는 만료되어 다시 SELECT 한다).
        result = return_policy.return_result(request, {pid: line[0] for pid, line in lines.items()})
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{payment_id}/returns", response_model=ReturnRequestResponse, status_code=201,
    dependencies=[Depends(require_allowed_origin)],
)
def create_return(
    payment_id: str,
    payload: CreateReturnRequest,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    # 없거나 남의 주문 404. 주문 줄(이름·단가·수량)은 바뀌지 않으므로 잠그기 전에 읽고 값만 꺼내 둔다.
    order = _own_order(db, payment_id, subject)
    lines = {item.product_id: (item.product_name, item.unit_price_krw, item.quantity) for item in order.items}
    # 인증·주문 조회가 연 스냅샷을 닫고 잠그는 읽기부터 한다(스냅샷 뒤 바뀐 행을 잠그면 MariaDB 1020).
    end_read_snapshot(db)
    attempt = 1
    while True:
        try:
            result = _create_once(db, payment_id, subject, payload, lines)
            break
        except OperationalError as exc:  # _create_once 가 이미 롤백했다
            if attempt >= CREATE_ATTEMPTS or not is_retryable_conflict(exc):
                raise
            attempt += 1
            logger.warning("Return request for order %s hit a lock conflict; retrying once.", payment_id)
    return _envelope(result, "반품을 신청했습니다.", 201)


@router.post(
    "/{payment_id}/returns/{return_id}/withdraw", response_model=ReturnRequestResponse,
    dependencies=[Depends(require_allowed_origin)],
)
def withdraw_return(
    payment_id: str,
    return_id: ReturnId,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    order = _own_order(db, payment_id, subject)
    request = db.get(ReturnRequest, return_id)
    if request is None or request.payment_id != order.payment_id:
        raise HTTPException(404, RETURN_NOT_FOUND)
    if request.status != RETURN_REQUESTED:
        raise HTTPException(409, WITHDRAW_ONLY_REQUESTED)
    product_names = {item.product_id: item.product_name for item in order.items}
    end_read_snapshot(db)
    # 조건부 UPDATE: 그 사이 관리자가 승인·거절했으면 0행이 되어 409 다.
    try:
        changed = db.execute(
            update(ReturnRequest)
            .where(ReturnRequest.id == return_id, ReturnRequest.status == RETURN_REQUESTED)
            .values(status=RETURN_WITHDRAWN, decided_at=clock.utc_now(), decided_by_subject=subject)
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
    except Exception:
        db.rollback()
        raise
    if changed != 1:
        raise HTTPException(409, WITHDRAW_ONLY_REQUESTED)
    return _envelope(
        return_policy.return_result(db.get(ReturnRequest, return_id), product_names), "반품 신청을 철회했습니다.",
    )
