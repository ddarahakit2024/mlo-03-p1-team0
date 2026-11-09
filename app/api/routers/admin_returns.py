"""관리자 반품 관리. docs/specs/2026-11-01-returns-refunds.md 의 API 계약.

GET  /admin/returns?status=&page=        목록(쪽당 20, 신청 최근 순)
POST /admin/returns/{return_id}/approve 승인 = 환불(REQUESTED·APPROVED → REFUNDED, 실패하면 APPROVED + refund_error, 502)
POST /admin/returns/{return_id}/reject  거절(REQUESTED → REJECTED)

관리자는 user_profiles.role == "admin"(app/core/session.py 의 get_admin_subject: 비로그인 401, 관리자 아님 403).
응답에 이메일·이름·배송지 같은 개인정보를 넣지 않는다(구매자는 buyer_subject 로만 가리킨다).

환불(승인) 잠금: 인증·조회의 읽기 스냅샷을 닫은 뒤 한 트랜잭션에서
상품 행(배타, id 순서. 재고를 되돌릴 때만) → 반품 행(배타) 순서로 잠그고 상태를 다시 본다.
- 순서는 주문 확인(상품 → 장바구니)·반품 신청(상품 → 반품 줄)과 같은 "상품 먼저"라 서로 교착하지 않는다.
- 반품 행을 잠근 채 PortOne 부분 취소를 부른다. 같은 신청을 두 관리자가 동시에 승인하면 늦은 쪽은 앞의 커밋까지
  기다렸다가 REFUNDED 를 보고 409 가 된다(환불은 한 번만). PortOne 이 성공한 뒤의 UPDATE 는 이미 잠근 행만 바꾸므로
  잠금 때문에 실패하지 않는다(환불은 됐는데 기록이 없는 상태를 만들지 않는다).
- 그래서 PortOne 응답(최대 10초)까지 이 상품 행들의 잠금과 DB 연결을 쥔다. 관리자 승인은 드물어 받아들인다.
- 1020·1213 은 잠그는 단계(PortOne 을 부르기 전)에서만 롤백하고 한 번 더 한다(주문 확인과 같다).
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.core import clock, portone
from app.core import returns as return_policy
from app.core.session import get_admin_subject
from app.db.database import end_read_snapshot, is_retryable_conflict
from app.models import Product, ProductOrder, ProductOrderItem, ReturnRequest
from app.models.product_order import PAYMENT_PROVIDER_MOCK
from app.models.return_request import (
    REASON_DEFECTIVE, RETURN_APPROVED, RETURN_REFUNDED, RETURN_REJECTED, RETURN_REQUESTED,
)
from app.schemas.product import MAX_ID
from app.schemas.returns import (
    AdminReturnPageResponse, AdminReturnResponse, RejectReturnRequest, ReturnStatus,
)

router = APIRouter(prefix="/admin/returns", tags=["admin"])
logger = logging.getLogger(__name__)

PAGE_SIZE = 20
RETURN_NOT_FOUND = "반품 신청을 찾을 수 없습니다."
APPROVE_INVALID_STATUS = "신청 또는 환불 대기 상태인 반품만 승인할 수 있습니다."
REJECT_INVALID_STATUS = "신청 상태인 반품만 거절할 수 있습니다."
REFUND_FAILED = "환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요."
REFUND_REASON = "반품 환불"
REFUND_ERROR_MAX = 200
# 잠그는 단계 시도 횟수. 1020(스냅샷 충돌)·1213(교착)이면 롤백하고 한 번 더 한다.
LOCK_ATTEMPTS = 2

ReturnId = Annotated[int, Path(ge=1, le=MAX_ID)]


def _envelope(result, message: str):
    return {"code": 200, "message": message, "result": result}


def _admin_results(db: Session, requests: list[ReturnRequest]) -> list[dict]:
    """AdminReturn 응답들. 주문 정보(개인정보 제외)와 주문 당시 상품 이름을 한 번씩 읽는다."""
    payment_ids = {request.payment_id for request in requests}
    if not payment_ids:
        return []
    orders = {
        row.payment_id: row
        for row in db.execute(
            select(
                ProductOrder.payment_id, ProductOrder.order_name, ProductOrder.buyer_subject,
                ProductOrder.paid_at, ProductOrder.payment_provider,
            ).where(ProductOrder.payment_id.in_(payment_ids))
        )
    }
    names: dict[str, dict[int, str]] = {}
    for payment_id, product_id, name in db.execute(
        select(ProductOrderItem.payment_id, ProductOrderItem.product_id, ProductOrderItem.product_name)
        .where(ProductOrderItem.payment_id.in_(payment_ids))
    ):
        names.setdefault(payment_id, {})[product_id] = name
    results = []
    for request in requests:
        order = orders[request.payment_id]
        results.append({
            **return_policy.return_result(request, names.get(request.payment_id, {})),
            "order_name": order.order_name,
            "buyer_subject": order.buyer_subject,
            "paid_at": clock.as_utc(order.paid_at),
            "payment_provider": order.payment_provider,
            "refund_error": request.refund_error,
        })
    return results


def _admin_result(db: Session, return_id: int) -> dict:
    return _admin_results(db, [db.get(ReturnRequest, return_id)])[0]


@router.get("", response_model=AdminReturnPageResponse)
def list_returns(
    status: ReturnStatus | None = None,
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    _admin: str = Depends(get_admin_subject),
    db: Session = Depends(get_db),
):
    conditions = [] if status is None else [ReturnRequest.status == status]
    total = db.scalar(select(func.count()).select_from(ReturnRequest).where(*conditions))
    requests = db.scalars(
        select(ReturnRequest).where(*conditions)
        .order_by(ReturnRequest.requested_at.desc(), ReturnRequest.id.desc())
        .offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    ).all()
    return _envelope(
        {"items": _admin_results(db, list(requests)), "total": total, "page": page}, "반품 신청 목록을 조회했습니다.",
    )


def _lock_for_refund(db: Session, return_id: int, restock_ids: list[int]) -> str | None:
    """상품 행(id 순서) → 반품 행 순서로 배타 잠금하고 잠근 반품 행의 상태를 돌려준다.

    잠그는 읽기만 하므로 스냅샷을 열지 않는다. ORM 객체 대신 컬럼만 읽는다(객체를 읽으면 items 를 잠그지 않는
    SELECT 로 따로 읽는다). 1020·1213 이면 롤백하고 새 트랜잭션으로 한 번 더 한다(아직 아무것도 바꾸지 않았다)."""
    attempt = 1
    while True:
        try:
            if restock_ids:
                db.execute(
                    select(Product.id).where(Product.id.in_(restock_ids)).order_by(Product.id).with_for_update()
                )
            return db.execute(
                select(ReturnRequest.status).where(ReturnRequest.id == return_id).with_for_update()
            ).scalar_one_or_none()
        except OperationalError as exc:
            db.rollback()
            if attempt >= LOCK_ATTEMPTS or not is_retryable_conflict(exc):
                raise
            attempt += 1
            logger.warning("Return %s refund lock hit a lock conflict; retrying once.", return_id)


def _cancel_at_portone(payment_id: str, amount: int) -> str | None:
    """PortOne 부분 취소. 성공 None, 실패하면 refund_error 에 남길 문구(비밀 값 없음)."""
    if not portone.is_configured():
        return "결제 연동 설정이 없어 PortOne 에 환불을 요청하지 못했습니다."
    try:
        response = portone.cancel_payment(payment_id, REFUND_REASON, amount=amount)
    except portone.PortOneError as exc:
        return f"PortOne 부분 취소 실패({exc})"[:REFUND_ERROR_MAX]
    cancellation = response.get("cancellation") if isinstance(response, dict) else None
    if isinstance(cancellation, dict) and cancellation.get("status") == "FAILED":
        return "PortOne 부분 취소 실패(FAILED)"
    return None


def _refund(
    db: Session, return_id: int, admin: str, payment_id: str, provider: str, amount: int, restock: dict[int, int],
) -> None:
    """잠그고 → 상태 확인 → 환불(PortOne 또는 모의) → REFUNDED·재고 되돌림을 한 트랜잭션에서 한다."""
    try:
        locked_status = _lock_for_refund(db, return_id, sorted(restock))
        if locked_status not in (RETURN_REQUESTED, RETURN_APPROVED):
            # 다른 관리자가 먼저 환불·거절했거나 구매자가 철회했다. PortOne 을 부르지 않는다.
            raise HTTPException(409, APPROVE_INVALID_STATUS)
        now = clock.utc_now()
        # 모의 결제 주문은 PortOne 에 결제가 없다. 환불 금액이 0 이면 돌려줄 돈이 없다. 둘 다 PortOne 없이 성공으로 본다.
        error = None if provider == PAYMENT_PROVIDER_MOCK or amount <= 0 else _cancel_at_portone(payment_id, amount)
        if error is not None:
            db.execute(
                update(ReturnRequest).where(ReturnRequest.id == return_id)
                .values(status=RETURN_APPROVED, decided_at=now, decided_by_subject=admin, refund_error=error)
                .execution_options(synchronize_session=False)
            )
            db.commit()
            logger.warning("Return %s refund failed at PortOne; it stays APPROVED.", return_id)
            raise HTTPException(502, REFUND_FAILED)
        try:
            for product_id in sorted(restock):  # 불량이 아니면 반품 수량만큼 재고를 되돌린다(이미 잠근 행)
                db.execute(
                    update(Product).where(Product.id == product_id).values(stock=Product.stock + restock[product_id])
                    .execution_options(synchronize_session=False)
                )
            db.execute(
                update(ReturnRequest).where(ReturnRequest.id == return_id)
                .values(status=RETURN_REFUNDED, decided_at=now, decided_by_subject=admin, refunded_at=now,
                        refund_error=None)
                .execution_options(synchronize_session=False)
            )
            db.commit()
        except Exception:
            logger.error("Return %s was refunded (%s won) but could not be marked REFUNDED.", return_id, amount)
            raise
    except Exception:
        db.rollback()
        raise


@router.post("/{return_id}/approve", response_model=AdminReturnResponse, dependencies=[Depends(require_allowed_origin)])
def approve_return(return_id: ReturnId, admin: str = Depends(get_admin_subject), db: Session = Depends(get_db)):
    request = db.get(ReturnRequest, return_id)
    if request is None:
        raise HTTPException(404, RETURN_NOT_FOUND)
    if request.status not in (RETURN_REQUESTED, RETURN_APPROVED):
        raise HTTPException(409, APPROVE_INVALID_STATUS)
    # 신청의 주문·사유·금액·상품 줄은 바뀌지 않으므로 잠그기 전에 읽고 값만 꺼내 둔다.
    order = db.get(ProductOrder, request.payment_id)
    restock: dict[int, int] = {}
    if request.reason != REASON_DEFECTIVE:
        for item in request.items:
            restock[item.product_id] = restock.get(item.product_id, 0) + item.quantity
    payment_id, provider, amount = order.payment_id, order.payment_provider, request.refund_amount_krw
    # 인증·조회가 연 읽기 스냅샷을 닫는다(스냅샷 뒤 바뀐 행을 잠그면 MariaDB 1020).
    end_read_snapshot(db)
    _refund(db, return_id, admin, payment_id, provider, amount, restock)
    return _envelope(_admin_result(db, return_id), "반품을 승인하고 환불했습니다.")


@router.post("/{return_id}/reject", response_model=AdminReturnResponse, dependencies=[Depends(require_allowed_origin)])
def reject_return(
    return_id: ReturnId,
    payload: RejectReturnRequest,
    admin: str = Depends(get_admin_subject),
    db: Session = Depends(get_db),
):
    request = db.get(ReturnRequest, return_id)
    if request is None:
        raise HTTPException(404, RETURN_NOT_FOUND)
    if request.status != RETURN_REQUESTED:
        raise HTTPException(409, REJECT_INVALID_STATUS)
    end_read_snapshot(db)
    # 조건부 UPDATE: 그 사이 승인·철회됐으면 0행이 되어 409 다. 승인이 반품 행을 잠그고 있으면 끝날 때까지 기다린다.
    try:
        changed = db.execute(
            update(ReturnRequest)
            .where(ReturnRequest.id == return_id, ReturnRequest.status == RETURN_REQUESTED)
            .values(status=RETURN_REJECTED, decided_at=clock.utc_now(), decided_by_subject=admin,
                    reject_reason=payload.reason)
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
    except Exception:
        db.rollback()
        raise
    if changed != 1:
        raise HTTPException(409, REJECT_INVALID_STATUS)
    return _envelope(_admin_result(db, return_id), "반품 신청을 거절했습니다.")
