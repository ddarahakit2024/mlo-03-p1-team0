"""상품 상세 추천(Item-CF) 학습 기록과 추천 순위. docs/specs/2026-11-03-product-recommendations.md "데이터 변경"

- recommendation_models: 학습 한 번 = 1행(버전 itemcf-<id>, 이벤트·세션 수, 매개변수, 걸린 시간)
- product_recommendations: 모델 × 보고 있는 상품 × 추천 상품(상품마다 20개, rank 1~20)

값은 관리자 학습 API(POST /admin/recommendations/train)만 쓴다. 최근 모델 5개만 남기고 오래된 모델·추천 행은
같은 트랜잭션에서 지운다(app/core/recommendation_store.py). 운영 RDS 에는 앱 시작 때 create_all 이 새 테이블을 만든다.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    return clock.utc_now()


class RecommendationModel(Base):
    __tablename__ = "recommendation_models"
    __table_args__ = (UniqueConstraint("version", name="uq_recommendation_models_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(40), nullable=False)  # itemcf-<id>
    algorithm: Mapped[str] = mapped_column(String(40), nullable=False)  # itemcf-cosine
    trained_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )
    trained_by: Mapped[str] = mapped_column(String(100), nullable=False)  # 관리자 subject
    # 학습에 쓴 이벤트의 시작(received_at >= 이 시각). NULL = 전체
    events_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False)  # 읽은 상품 조회 이벤트 수(버린 것 제외)
    session_count: Mapped[int] = mapped_column(Integer, nullable=False)
    product_count: Mapped[int] = mapped_column(Integer, nullable=False)  # 이벤트에 나온 상품 수
    pair_count: Mapped[int] = mapped_column(Integer, nullable=False)  # 함께 본 상품 쌍 수(co > 0, 순서 없음)
    # {"neighbors": 50, "shrinkage": 20, "base_weight": 0.5, "price_scale": 0.25, "top_k": 20}
    params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)


class ProductRecommendation(Base):
    __tablename__ = "product_recommendations"
    __table_args__ = (
        UniqueConstraint(
            "model_id", "product_id", "recommended_product_id", name="uq_product_recommendations_model_pair"
        ),
        # 상품 상세 추천: 한 모델에서 한 상품의 순위를 rank 순으로 읽는다. 앞부분(model_id)은 외래 키 인덱스 역할도 한다
        Index("ix_product_recommendations_model_product_rank", "model_id", "product_id", "rank"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("recommendation_models.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)  # 보고 있는 상품
    recommended_product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)  # 1~20
    # FLOAT(53) = MariaDB 의 8바이트 DOUBLE. score = cf_score + 0.5 × base_score
    score: Mapped[float] = mapped_column(Float(53), nullable=False)
    cf_score: Mapped[float] = mapped_column(Float(53), nullable=False)
    base_score: Mapped[float] = mapped_column(Float(53), nullable=False)
    co_sessions: Mapped[int] = mapped_column(Integer, nullable=False)  # 함께 본 세션 수
