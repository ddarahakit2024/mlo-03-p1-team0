"""알림함(notifications)에 줄을 넣는 도우미. 모두 부르는 쪽 트랜잭션 안에서 db.add 만 한다(commit 은 부르는 쪽).

| kind | 언제 | 제목 |
| price_target | change_store_price 가 목표가 이하 가격을 정했고 그 알림의 notified_at 이 비어 있을 때 | 목표가 도달 |
| price_low | change_store_price 가 직전 365일의 모든 store 가격보다 낮은 가격을 정했을 때(알림 등록자, 같은 변경으로 목표가 알림을 받은 사람 제외) | 1년 최저가 갱신 |
| answer | 질문 작성자가 아닌 사람이 답변을 달았을 때 | 새 답변 |
| quote | 견적 글 작성자가 아닌 사람이 부품 목록이 있는 댓글을 달았을 때 | 견적 도착 |
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import clock
from app.models import Notification, PriceAlert, Product, ProductPriceHistory
from app.models.product_price_history import PRICE_SOURCE_STORE

KIND_PRICE_TARGET = "price_target"
KIND_PRICE_LOW = "price_low"
KIND_ANSWER = "answer"
KIND_QUOTE = "quote"
MAX_BODY_LENGTH = 300
PRICE_LOW_WINDOW_DAYS = 365
ELLIPSIS = "…"


def krw(value: int) -> str:
    """689000 → "689,000"."""
    return f"{value:,}"


def fit_body(template: str, title: str, **values: str) -> str:
    """template.format(title=..., **values) 가 MAX_BODY_LENGTH 를 넘으면 title 을 줄여(끝에 …) 맞춘다."""
    body = template.format(title=title, **values)
    overflow = len(body) - MAX_BODY_LENGTH
    if overflow > 0:
        keep = max(len(title) - overflow - len(ELLIPSIS), 0)
        body = template.format(title=title[:keep] + ELLIPSIS, **values)
    return body[:MAX_BODY_LENGTH]


def _add(db: Session, owner_subject: str, kind: str, title: str, body: str, **target: int | None) -> Notification:
    notification = Notification(
        owner_subject=owner_subject, kind=kind, title=title, body=body, created_at=clock.utc_now(), **target,
    )
    db.add(notification)
    return notification


def notify_answer(db: Session, question_author: str, question_id: int, question_title: str, answerer: str,
                  answerer_name: str) -> Notification | None:
    """새 답변. 질문 작성자 자신의 답변이면 알리지 않는다."""
    if answerer == question_author:
        return None
    body = fit_body("'{title}'에 {name}님이 답변했어요", question_title, name=answerer_name)
    return _add(db, question_author, KIND_ANSWER, "새 답변", body, question_id=question_id)


def notify_quote(db: Session, post_author: str, post_id: int, post_title: str, commenter: str,
                 commenter_name: str) -> Notification | None:
    """견적 도착. 글 작성자 자신의 댓글이면 알리지 않는다."""
    if commenter == post_author:
        return None
    body = fit_body("'{title}'에 {name}님이 견적을 보냈어요", post_title, name=commenter_name)
    return _add(db, post_author, KIND_QUOTE, "견적 도착", body, post_id=post_id)


def _lowest_store_price(db: Session, product_id: int, at: datetime) -> int | None:
    """at 직전 365일(at 포함) store 최저가. 기록이 없으면 None."""
    return db.scalar(
        select(func.min(ProductPriceHistory.price_krw)).where(
            ProductPriceHistory.product_id == product_id,
            ProductPriceHistory.source == PRICE_SOURCE_STORE,
            ProductPriceHistory.recorded_at >= at - timedelta(days=PRICE_LOW_WINDOW_DAYS),
            ProductPriceHistory.recorded_at <= at,
        )
    )


def on_store_price_change(db: Session, product: Product, price_krw: int, at: datetime) -> None:
    """change_store_price 가 새 store 기록을 넣기 전에 부른다. 이 상품에 목표가 알림이 없으면 쿼리 한 번으로 끝난다.

    - price_target: 가격 <= 목표가이고 notified_at 이 비어 있으면 알리고 notified_at 을 채운다. 가격 > 목표가면 비운다.
    - price_low: 직전 365일 store 기록이 있고 그 모두보다 낮으면, 이번에 price_target 을 받지 않은 등록자에게 알린다.
    """
    alerts = list(db.scalars(
        select(PriceAlert).where(PriceAlert.product_id == product.id).order_by(PriceAlert.id)
    ))
    if not alerts:
        return
    db.flush()  # 같은 트랜잭션에서 앞서 넣은 store 기록도 직전 기록으로 센다
    previous_lowest = _lowest_store_price(db, product.id, at)
    is_new_low = previous_lowest is not None and price_krw < previous_lowest
    now = clock.utc_now()
    for alert in alerts:
        reached = price_krw <= alert.target_price_krw
        if not reached:
            alert.notified_at = None
        elif alert.notified_at is None:
            alert.notified_at = now
            body = fit_body(
                "{title} 가격이 목표가 {target}원 이하로 내려왔어요. 지금 {price}원", product.name,
                target=krw(alert.target_price_krw), price=krw(price_krw),
            )
            _add(db, alert.owner_subject, KIND_PRICE_TARGET, "목표가 도달", body, product_id=product.id)
            continue
        if is_new_low:
            body = fit_body("{title} 가격이 {price}원으로 1년 중 가장 낮아요", product.name, price=krw(price_krw))
            _add(db, alert.owner_subject, KIND_PRICE_LOW, "1년 최저가 갱신", body, product_id=product.id)
