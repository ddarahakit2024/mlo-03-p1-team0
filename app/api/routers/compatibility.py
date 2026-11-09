"""부품 호환성 확인 POST /compatibility/check. docs/specs/2026-11-01-compatibility-rules.md "API 계약"

쿠키를 쓰지 않는 읽기 전용 확인이라 로그인·Origin 확인을 하지 않는다.
상품을 읽는 쿼리는 요청 크기와 관계없이 3개다(상품, attributes, 벤치마크). 판단은 app/core/compatibility.py 가 한다.
"""
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routers.products import PRODUCT_NOT_FOUND
from app.core.compatibility import Part, check_compatibility
from app.core.product_release import released
from app.models import Product, ProductAttributes, ProductBenchmark
from app.schemas.compatibility import CompatibilityCheckRequest, CompatibilityCheckResponse

router = APIRouter(prefix="/compatibility", tags=["compatibility"])

COMPATIBILITY_CHECKED = "호환성을 확인했습니다."


@router.post("/check", response_model=CompatibilityCheckResponse)
def check(payload: CompatibilityCheckRequest, db: Session = Depends(get_db)):
    product_ids = [line.product_id for line in payload.items]
    # 출시 전 상품은 없는 상품처럼 404 다(app/core/product_release.py)
    categories = dict(db.execute(
        select(Product.id, Product.category).where(Product.id.in_(product_ids), released())
    ).all())
    if len(categories) != len(product_ids):
        raise HTTPException(404, PRODUCT_NOT_FOUND)
    attributes = dict(db.execute(
        select(ProductAttributes.product_id, ProductAttributes.attributes)
        .where(ProductAttributes.product_id.in_(product_ids))
    ).all())
    benchmarks: dict[int, dict[str, float]] = defaultdict(dict)
    for product_id, name, score in db.execute(
        select(ProductBenchmark.product_id, ProductBenchmark.name, ProductBenchmark.score)
        .where(ProductBenchmark.product_id.in_(product_ids))
    ):
        benchmarks[product_id][name] = score
    parts = [
        Part(
            product_id=line.product_id, category=categories[line.product_id], quantity=line.quantity,
            attributes=attributes.get(line.product_id), benchmarks=benchmarks.get(line.product_id, {}),
        )
        for line in payload.items
    ]
    return {"code": 200, "message": COMPATIBILITY_CHECKED, "result": check_compatibility(parts)}
