"""로컬 시뮬레이션 전용 모의 결제 대상 판정(docs/specs/2026-10-30-persona-simulator.md).

PAYMENT_MODE 가 mock 이고, 구매자가 이메일 회원(subject 가 users.id)이며, 그 이메일이
`@<MOCK_PAYMENT_EMAIL_DOMAIN>` 으로 끝날 때만 PortOne 없이 결제 완료로 처리한다.
- 대소문자와 앞뒤 공백은 무시한다. 도메인은 정확히 같아야 한다(하위 도메인 `x.sim.moa.test` 는 아니다).
- 카카오 회원(`kakao:` subject)과 없는 계정은 언제나 대상이 아니다.
테스트는 `monkeypatch.setattr(mock_payment, "PAYMENT_MODE", "mock")` 처럼 이 모듈 속성을 바꾼다.
"""
from sqlalchemy.orm import Session

from app.core.config import MOCK_PAYMENT_EMAIL_DOMAIN, PAYMENT_MODE, PAYMENT_MODE_MOCK
from app.models import User


def email_in_domain(email: str, domain: str) -> bool:
    domain = domain.strip().lower().removeprefix("@")
    if not domain:
        return False
    return email.strip().lower().endswith("@" + domain)


def is_mock_buyer(db: Session, subject: str) -> bool:
    """이 로그인 사용자의 주문을 모의 결제로 처리할지. PAYMENT_MODE 가 mock 이 아니면 DB 를 보지 않고 False."""
    if PAYMENT_MODE != PAYMENT_MODE_MOCK or subject.startswith("kakao:"):
        return False
    try:
        user_id = int(subject)
    except ValueError:
        return False
    user = db.get(User, user_id)
    return user is not None and email_in_domain(user.email, MOCK_PAYMENT_EMAIL_DOMAIN)
