from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import hash_password
from app.models import User, UserProfile
from app.schemas.user import SignupRequest, SignupResponse

router = APIRouter(prefix="/user", tags=["users"])


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")
    user = User(email=payload.email, hashed_password=hash_password(payload.password), name=payload.name)
    db.add(user)
    try:
        db.flush()  # users.id 가 정해져야 프로필의 subject 를 만든다
        # 사용 목적은 고르지 않아도(null) 프로필 행을 만든다(행이 없으면 이 기능 전 가입·카카오 회원이다).
        db.add(UserProfile(subject=str(user.id), purpose=payload.purpose))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.") from None
    db.refresh(user)
    return {"code": status.HTTP_201_CREATED, "message": "회원가입이 완료되었습니다.", "result": user}
