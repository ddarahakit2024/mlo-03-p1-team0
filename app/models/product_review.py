from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    return clock.utc_now()


class ProductReview(Base):
    """구매한 사용자가 상품마다 1개씩 남기는 리뷰."""

    __tablename__ = "product_reviews"
    __table_args__ = (
        UniqueConstraint("product_id", "author_subject", name="uq_product_reviews_product_author"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_product_reviews_rating_range"),
        # 리뷰 목록(상품별 최신순). 끝에 기본 키(id)가 붙어 "created_at, id" 정렬까지 인덱스로 읽는다.
        Index("ix_product_reviews_product_created", "product_id", "created_at"),
        # 별점 분포·평점 요약·평점순 정렬(상품별 개수·합계). 표를 읽지 않고 인덱스만 읽는다.
        Index("ix_product_reviews_product_rating", "product_id", "rating"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    author_subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # UTC. 시각이 같으면 목록은 id 로 순서를 정한다(MariaDB DATETIME 은 초 단위까지 저장).
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
