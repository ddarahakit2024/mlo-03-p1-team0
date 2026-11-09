from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import clock
from app.db.database import Base


def _now() -> datetime:
    return clock.utc_now()


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 2026-11-05 추가(NULL 허용, 이미 있는 테이블에는 app.scripts.sync_columns 가 더한다).
    # 관련 부품(출시된 판매 상품). null = 연결 없음. GET /questions?product_id= 가 이 인덱스로 찾는다
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", name="fk_questions_product_id"), nullable=True, index=True
    )
    # 조회수. GET /questions/{id} 가 원자적으로 1 올린다. 이 컬럼 전의 행은 NULL(= 0)
    view_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    # 채택한 답변 id. 외래 키 없음: 그 답변을 지우면 라우터가 비운다
    accepted_answer_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 가상 시계를 따르는 앱 시각. server_default(NOW()) 는 DDL 용으로만 남긴다(docs/specs/2026-11-01-virtual-clock.md)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), onupdate=_now
    )
    images: Mapped[list["QuestionImage"]] = relationship(
        cascade="all, delete-orphan", order_by="QuestionImage.id", lazy="selectin"
    )
    # 질문을 지우면 답변도 지운다(ORM cascade + DB ON DELETE CASCADE). 오래된 순.
    answers: Mapped[list["QuestionAnswer"]] = relationship(
        cascade="all, delete-orphan", order_by="(QuestionAnswer.created_at, QuestionAnswer.id)",
    )


class QuestionAnswer(Base):
    """질문에 달리는 답변. 로그인한 사용자 누구나(질문 작성자 포함) 쓴다."""

    __tablename__ = "question_answers"
    # 질문 상세의 답변(오래된 순)과 목록의 답변 수. 외래 키(question_id, ON DELETE CASCADE)도 이 인덱스를 쓴다.
    __table_args__ = (Index("ix_question_answers_question_created", "question_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    author_subject: Mapped[str] = mapped_column(String(100), nullable=False)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # UTC. 시각이 같으면 id 로 순서를 정한다.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)


class QuestionImage(Base):
    __tablename__ = "question_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)


class PendingS3Deletion(Base):
    """Durable retry queue; rows disappear only after S3 confirms deletion."""

    __tablename__ = "pending_s3_deletions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuestionUpload(Base):
    """Owner-bound staging upload; signed URLs never point to saved image keys."""

    __tablename__ = "question_uploads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    author_subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(30), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
