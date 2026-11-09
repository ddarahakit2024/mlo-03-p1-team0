from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_allowed_origin
from app.core import clock
from app.core.security import create_access_token, verify_password
from app.core.session import (
    clear_access_token_cookie, get_current_subject, get_subject_profile, set_access_token_cookie,
)
from app.models import CommunityComment, CommunityPost, Question, QuestionAnswer, User, UserProfile
from app.models.user_profile import ROLE_ADMIN
from app.schemas.user import CurrentUserResponse, LoginRequest, LoginResponse, LogoutResponse, MyPostPageResponse

router = APIRouter(prefix="/user", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    token = create_access_token(str(user.id))
    set_access_token_cookie(response, token, request)
    return {
        "code": status.HTTP_200_OK,
        "message": "로그인에 성공했습니다.",
        "result": {"authenticated": True},
    }


@router.get("/me", response_model=CurrentUserResponse)
def current_user(subject: str = Depends(get_current_subject), db: Session = Depends(get_db)):
    # 사용 목적·관리자 표시는 /user/me 에서만 읽는다(인증 의존성 get_subject_profile 은 요청마다 불리므로 쿼리를 늘리지 않는다).
    profile = db.get(UserProfile, subject)
    return {
        "code": status.HTTP_200_OK,
        "message": "로그인 사용자 정보를 조회했습니다.",
        "result": {
            **get_subject_profile(db, subject),
            "purpose": profile.purpose if profile is not None else None,
            # admin 또는 null(docs/specs/2026-11-01-returns-refunds.md). 모르는 값은 관리자가 아니므로 null
            "role": ROLE_ADMIN if profile is not None and profile.role == ROLE_ADMIN else None,
        },
    }


@router.get("/me/posts", response_model=MyPostPageResponse)
def my_posts(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
    subject: str = Depends(get_current_subject), db: Session = Depends(get_db),
):
    """내가 쓴 질문과 커뮤니티 글(자유·견적)을 최신순 한 목록으로. reply_count 는 답변 수·댓글 수."""
    questions = select(
        literal("question").label("kind"), Question.id.label("id"), Question.title.label("title"),
        Question.created_at.label("created_at"),
    ).where(Question.author_subject == subject)
    posts = select(
        CommunityPost.board.label("kind"), CommunityPost.id.label("id"), CommunityPost.title.label("title"),
        CommunityPost.created_at.label("created_at"),
    ).where(CommunityPost.author_subject == subject)
    total = (
        db.scalar(select(func.count()).select_from(Question).where(Question.author_subject == subject))
        + db.scalar(select(func.count()).select_from(CommunityPost).where(CommunityPost.author_subject == subject))
    )
    # page 에 상한이 없다. 마지막 쪽 뒤는 읽지 않고 빈 목록이다(OFFSET 이 DB 정수 범위를 넘지 않게).
    offset = (page - 1) * page_size
    mine = union_all(questions, posts).subquery()
    rows = [] if offset >= total else db.execute(
        select(mine.c.kind, mine.c.id, mine.c.title, mine.c.created_at)
        .order_by(mine.c.created_at.desc(), mine.c.id.desc(), mine.c.kind)
        .offset(offset).limit(page_size)
    ).all()
    question_ids = [row.id for row in rows if row.kind == "question"]
    post_ids = [row.id for row in rows if row.kind != "question"]
    answers = dict(db.execute(
        select(QuestionAnswer.question_id, func.count(QuestionAnswer.id))
        .where(QuestionAnswer.question_id.in_(question_ids)).group_by(QuestionAnswer.question_id)
    ).all()) if question_ids else {}
    comments = dict(db.execute(
        select(CommunityComment.post_id, func.count(CommunityComment.id))
        .where(CommunityComment.post_id.in_(post_ids)).group_by(CommunityComment.post_id)
    ).all()) if post_ids else {}
    items = [
        {
            "kind": row.kind, "id": row.id, "title": row.title, "created_at": clock.as_utc(row.created_at),
            "reply_count": (answers if row.kind == "question" else comments).get(row.id, 0),
        }
        for row in rows
    ]
    return {
        "code": status.HTTP_200_OK,
        "message": "내가 쓴 글을 조회했습니다.",
        "result": {"items": items, "total": total, "page": page, "page_size": page_size},
    }


@router.post("/logout", response_model=LogoutResponse, dependencies=[Depends(require_allowed_origin)])
def logout(request: Request, response: Response):
    # 로그인하지 않았어도 200(멱등). 서버에 세션이 없으므로 쿠키만 만료시킨다.
    clear_access_token_cookie(response, request)
    return {"code": status.HTTP_200_OK, "message": "로그아웃되었습니다.", "result": None}
