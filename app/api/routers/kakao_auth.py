from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.kakao import KakaoServiceError, KakaoTokenError, fetch_kakao_profile
from app.core.security import create_access_token
from app.core.session import set_access_token_cookie
from app.db.database import is_retryable_conflict
from app.models import KakaoAccount
from app.schemas.kakao import KakaoLoginRequest
from app.schemas.user import LoginResponse

router = APIRouter(prefix="/user/kakao", tags=["auth"])


def _save_kakao_account(db: Session, kakao_user_id: str, nickname: str) -> None:
    """카카오 계정을 만들거나 별명을 바꾼다.

    같은 사용자의 첫 로그인이 동시에 오면 둘 다 '없음'을 보고 INSERT 해 늦은 쪽이 기본 키 충돌이 난다.
    그때는 먼저 만든 행의 별명만 바꾸면 되므로 한 번 더 시도한다(두 번째는 UPDATE 라 다시 충돌하지 않는다).
    동시에 별명을 바꾸면 조회(스냅샷) 뒤 UPDATE 가 MariaDB 1020, 교착이면 1213 을 받는다. 이때도 한 번 더 시도한다.
    """
    for attempt in range(2):
        account = db.get(KakaoAccount, kakao_user_id)
        if account is None:
            db.add(KakaoAccount(kakao_user_id=kakao_user_id, nickname=nickname))
        else:
            account.nickname = nickname
        try:
            db.commit()
            return
        except IntegrityError:
            db.rollback()
            if attempt:
                raise
        except OperationalError as exc:
            db.rollback()
            if attempt or not is_retryable_conflict(exc):
                raise
        except Exception:
            db.rollback()
            raise


@router.post("/login", response_model=LoginResponse)
def kakao_login(payload: KakaoLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        kakao_user_id, nickname = fetch_kakao_profile(payload.code)
    except KakaoTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="카카오 로그인을 확인할 수 없습니다. 다시 시도해 주세요.",
        ) from None
    except KakaoServiceError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="카카오 로그인 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        ) from None

    _save_kakao_account(db, kakao_user_id, nickname)

    token = create_access_token(f"kakao:{kakao_user_id}")
    set_access_token_cookie(response, token, request)
    return {
        "code": status.HTTP_200_OK,
        "message": "카카오 로그인에 성공했습니다.",
        "result": {"authenticated": True},
    }
