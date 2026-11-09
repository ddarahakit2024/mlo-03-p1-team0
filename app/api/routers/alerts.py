"""목표가 알림(/alerts). 로그인 필요. 판매가가 목표가 이하가 되면 app.core.pricing.change_store_price 가 알림함에 넣는다."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only

from app.api.deps import get_db, require_allowed_origin
from app.api.routers.products import get_product_or_404, summaries
from app.core import clock
from app.core.product_release import released
from app.core.session import get_current_subject
from app.db.database import end_read_snapshot
from app.models import PriceAlert, Product
from app.schemas.alert import AlertEmptyResponse, AlertListResponse, AlertResponse, AlertWrite
from app.schemas.product import MAX_ID

router = APIRouter(prefix="/alerts", tags=["alerts"])

ProductIdPath = Annotated[int, Path(ge=1, le=MAX_ID)]
MAX_ALERTS_PER_USER = 50
ALERT_LIMIT = f"목표가 알림은 {MAX_ALERTS_PER_USER}개까지 등록할 수 있습니다."
ALERT_NOT_FOUND = "등록된 목표가 알림이 없습니다."
ALERT_CHANGED = "목표가 알림이 다른 요청으로 바뀌었습니다. 다시 시도해 주세요."
# ProductSummary 에 쓰는 상품 컬럼(긴 description·specs 는 읽지 않는다)
_SUMMARY_COLUMNS = (
    Product.id, Product.name, Product.brand, Product.category, Product.price_krw, Product.stock,
    Product.thumbnail_url, Product.summary, Product.released_on, Product.performance_score,
)


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def _alert_result(alert: PriceAlert, summary: dict) -> dict:
    return {
        "product_id": alert.product_id,
        "target_price_krw": alert.target_price_krw,
        "reached": summary["price_krw"] <= alert.target_price_krw,
        "created_at": clock.as_utc(alert.created_at),
        "updated_at": clock.as_utc(alert.updated_at),
        "product": summary,
    }


def _alerts_with_products(db: Session, subject: str, *conditions) -> list[dict]:
    """subject 의 알림(출시된 상품만) 최근 수정 순."""
    rows = db.execute(
        select(PriceAlert, Product)
        .join(Product, Product.id == PriceAlert.product_id)
        .options(load_only(*_SUMMARY_COLUMNS))
        .where(PriceAlert.owner_subject == subject, released(), *conditions)
        .order_by(PriceAlert.updated_at.desc(), PriceAlert.id.desc())
    ).all()
    products = summaries(db, [product for _alert, product in rows])
    return [_alert_result(alert, summary) for (alert, _product), summary in zip(rows, products)]


@router.get("", response_model=AlertListResponse)
def list_alerts(subject: str = Depends(get_current_subject), db: Session = Depends(get_db)):
    return _envelope({"items": _alerts_with_products(db, subject)}, "목표가 알림 목록을 조회했습니다.")


@router.put("/{product_id}", response_model=AlertResponse, dependencies=[Depends(require_allowed_origin)])
def save_alert(
    product_id: ProductIdPath, payload: AlertWrite,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    """목표가 알림을 만들거나 바꾼다. 목표가가 바뀌면 notified_at 을 비운다(다음 도달 때 다시 알린다)."""
    get_product_or_404(db, product_id)
    existing = db.scalars(
        select(PriceAlert).where(PriceAlert.owner_subject == subject, PriceAlert.product_id == product_id)
    ).first()
    target = payload.target_price_krw
    if existing is None:
        count = db.scalar(select(func.count()).select_from(PriceAlert).where(PriceAlert.owner_subject == subject))
        if count >= MAX_ALERTS_PER_USER:
            raise HTTPException(409, ALERT_LIMIT)
        existing_id = existing_target = None
    else:
        existing_id, existing_target = existing.id, existing.target_price_krw
    # 쓰기 전에 인증·확인 SELECT 의 스냅샷을 닫는다(INSERT 의 외래 키 확인·UPDATE 가 잠그는 행이 그 뒤 바뀌었으면 MariaDB 1020).
    end_read_snapshot(db)
    now = clock.utc_now()
    try:
        if existing_id is None:
            db.add(PriceAlert(
                owner_subject=subject, product_id=product_id, target_price_krw=target, created_at=now, updated_at=now,
            ))
        else:
            values = {"target_price_krw": target, "updated_at": now}
            if target != existing_target:
                values["notified_at"] = None
            db.execute(
                update(PriceAlert).where(PriceAlert.id == existing_id).values(**values),
                execution_options={"synchronize_session": False},
            )
        db.commit()
    except IntegrityError:
        # 같은 사용자가 같은 상품에 동시에 처음 등록하면 UNIQUE 제약이 하나를 막는다.
        db.rollback()
        raise HTTPException(409, ALERT_CHANGED) from None
    except Exception:
        db.rollback()
        raise
    items = _alerts_with_products(db, subject, PriceAlert.product_id == product_id)
    if not items:  # 저장한 뒤 다른 요청이 지웠다
        raise HTTPException(409, ALERT_CHANGED)
    return _envelope(items[0], "목표가 알림을 저장했습니다.")


@router.delete("/{product_id}", response_model=AlertEmptyResponse, dependencies=[Depends(require_allowed_origin)])
def delete_alert(
    product_id: ProductIdPath, subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    end_read_snapshot(db)  # 알림 행을 지우기(잠그기) 전에 인증 SELECT 의 스냅샷을 닫는다
    try:
        deleted = db.execute(
            delete(PriceAlert).where(PriceAlert.owner_subject == subject, PriceAlert.product_id == product_id),
            execution_options={"synchronize_session": False},
        ).rowcount
        if not deleted:
            raise HTTPException(404, ALERT_NOT_FOUND)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(None, "목표가 알림을 삭제했습니다.")
