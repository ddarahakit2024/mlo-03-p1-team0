"""커뮤니티 게시판(자유·견적). docs/specs/2026-11-01-community-dark-theme.md

질문 게시판(questions)과는 따로 저장한다. 견적 게시판 답글에는 판매 상품으로 부품 목록(community_comment_items)을 붙인다.
"""
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    return clock.utc_now()


class CommunityPost(Base):
    __tablename__ = "community_posts"
    __table_args__ = (
        CheckConstraint("board IN ('free', 'build')", name="ck_community_posts_board"),
        # 게시판별 최신순 목록
        Index("ix_community_posts_board_created", "board", "created_at"),
        # 내 글 목록(GET /user/me/posts)
        Index("ix_community_posts_author_created", "author_subject", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board: Mapped[str] = mapped_column(String(20), nullable=False)  # free(자유) / build(견적)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 견적 글만 값이 있다(자유 글은 NULL). 예산(원)과 용도(gaming·office·creative·development·other).
    budget_krw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    purpose: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 2026-11-05 추가(NULL 허용, 이미 있는 테이블에는 app.scripts.sync_columns 가 더한다). 견적 글만 값이 있다.
    # 모니터 해상도(fhd·qhd·uhd·none)와 선호 조건 목록(quiet·small·white·rgb·upgradable, 중복 없음). NULL 은 응답에서 []
    monitor_resolution: Mapped[str | None] = mapped_column(String(10), nullable=True)
    preferences: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # UTC. 시각이 같으면 id 로 순서를 정한다.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    # 글을 지우면 댓글(과 그 부품 목록)도 지운다(ORM cascade + DB ON DELETE CASCADE). 오래된 순.
    comments: Mapped[list["CommunityComment"]] = relationship(
        cascade="all, delete-orphan", order_by="(CommunityComment.created_at, CommunityComment.id)",
    )


class CommunityComment(Base):
    """커뮤니티 글의 댓글. 견적 게시판 글의 댓글(답글)에는 부품 목록을 붙일 수 있다."""

    __tablename__ = "community_comments"
    # 글 상세의 댓글(오래된 순)과 목록의 댓글 수. 외래 키(post_id, ON DELETE CASCADE)도 이 인덱스를 쓴다.
    __table_args__ = (Index("ix_community_comments_post_created", "post_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("community_posts.id", ondelete="CASCADE"), nullable=False)
    author_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    # 댓글을 지우면 부품 목록도 지운다. id 순서 = 보여 주는 순서(요청 순서대로 넣는다).
    items: Mapped[list["CommunityCommentItem"]] = relationship(
        cascade="all, delete-orphan", order_by="CommunityCommentItem.id",
    )


class CommunityCommentItem(Base):
    """견적 답글의 부품 한 줄. 가격은 저장하지 않고 응답할 때 지금 판매가(products.price_krw)로 계산한다."""

    __tablename__ = "community_comment_items"
    __table_args__ = (
        # 같은 상품 두 줄 금지. 앞부분(comment_id)이 외래 키 인덱스 역할도 한다.
        UniqueConstraint("comment_id", "product_id", name="uq_community_comment_items_comment_product"),
        CheckConstraint("quantity >= 1 AND quantity <= 10", name="ck_community_comment_items_quantity_range"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("community_comments.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
