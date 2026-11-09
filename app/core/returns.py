"""반품 정책과 응답 변환. docs/specs/2026-11-01-returns-refunds.md "정책"

DB 를 읽지 않는다. 라우터(app/api/routers/returns.py, admin_returns.py, orders.py)가 읽은 값을 넘긴다.
- 신청 기한: 결제 시각(paid_at)부터 7×24시간(가상 시계 clock.utc_now() 기준). 기한 시각까지는 신청할 수 있다.
- 신청 가능 수량: 주문 수량 − 이미 신청한 수량(REQUESTED·APPROVED·REFUNDED 인 신청의 합)
- 환불 금액: Σ(주문 당시 단가 × 수량) − (단순 변심이면 왕복 배송비 6,000원), 0원 아래로는 내려가지 않는다
"""
from collections.abc import Iterable
from datetime import datetime, timedelta

from app.core import clock
from app.models.product_order import ORDER_PAID
from app.models.return_request import CLAIMING_STATUSES, REASON_CHANGED_MIND, ReturnRequest

RETURN_WINDOW = timedelta(days=7)
# 단순 변심 반품의 왕복 배송비. shipping_deduction_krw 에는 이 값을 그대로 저장한다(환불 금액만 0원에서 멈춘다).
CHANGED_MIND_SHIPPING_KRW = 6_000


def return_deadline(order_status: str, paid_at: datetime | None) -> datetime | None:
    """반품 신청 기한(UTC). PAID 가 아니면 None."""
    if order_status != ORDER_PAID or paid_at is None:
        return None
    return clock.as_utc(paid_at) + RETURN_WINDOW


def is_past_deadline(deadline: datetime | None, now: datetime) -> bool:
    return deadline is None or now > deadline


def refund_amounts(lines: Iterable[tuple[int, int]], reason: str) -> tuple[int, int, int]:
    """(상품 합계, 배송비 차감, 환불 금액). lines 는 (주문 당시 단가, 반품 수량)."""
    items_total = sum(unit_price * quantity for unit_price, quantity in lines)
    deduction = CHANGED_MIND_SHIPPING_KRW if reason == REASON_CHANGED_MIND else 0
    return items_total, deduction, max(0, items_total - deduction)


def claimed_quantities(returns: Iterable[ReturnRequest]) -> dict[int, int]:
    """상품 id → 이미 신청한 수량(거절·철회한 신청은 빼고)."""
    claimed: dict[int, int] = {}
    for request in returns:
        if request.status in CLAIMING_STATUSES:
            for item in request.items:
                claimed[item.product_id] = claimed.get(item.product_id, 0) + item.quantity
    return claimed


def returnable(order_status: str, order_lines: Iterable[tuple[int, int]], claimed: dict[int, int]) -> list[dict]:
    """주문 줄 순서대로 [{product_id, quantity(신청 가능 수량)}]. 0 인 상품은 뺀다. PAID 가 아니면 빈 배열.

    기한은 보지 않는다(return_deadline 으로 따로 알린다. 기한이 지난 신청은 서버가 409 로 막는다)."""
    if order_status != ORDER_PAID:
        return []
    result = []
    for product_id, quantity in order_lines:
        available = quantity - claimed.get(product_id, 0)
        if available > 0:
            result.append({"product_id": product_id, "quantity": available})
    return result


def return_result(request: ReturnRequest, product_names: dict[int, str]) -> dict:
    """ReturnRequest 응답. product_names 는 그 주문의 상품 id → 주문 당시 이름."""
    return {
        "id": request.id,
        "payment_id": request.payment_id,
        "status": request.status,
        "reason": request.reason,
        "detail": request.detail,
        "items": [
            {
                "product_id": item.product_id, "product_name": product_names.get(item.product_id, ""),
                "quantity": item.quantity, "unit_price_krw": item.unit_price_krw,
            }
            for item in request.items
        ],
        "items_total_krw": request.items_total_krw,
        "shipping_deduction_krw": request.shipping_deduction_krw,
        "refund_amount_krw": request.refund_amount_krw,
        "requested_at": clock.as_utc(request.requested_at),
        "decided_at": clock.as_utc(request.decided_at),
        "reject_reason": request.reject_reason,
        "refunded_at": clock.as_utc(request.refunded_at),
    }
