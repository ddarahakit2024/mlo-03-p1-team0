from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.api.routers.questions import answer_result, keep_updated_at, question_detail
from app.core import clock, notifications
from app.core.session import get_current_subject, get_subject_profile
from app.models import Question, QuestionAnswer
from app.schemas.product import MAX_ID
from app.schemas.question import AnswerDeleteResponse, AnswerResponse, AnswerWrite, QuestionDetailResponse

router = APIRouter(prefix="/questions/{question_id}/answers", tags=["questions"])

QUESTION_NOT_FOUND = "질문을 찾을 수 없습니다."
ANSWER_NOT_FOUND = "답변을 찾을 수 없습니다."
NOT_ANSWER_OWNER = "본인이 작성한 답변만 수정하거나 삭제할 수 있습니다."
NOT_QUESTION_OWNER = "질문 작성자만 답변을 채택할 수 있습니다."
NOT_ACCEPTED = "채택된 답변이 아닙니다."

QuestionId = Annotated[int, Path(ge=1, le=MAX_ID)]
AnswerId = Annotated[int, Path(ge=1, le=MAX_ID)]


def _envelope(result, message: str, code: int = 200):
    return {"code": code, "message": message, "result": result}


def _question_or_404(db: Session, question_id: int) -> Question:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(404, QUESTION_NOT_FOUND)
    return question


def _answer_of(db: Session, question_id: int, answer_id: int) -> QuestionAnswer:
    answer = db.get(QuestionAnswer, answer_id)
    if answer is None or answer.question_id != question_id:
        raise HTTPException(404, ANSWER_NOT_FOUND)
    return answer


def _own_answer(
    db: Session, question_id: QuestionId, answer_id: AnswerId, subject: str,
) -> tuple[Question, QuestionAnswer]:
    question = _question_or_404(db, question_id)
    answer = _answer_of(db, question_id, answer_id)
    if answer.author_subject != subject:
        raise HTTPException(403, NOT_ANSWER_OWNER)
    return question, answer


def _question_for_accept(db: Session, question_id: int, answer_id: int, subject: str) -> Question:
    """채택·채택 취소: 질문 작성자만(403), 답변은 그 질문의 답변이어야 한다(404)."""
    question = _question_or_404(db, question_id)
    if question.author_subject != subject:
        raise HTTPException(403, NOT_QUESTION_OWNER)
    _answer_of(db, question_id, answer_id)
    return question


def _set_accepted(db: Session, question_id: int, answer_id: int | None, *conditions) -> None:
    """채택한 답변을 바꾸고 커밋한다. 글 내용이 바뀐 것이 아니므로 updated_at 은 그대로 둔다."""
    try:
        db.execute(
            update(Question).where(Question.id == question_id, *conditions)
            .values(accepted_answer_id=answer_id, **keep_updated_at()),
            execution_options={"synchronize_session": False},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


@router.post("", response_model=AnswerResponse, status_code=201, dependencies=[Depends(require_allowed_origin)])
def create_answer(
    question_id: QuestionId, payload: AnswerWrite,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    question = _question_or_404(db, question_id)
    now = clock.utc_now()
    author_name = get_subject_profile(db, subject)["name"]
    answer = QuestionAnswer(
        question_id=question_id, author_subject=subject, author_name=author_name,
        content=payload.content, created_at=now, updated_at=now,
    )
    try:
        db.add(answer)
        # 질문 작성자에게 새 답변 알림(자기 질문에 단 답변이면 알리지 않는다). 같은 트랜잭션
        notifications.notify_answer(db, question.author_subject, question.id, question.title, subject, author_name)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(answer_result(answer, subject, None), "답변이 등록되었습니다.", 201)


@router.patch("/{answer_id}", response_model=AnswerResponse, dependencies=[Depends(require_allowed_origin)])
def update_answer(
    question_id: QuestionId, answer_id: AnswerId, payload: AnswerWrite,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    question, answer = _own_answer(db, question_id, answer_id, subject)
    try:
        answer.content = payload.content
        answer.updated_at = clock.utc_now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(answer_result(answer, subject, question.accepted_answer_id), "답변이 수정되었습니다.")


@router.delete("/{answer_id}", response_model=AnswerDeleteResponse, dependencies=[Depends(require_allowed_origin)])
def delete_answer(
    question_id: QuestionId, answer_id: AnswerId,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    question, answer = _own_answer(db, question_id, answer_id, subject)
    try:
        if question.accepted_answer_id == answer.id:
            # 채택한 답변을 지우면 채택도 비운다(외래 키가 없어 DB 가 대신 해 주지 않는다).
            db.execute(
                update(Question).where(Question.id == question_id, Question.accepted_answer_id == answer.id)
                .values(accepted_answer_id=None, **keep_updated_at()),
                execution_options={"synchronize_session": False},
            )
        db.delete(answer)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _envelope(None, "답변이 삭제되었습니다.")


@router.post(
    "/{answer_id}/accept", response_model=QuestionDetailResponse, dependencies=[Depends(require_allowed_origin)],
)
def accept_answer(
    question_id: QuestionId, answer_id: AnswerId,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    """답변 채택. 질문 작성자만. 이미 채택한 답변이 있으면 바꾼다."""
    _question_for_accept(db, question_id, answer_id, subject)
    _set_accepted(db, question_id, answer_id)
    return _envelope(question_detail(db, _question_or_404(db, question_id), subject), "답변을 채택했습니다.")


@router.delete(
    "/{answer_id}/accept", response_model=QuestionDetailResponse, dependencies=[Depends(require_allowed_origin)],
)
def unaccept_answer(
    question_id: QuestionId, answer_id: AnswerId,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    """채택 취소. 그 답변이 채택된 답변이 아니면 404."""
    question = _question_for_accept(db, question_id, answer_id, subject)
    if question.accepted_answer_id != answer_id:
        raise HTTPException(404, NOT_ACCEPTED)
    _set_accepted(db, question_id, None, Question.accepted_answer_id == answer_id)
    return _envelope(question_detail(db, _question_or_404(db, question_id), subject), "답변 채택을 취소했습니다.")
