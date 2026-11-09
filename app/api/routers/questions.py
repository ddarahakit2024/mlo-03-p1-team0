import logging
from datetime import timedelta, timezone
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.core import clock, price_trends
from app.core.product_release import released
from app.core.question_images import (
    S3ImageStorage, STORAGE_ERRORS, UPLOAD_URL_SECONDS, cleanup_pending_images,
    safe_filename, unavailable, utcnow,
)
from app.core.session import get_current_subject, get_optional_subject, get_subject_profile
from app.db.database import end_read_snapshot
from app.models import PendingS3Deletion, Product, Question, QuestionAnswer, QuestionImage, QuestionUpload
from app.schemas.product import MAX_ID
from app.schemas.question import (
    QuestionCreate, QuestionDetailResponse, QuestionListResponse, QuestionWrite,
    UploadPresignRequest, UploadPresignResponse,
)

router = APIRouter(prefix="/questions", tags=["questions"])
logger = logging.getLogger(__name__)

LINKED_PRODUCT_NOT_FOUND = "관련 부품을 찾을 수 없습니다."


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def _question(db: Session, question_id: int) -> Question:
    # 경로 값에 범위 제한이 없다(API 계약). id 컬럼 범위 밖은 DB 에 묻지 않고 없는 질문으로 답한다.
    question = db.get(Question, question_id) if 1 <= question_id <= MAX_ID else None
    if question is None:
        raise HTTPException(404, "질문을 찾을 수 없습니다.")
    return question


def _owner(question: Question, subject: str) -> None:
    if question.author_subject != subject:
        raise HTTPException(403, "본인이 작성한 질문만 수정하거나 삭제할 수 있습니다.")


def answer_result(answer: QuestionAnswer, subject: str | None, accepted_answer_id: int | None) -> dict:
    return {
        "id": answer.id, "question_id": answer.question_id,
        "author": {"id": answer.author_subject, "name": answer.author_name},
        "content": answer.content,
        "created_at": clock.as_utc(answer.created_at), "updated_at": clock.as_utc(answer.updated_at),
        "is_owner": subject is not None and answer.author_subject == subject,
        "is_accepted": accepted_answer_id is not None and answer.id == accepted_answer_id,
    }


def keep_updated_at() -> dict:
    """조회수·채택처럼 글 내용이 아닌 값을 바꾸는 UPDATE 에 넣는다. questions.updated_at 의 onupdate 가 돌지 않게 한다."""
    return {"updated_at": Question.updated_at}


def check_linked_product(db: Session, product_id: int | None) -> None:
    """관련 부품은 출시된 상품만. 없거나 출시 전이면 422."""
    if product_id is not None and db.scalar(select(Product.id).where(Product.id == product_id, released())) is None:
        raise HTTPException(422, LINKED_PRODUCT_NOT_FOUND)


def _linked_products(db: Session, questions: list[Question]) -> dict[int, dict]:
    """질문들에 연결한 상품(출시된 상품만) id → QuestionProduct 값. 쿼리 한 번 + 가격 추세."""
    ids = {question.product_id for question in questions if question.product_id is not None}
    if not ids:
        return {}
    rows = db.execute(
        select(
            Product.id, Product.name, Product.brand, Product.category, Product.thumbnail_url, Product.price_krw,
        ).where(Product.id.in_(ids), released())
    ).all()
    trends = price_trends.trends_for(db, [(row.id, row.price_krw) for row in rows])
    return {
        row.id: {
            "id": row.id, "name": row.name, "brand": row.brand, "category": row.category,
            "thumbnail_url": row.thumbnail_url, "price_krw": row.price_krw,
            "change_30d_pct": trends[row.id]["change_30d_pct"],
        }
        for row in rows
    }


def _answer_counts(db: Session, question_ids: list[int]) -> dict[int, int]:
    if not question_ids:
        return {}
    rows = db.execute(
        select(QuestionAnswer.question_id, func.count(QuestionAnswer.id))
        .where(QuestionAnswer.question_id.in_(question_ids))
        .group_by(QuestionAnswer.question_id)
    ).all()
    return dict(rows)


def _summary(question: Question, answer_count: int, products: dict[int, dict]) -> dict:
    return {
        "id": question.id, "title": question.title, "content": question.content,
        "author": {"id": question.author_subject, "name": question.author_name},
        "created_at": question.created_at.replace(tzinfo=timezone.utc),
        "updated_at": question.updated_at.replace(tzinfo=timezone.utc),
        "image_count": len(question.images),
        "answer_count": answer_count,
        "product": products.get(question.product_id) if question.product_id is not None else None,
        "view_count": question.view_count or 0,
        "accepted_answer_id": question.accepted_answer_id,
    }


def question_detail(db: Session, question: Question, subject: str | None) -> dict:
    """QuestionDetail 응답 값(질문 상세·작성·수정·답변 채택)."""
    images = []
    try:
        stores = {}
        for image in question.images:
            if image.bucket not in stores:
                stores[image.bucket] = S3ImageStorage(image.bucket)
            images.append({
                "id": image.id, "filename": image.filename,
                "url": stores[image.bucket].signed_url(image.object_key),
            })
    except STORAGE_ERRORS:
        raise unavailable() from None
    answers = [answer_result(answer, subject, question.accepted_answer_id) for answer in question.answers]
    return {
        **_summary(question, len(answers), _linked_products(db, [question])), "images": images,
        "is_owner": question.author_subject == subject,
        "answers": answers,
    }


@router.get("", response_model=QuestionListResponse)
def list_questions(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 10,
    search: Annotated[str, Query(max_length=200)] = "",
    product_id: Annotated[int | None, Query(ge=1, le=MAX_ID)] = None,
    db: Session = Depends(get_db),
):
    conditions = [] if product_id is None else [Question.product_id == product_id]
    term = search.strip()
    if term:
        conditions.append(or_(
            Question.title.contains(term, autoescape=True),
            Question.content.contains(term, autoescape=True),
        ))
    total = db.scalar(select(func.count()).select_from(Question).where(*conditions))
    # page 에 상한이 없어(API 계약) 아주 큰 값이면 OFFSET 이 DB 정수 범위를 넘는다. 마지막 쪽 뒤는 읽지 않고 빈 목록이다.
    offset = (page - 1) * page_size
    questions = [] if offset >= total else db.scalars(
        select(Question).where(*conditions)
        .order_by(Question.created_at.desc(), Question.id.desc()).offset(offset).limit(page_size)
    ).all()
    answer_counts = _answer_counts(db, [item.id for item in questions])
    products = _linked_products(db, questions)
    return _envelope(
        {
            "items": [_summary(item, answer_counts.get(item.id, 0), products) for item in questions],
            "total": total, "page": page, "page_size": page_size,
        },
        "질문 목록을 조회했습니다.",
    )


@router.post("/uploads/presign", response_model=UploadPresignResponse, dependencies=[Depends(require_allowed_origin)])
def presign_question_image(
    payload: UploadPresignRequest, response: Response,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    try:
        storage = S3ImageStorage()
        upload = QuestionUpload(
            id=uuid4().hex, author_subject=subject, bucket=storage.bucket,
            object_key=storage.new_key(payload.content_type, staging=True),
            filename=safe_filename(payload.filename, payload.content_type),
            content_type=payload.content_type, size_bytes=payload.size,
            expires_at=utcnow() + timedelta(seconds=UPLOAD_URL_SECONDS),
        )
        url = storage.presign_upload(upload.object_key, upload.content_type)
        db.add(upload)
        db.commit()
        return _envelope({
            "upload_id": upload.id, "url": url, "method": "PUT",
            "headers": {"Content-Type": payload.content_type}, "expires_in": UPLOAD_URL_SECONDS,
        }, "이미지 업로드 URL을 발급했습니다.")
    except STORAGE_ERRORS:
        db.rollback()
        raise unavailable() from None
    except Exception:
        db.rollback()
        raise


@router.get("/{question_id}", response_model=QuestionDetailResponse)
def get_question(
    question_id: int, response: Response,
    subject: str | None = Depends(get_optional_subject), db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    if 1 <= question_id <= MAX_ID:
        # 조회수 +1(원자적 UPDATE, NULL 은 0 으로). GET 에서 DB 에 쓰는 유일한 곳이다. 행을 잠그기 전에 인증 SELECT 의
        # 스냅샷을 닫는다(같은 질문을 동시에 보면 다른 요청이 먼저 커밋한 행을 잠그게 되어 MariaDB 1020).
        end_read_snapshot(db)
        try:
            db.execute(
                update(Question).where(Question.id == question_id)
                .values(view_count=func.coalesce(Question.view_count, 0) + 1, **keep_updated_at()),
                execution_options={"synchronize_session": False},
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
    question = _question(db, question_id)
    return _envelope(question_detail(db, question, subject), "질문을 조회했습니다.")


def _rollback_copies(db: Session, keys: list[tuple[str, str]]) -> None:
    db.rollback()
    if not keys:
        return
    try:
        # Include uncertain COPY outcomes; final keys are unique to this attempt.
        db.add_all([PendingS3Deletion(bucket=bucket, object_key=key) for bucket, key in keys])
        db.commit()
        cleanup_pending_images(db)
    except SQLAlchemyError:
        db.rollback()
        # A DB outage may also prevent the durable queue. Try immediate cleanup.
        for bucket, key in keys:
            try:
                S3ImageStorage(bucket).delete(key)
            except (*STORAGE_ERRORS, HTTPException):
                logger.error("A copied question image requires storage cleanup.")


@router.post("", response_model=QuestionDetailResponse, status_code=201, dependencies=[Depends(require_allowed_origin)])
def create_question(
    payload: QuestionCreate,
    subject: str = Depends(get_current_subject),
    db: Session = Depends(get_db),
):
    copied_keys = []
    check_linked_product(db, payload.product_id)
    # 업로드 행을 잠그기 전에 인증 SELECT 의 스냅샷을 닫는다. 같은 업로드를 쓰는 다른 질문이 먼저 커밋했을 때
    # MariaDB 1020(500) 대신 잠금 뒤 최신 행을 읽어 아래 422(이미 사용됨)로 답하게 된다.
    end_read_snapshot(db)
    try:
        # Serialize consumers of the same upload IDs. A consumed upload cannot
        # attach to a second question, even if two finalizations arrive together.
        uploads = db.query(QuestionUpload).filter(QuestionUpload.id.in_(payload.upload_ids)).order_by(QuestionUpload.id).with_for_update().all() if payload.upload_ids else []
        by_id = {upload.id: upload for upload in uploads}
        validated = []
        stores = {}
        for upload_id in payload.upload_ids:
            upload = by_id.get(upload_id)
            if upload is None or upload.author_subject != subject:
                raise HTTPException(422, "사용할 수 없는 첨부 이미지입니다. 이미지를 다시 첨부해 주세요.")
            if upload.consumed or upload.expires_at.replace(tzinfo=None) <= utcnow():
                raise HTTPException(422, "첨부 이미지가 만료되었거나 이미 사용되었습니다. 이미지를 다시 첨부해 주세요.")
            if upload.bucket not in stores:
                stores[upload.bucket] = S3ImageStorage(upload.bucket)
            storage = stores[upload.bucket]
            validated.append((upload, storage, storage.verify_upload(upload)))
        name = get_subject_profile(db, subject)["name"]
        question = Question(
            title=payload.title, content=payload.content, author_subject=subject, author_name=name,
            product_id=payload.product_id, view_count=0,
        )
        db.add(question)
        db.flush()
        for upload, storage, etag in validated:
            key = storage.new_key(upload.content_type)
            copied_keys.append((storage.bucket, key))
            storage.copy_verified(upload, key, etag)
            question.images.append(QuestionImage(filename=upload.filename, bucket=storage.bucket, object_key=key))
            upload.consumed = True
        db.flush()
        result = question_detail(db, question, subject)
        db.commit()
        return _envelope(result, "질문이 등록되었습니다.", 201)
    except STORAGE_ERRORS:
        _rollback_copies(db, copied_keys)
        raise unavailable() from None
    except Exception:
        _rollback_copies(db, copied_keys)
        raise


@router.patch("/{question_id}", response_model=QuestionDetailResponse, dependencies=[Depends(require_allowed_origin)])
def update_question(
    question_id: int, payload: QuestionWrite,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    question = _question(db, question_id)
    _owner(question, subject)
    link = "product_id" in payload.model_fields_set  # 보내지 않으면 연결을 그대로 둔다. null 이면 끊는다
    if link:
        check_linked_product(db, payload.product_id)
    try:
        question.title = payload.title
        question.content = payload.content
        if link:
            question.product_id = payload.product_id
        db.flush()
        result = question_detail(db, question, subject)
        db.commit()
        return _envelope(result, "질문이 수정되었습니다.")
    except Exception:
        db.rollback()
        raise


@router.delete("/{question_id}", dependencies=[Depends(require_allowed_origin)])
def delete_question(
    question_id: int, subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    question = _question(db, question_id)
    _owner(question, subject)
    # Commit the durable cleanup queue in the same transaction as the deletion.
    db.add_all([PendingS3Deletion(bucket=image.bucket, object_key=image.object_key) for image in question.images])
    db.delete(question)
    db.commit()
    try:
        cleanup_pending_images(db)
    except SQLAlchemyError:
        db.rollback()
        logger.warning("Question deleted; queued image cleanup will be retried.")
    return _envelope(None, "질문이 삭제되었습니다.")
