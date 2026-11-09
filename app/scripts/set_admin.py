"""관리자 지정·해제(user_profiles.role). docs/specs/2026-11-01-returns-refunds.md "데이터 변경"

관리자 API(반품 관리 /admin/returns)는 user_profiles.role 이 "admin" 인 회원만 쓴다. 관리자는 화면이 아니라 사람이
이 스크립트로 정한다.

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.set_admin --email admin@example.com          # 미리보기: 바꿀 내용만 출력
    .\\.venv\\Scripts\\python.exe -m app.scripts.set_admin --email admin@example.com --yes    # 관리자로 지정
    .\\.venv\\Scripts\\python.exe -m app.scripts.set_admin --subject kakao:12345 --revoke --yes   # 관리자 해제
    docker compose exec backend python -m app.scripts.set_admin --email admin@example.com [--yes]   # 로컬 Docker

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- --email 은 이메일 회원(로그인과 같이 앞뒤 공백·대소문자 무시), --subject 는 토큰 subject(이메일 회원 "<users.id>",
  카카오 "kakao:<id>")다. 없는 회원이면 아무것도 바꾸지 않고 종료 코드 1.
- user_profiles 행이 없는 회원(카카오, 사용 목적 기능 전에 가입한 회원)은 지정할 때 행을 만든다(purpose 는 NULL).
  해제는 role 만 NULL 로 바꾸고 행은 지우지 않는다.
- user_profiles.role 컬럼이 없는 DB 는 먼저 python -m app.scripts.sync_columns --yes 를 실행한다(종료 코드 1 로 알린다).
- 이미 원하는 상태면 "바꿀 것이 없습니다."(종료 코드 0). 다시 실행해도 같다.
- 출력에는 subject 만 쓴다(이름 같은 개인정보는 출력하지 않는다).
"""
import argparse
import sys

from sqlalchemy import Engine, inspect, select
from sqlalchemy.orm import Session

from app import models  # noqa: F401 - 모든 모델을 Base.metadata 에 등록한다
from app.db.database import script_engine
from app.models import KakaoAccount, User, UserProfile
from app.models.user_profile import ROLE_ADMIN

PREVIEW = "미리보기입니다. 아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요."


def _find_subject(db: Session, email: str | None, subject: str | None) -> tuple[str | None, str]:
    """(subject 또는 None(없는 회원), 대상 설명)."""
    if email is not None:
        normalized = email.strip().lower()
        user_id = db.scalar(select(User.id).where(User.email == normalized))
        return (None if user_id is None else str(user_id)), f"이메일 {normalized}"
    subject = subject.strip()
    if subject.startswith("kakao:"):
        found = db.get(KakaoAccount, subject.removeprefix("kakao:")) is not None
        return (subject if found else None), f"subject {subject}"
    try:
        found = db.get(User, int(subject)) is not None
    except ValueError:
        found = False
    return (subject if found else None), f"subject {subject}"


def _role_column_problem(engine: Engine) -> str | None:
    inspector = inspect(engine)
    if "user_profiles" not in inspector.get_table_names():
        return "user_profiles 테이블이 없습니다. 새 버전의 앱을 한 번 시작해 테이블을 만든 뒤 다시 실행하세요."
    if "role" not in {column["name"] for column in inspector.get_columns("user_profiles")}:
        return "user_profiles.role 컬럼이 없습니다. 먼저 python -m app.scripts.sync_columns --yes 를 실행하세요."
    return None


def run(engine: Engine, email: str | None, subject: str | None, revoke: bool, yes: bool, out=print) -> int:
    """종료 코드: 0 성공(미리보기·바꿀 것 없음 포함), 1 없는 회원이거나 role 컬럼이 없음."""
    problem = _role_column_problem(engine)
    if problem is not None:
        out(problem)
        return 1
    with Session(engine) as db:
        target, label = _find_subject(db, email, subject)
        if target is None:
            out(f"{label} 회원이 없습니다. 아무것도 바꾸지 않았습니다.")
            return 1
        profile = db.get(UserProfile, target)
        current = profile.role if profile is not None else None
        wanted = None if revoke else ROLE_ADMIN
        if (current != ROLE_ADMIN) if revoke else (current == ROLE_ADMIN):
            out(f"- subject {target}: 이미 {'관리자가 아닙니다' if revoke else '관리자입니다'}. 바꿀 것이 없습니다.")
            return 0
        note = " (user_profiles 행을 새로 만듭니다)" if profile is None else ""
        out(f"- subject {target}: role {current or 'NULL'} → {wanted or 'NULL'}{note}")
        if not yes:
            out(PREVIEW)
            return 0
        if profile is None:
            db.add(UserProfile(subject=target, purpose=None, role=wanted))
        else:
            profile.role = wanted
        db.commit()
    out("완료.")
    return 0


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.set_admin",
        description="회원을 관리자로 지정하거나(--revoke) 해제합니다. --yes 없이 실행하면 미리보기만 합니다.",
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--email", help="이메일 회원의 이메일")
    target.add_argument("--subject", help='토큰 subject(이메일 회원 "<users.id>", 카카오 "kakao:<id>")')
    parser.add_argument("--revoke", action="store_true", help="관리자를 해제한다(role 을 NULL 로)")
    parser.add_argument("--yes", action="store_true", help="실제로 user_profiles 를 바꾼다")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, args.email, args.subject, args.revoke, args.yes, out=out)


if __name__ == "__main__":
    sys.exit(main())
