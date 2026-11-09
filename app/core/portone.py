"""PortOne V2 REST 호출. 테스트는 get_payment, cancel_payment 를 monkeypatch 로 바꾼다."""
import json
import urllib.error
import urllib.parse
import urllib.request

from app.core.config import PORTONE_API_SECRET, PORTONE_CHANNEL_KEY, PORTONE_STORE_ID

PORTONE_API_BASE = "https://api.portone.io"
TIMEOUT_SECONDS = 10


class PortOneError(Exception):
    """PortOne 에 연결하지 못했거나 응답을 해석하지 못했다."""


def is_configured() -> bool:
    return bool(PORTONE_STORE_ID and PORTONE_CHANNEL_KEY and PORTONE_API_SECRET)


def get_payment(payment_id: str) -> dict:
    return _call("GET", f"/payments/{_quote(payment_id)}")


def cancel_payment(payment_id: str, reason: str, amount: int | None = None) -> dict:
    # amount 를 보내지 않으면 PortOne 이 남은 금액 전체를 취소한다(재고 부족 취소).
    # amount 를 주면 그 금액만 부분 취소한다(반품 환불, docs/specs/2026-11-01-returns-refunds.md).
    body: dict = {"reason": reason}
    if amount is not None:
        body["amount"] = amount
    return _call("POST", f"/payments/{_quote(payment_id)}/cancel", body)


def _quote(payment_id: str) -> str:
    return urllib.parse.quote(payment_id, safe="")


def _call(method: str, path: str, body: dict | None = None) -> dict:
    headers = {"Authorization": f"PortOne {PORTONE_API_SECRET}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(PORTONE_API_BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        # HTTPError(4xx/5xx)도 URLError 의 하위 클래스다. 비밀 키가 담긴 요청 정보는 남기지 않는다.
        raise PortOneError(type(exc).__name__) from None
    if not isinstance(payload, dict):
        raise PortOneError("unexpected response")
    return payload
